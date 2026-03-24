"""Session-level persistence for the interactive agent harness.

Manages cross-run state so that accumulated context and goal history survive
across multiple ``agent.run()`` calls and process restarts.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

_DEFAULT_SESSION_DIR = Path.home() / ".harness" / "sessions"
_MAX_SUMMARY_ENTRIES = 5


@dataclass
class SessionState:
    """Persisted state for a multi-goal interactive session.

    Args:
        session_id: Unique identifier for this session.
        created_at: ISO 8601 timestamp when the session was created.
        goals_completed: List of completed goal records, each with ``goal``,
            ``stop_reason``, ``turns``, and ``timestamp`` keys.
        accumulated_summary: Compressed cross-goal context passed to each new
            ``agent.run()`` as the ``context`` value.
        last_snapshot_path: Path to the most recent turn-level snapshot, useful
            for resuming an interrupted run.
    """

    session_id: str
    created_at: str
    goals_completed: List[Dict[str, Any]] = field(default_factory=list)
    accumulated_summary: str = ""
    last_snapshot_path: Optional[str] = None


class SessionManager:
    """Loads, updates, and saves session state to disk.

    Args:
        session_dir: Directory where session JSON files are stored. Defaults to
            ``~/.harness/sessions/``.
    """

    def __init__(self, session_dir: Path | str | None = None) -> None:
        self.session_dir = Path(session_dir) if session_dir else _DEFAULT_SESSION_DIR
        self.session_dir.mkdir(parents=True, exist_ok=True)

    # ── public ────────────────────────────────────────────────────────────────

    def load_or_create(self, session_id: str | None = None) -> SessionState:
        """Return an existing session or create a new one.

        Args:
            session_id: If given, load that session. If ``None``, create a new
                session with a fresh UUID.

        Returns:
            A :class:`SessionState` ready for use.
        """
        if session_id:
            path = self._path(session_id)
            if path.exists():
                return self._load(path)
        return self._new()

    def latest(self) -> SessionState | None:
        """Return the most recently modified session, or ``None`` if none exist."""
        files = sorted(
            self.session_dir.glob("*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not files:
            return None
        return self._load(files[0])

    def list_sessions(self) -> List[SessionState]:
        """Return all sessions sorted by creation time (newest first)."""
        files = sorted(
            self.session_dir.glob("*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        return [self._load(f) for f in files]

    def update(
        self,
        state: SessionState,
        goal: str,
        stop_reason: str,
        turns: int,
        snapshot_path: str | None = None,
    ) -> SessionState:
        """Append a completed goal to the session and refresh the summary.

        Args:
            state: Current session state to update (mutated in place).
            goal: The goal that was just completed.
            stop_reason: The stop reason from :class:`~harness.types.RunResult`.
            turns: Number of turns used.
            snapshot_path: Optional path to the last turn-level snapshot.

        Returns:
            The mutated :class:`SessionState`.
        """
        entry: Dict[str, Any] = {
            "goal": goal,
            "stop_reason": stop_reason,
            "turns": turns,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        state.goals_completed.append(entry)

        if snapshot_path:
            state.last_snapshot_path = snapshot_path

        state.accumulated_summary = self._build_summary(state.goals_completed)
        return state

    def save(self, state: SessionState) -> Path:
        """Persist session state to disk and return the file path."""
        path = self._path(state.session_id)
        path.write_text(json.dumps(asdict(state), indent=2, ensure_ascii=False), encoding="utf-8")
        return path

    def delete(self, session_id: str) -> bool:
        """Delete a session file. Returns ``True`` if it existed."""
        path = self._path(session_id)
        if path.exists():
            path.unlink()
            return True
        return False

    # ── private ───────────────────────────────────────────────────────────────

    def _path(self, session_id: str) -> Path:
        return self.session_dir / f"{session_id}.json"

    def _new(self) -> SessionState:
        return SessionState(
            session_id=str(uuid.uuid4()),
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    def _load(self, path: Path) -> SessionState:
        data = json.loads(path.read_text(encoding="utf-8"))
        return SessionState(**data)

    def _build_summary(self, goals: List[Dict[str, Any]]) -> str:
        """Build accumulated_summary from the most recent goal entries."""
        recent = goals[-_MAX_SUMMARY_ENTRIES:]
        lines = []
        for i, entry in enumerate(recent, 1):
            goal_short = entry["goal"][:80]
            lines.append(
                f"[Past goal {i}: {goal_short}] stop={entry['stop_reason']} turns={entry['turns']}"
            )
        return "\n".join(lines)
