from __future__ import annotations

from typing import Any, Dict, List

from .types import TurnRecord


class MemoryManager:
    def __init__(self, max_history_turns: int = 8) -> None:
        self.max_history_turns = max_history_turns
        self.summary: str = ""

    def build_working_memory(self, goal: str, context: Dict[str, Any], turns: List[TurnRecord]) -> Dict[str, Any]:
        recent_turns = turns[-self.max_history_turns :]
        history = [
            {
                "turn": t.turn,
                "action": t.llm_action,
                "observation": t.observation,
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

        old_turns = turns[:-self.max_history_turns]
        if not old_turns:
            return False

        brief_lines = [
            f"turn {t.turn}: {t.observation}"
            for t in old_turns[-4:]
        ]
        self.summary = " | ".join(brief_lines)
        return True
