from __future__ import annotations

from typing import Any, Dict, List

from .types import TurnRecord


class MemoryManager:
    """Manages the working memory window sent to the LLM each turn.

    Maintains a rolling window of recent turns and compresses older history
    into a summary string that preserves tagged observations (``constraint:``,
    ``todo:``, ``evidence:``).

    Args:
        max_history_turns: Number of most-recent turns included verbatim in
            the working memory dict.
    """

    def __init__(self, max_history_turns: int = 8) -> None:
        self.max_history_turns = max_history_turns
        self.summary: str = ""

    def build_working_memory(
        self, goal: str, context: Dict[str, Any], turns: List[TurnRecord]
    ) -> Dict[str, Any]:
        """Build the working memory dict for the current turn.

        Args:
            goal: The task goal string.
            context: Extra context key/value pairs.
            turns: Full turn history so far.

        Returns:
            A dict with keys ``goal``, ``context``, ``summary_memory``, and
            ``history`` (the most recent ``max_history_turns`` turns).
        """
        recent_turns = turns[-self.max_history_turns :]
        history = [
            {
                "turn": t.turn,
                "action": t.llm_action,
                "observation": t.observation,
                "tool_result": t.tool_result,
            }
            for t in recent_turns
        ]

        return {
            "goal": goal,
            "context": context,
            "summary_memory": self.summary,
            "history": history,
        }

    def maybe_compress(self, turns: List[TurnRecord], max_total_turns: int = 12) -> bool:
        if len(turns) <= max_total_turns:
            return False

        old_turns = turns[: -self.max_history_turns]
        if not old_turns:
            return False

        constraints = self._extract_tagged_observations(old_turns, "constraint:")
        open_items = self._extract_tagged_observations(old_turns, "todo:")
        evidence = self._extract_tagged_observations(old_turns, "evidence:")
        brief_lines = [f"turn {t.turn}: {t.observation}" for t in old_turns[-4:]]

        summary_parts = []
        if constraints:
            summary_parts.append(f"Constraints: {'; '.join(constraints)}")
        if open_items:
            summary_parts.append(f"Open items: {'; '.join(open_items)}")
        if evidence:
            summary_parts.append(f"Evidence: {'; '.join(evidence)}")
        if brief_lines:
            summary_parts.append(f"Recent compressed history: {' | '.join(brief_lines)}")

        self.summary = " || ".join(summary_parts)
        return True

    def summarize_run(self, goal: str, turns: List[TurnRecord], stop_reason: str) -> str:
        """Return a compact one-line summary of a completed run.

        Suitable for accumulating cross-goal context in a persistent session.

        Args:
            goal: The task goal string.
            turns: Full turn list from the completed run.
            stop_reason: The stop reason from :class:`~harness.types.RunResult`.

        Returns:
            A short summary string with goal, stop reason, turn count, and any
            tagged observations.
        """
        constraints = self._extract_tagged_observations(turns, "constraint:")
        evidence = self._extract_tagged_observations(turns, "evidence:")

        parts = [f"[Goal: {goal[:80]}] stop={stop_reason} turns={len(turns)}"]
        if constraints:
            parts.append(f"constraints: {'; '.join(constraints[:3])}")
        if evidence:
            parts.append(f"evidence: {'; '.join(evidence[:3])}")

        return " | ".join(parts)

    @staticmethod
    def _extract_tagged_observations(turns: List[TurnRecord], prefix: str) -> List[str]:
        seen: set[str] = set()
        values: List[str] = []
        for turn in turns:
            observation = turn.observation.strip()
            if observation.lower().startswith(prefix):
                value = observation[len(prefix) :].strip()
                if value and value not in seen:
                    seen.add(value)
                    values.append(value)
        return values
