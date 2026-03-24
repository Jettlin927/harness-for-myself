"""Persistent cross-session memory for the agent harness.

Stores key-value memory entries in ``.hau/memory/`` as individual JSON files,
allowing the agent to retain and retrieve knowledge across different sessions.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class MemoryEntry:
    """A single persistent memory entry.

    Attributes:
        key: Unique identifier (e.g. ``"test_command"``, ``"architecture_notes"``).
        content: The memory content string.
        source: Origin of this memory (e.g. a session ID).
        created_at: ISO 8601 timestamp when the entry was created.
        tags: Classification tags (e.g. ``["constraint", "convention"]``).
    """

    key: str
    content: str
    source: str = ""
    created_at: str = ""
    tags: list[str] = field(default_factory=list)


class ProjectMemory:
    """Persistent cross-session memory stored in ``.hau/memory/``.

    Each memory entry is saved as a separate JSON file named ``{key}.json``
    under the memory directory.

    Args:
        project_root: Path to the project root containing the ``.hau/`` directory.
    """

    def __init__(self, project_root: str | Path) -> None:
        self.memory_dir = Path(project_root) / ".hau" / "memory"
        self.memory_dir.mkdir(parents=True, exist_ok=True)

    def save(
        self,
        key: str,
        content: str,
        *,
        source: str = "",
        tags: list[str] | None = None,
    ) -> MemoryEntry:
        """Save or update a memory entry.

        Args:
            key: Unique identifier for the entry.
            content: The memory content.
            source: Optional origin description.
            tags: Optional classification tags.

        Returns:
            The saved :class:`MemoryEntry`.
        """
        entry = MemoryEntry(
            key=key,
            content=content,
            source=source,
            created_at=datetime.now(timezone.utc).isoformat(),
            tags=tags or [],
        )
        path = self._path(key)
        path.write_text(
            json.dumps(asdict(entry), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return entry

    def load(self, key: str) -> MemoryEntry | None:
        """Load a memory entry by key.

        Returns:
            The :class:`MemoryEntry` if found, otherwise ``None``.
        """
        path = self._path(key)
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return MemoryEntry(**data)
        except (json.JSONDecodeError, TypeError, KeyError):
            return None

    def search(
        self,
        query: str = "",
        tags: list[str] | None = None,
    ) -> list[MemoryEntry]:
        """Search memories by substring in content or by tags.

        Args:
            query: Substring to match against entry content (case-insensitive).
            tags: If given, only return entries that have at least one matching tag.

        Returns:
            List of matching :class:`MemoryEntry` instances.
        """
        results: list[MemoryEntry] = []
        for entry in self.list_all():
            if query and query.lower() not in entry.content.lower():
                continue
            if tags and not set(tags) & set(entry.tags):
                continue
            results.append(entry)
        return results

    def delete(self, key: str) -> bool:
        """Delete a memory entry.

        Returns:
            ``True`` if the entry existed and was deleted, ``False`` otherwise.
        """
        path = self._path(key)
        if path.is_file():
            path.unlink()
            return True
        return False

    def list_all(self) -> list[MemoryEntry]:
        """List all memory entries sorted by creation time (newest first)."""
        entries: list[MemoryEntry] = []
        for path in sorted(self.memory_dir.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                entries.append(MemoryEntry(**data))
            except (json.JSONDecodeError, TypeError, KeyError):
                continue
        # Sort newest first
        entries.sort(key=lambda e: e.created_at, reverse=True)
        return entries

    def to_context_string(self, max_entries: int = 10) -> str:
        """Format memories as a string for injection into working memory context.

        Args:
            max_entries: Maximum number of entries to include.

        Returns:
            A formatted string summarising stored memories, or an empty string
            if no memories exist.
        """
        entries = self.list_all()[:max_entries]
        if not entries:
            return ""
        lines: list[str] = []
        for entry in entries:
            tags_str = f" [{', '.join(entry.tags)}]" if entry.tags else ""
            lines.append(f"- {entry.key}{tags_str}: {entry.content}")
        return "\n".join(lines)

    def _path(self, key: str) -> Path:
        """Return the filesystem path for a given memory key."""
        return self.memory_dir / f"{key}.json"
