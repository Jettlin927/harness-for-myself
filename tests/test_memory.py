from __future__ import annotations

import unittest

from src.harness.memory import MemoryManager
from src.harness.types import TurnRecord


def make_turn(turn: int, observation: str) -> TurnRecord:
    return TurnRecord(
        turn=turn,
        goal="demo",
        working_memory={},
        llm_raw_output={},
        llm_action={"type": "tool_call"},
        tool_result=None,
        observation=observation,
    )


class MemoryManagerTests(unittest.TestCase):
    def test_build_working_memory_happy_path(self) -> None:
        memory = MemoryManager(max_history_turns=2)
        turns = [make_turn(1, "first"), make_turn(2, "second"), make_turn(3, "third")]

        working_memory = memory.build_working_memory("goal", {"user": "u"}, turns)

        self.assertEqual(working_memory["goal"], "goal")
        self.assertEqual(working_memory["context"], {"user": "u"})
        self.assertEqual(len(working_memory["history"]), 2)
        self.assertEqual(working_memory["history"][0]["turn"], 2)
        self.assertEqual(working_memory["history"][1]["turn"], 3)

    def test_build_working_memory_with_empty_turns(self) -> None:
        memory = MemoryManager(max_history_turns=3)
        working_memory = memory.build_working_memory("goal", {}, [])
        self.assertEqual(working_memory["history"], [])
        self.assertEqual(working_memory["summary_memory"], "")

    def test_maybe_compress_boundary_does_not_compress_at_limit(self) -> None:
        memory = MemoryManager(max_history_turns=3)
        turns = [make_turn(i, f"obs-{i}") for i in range(1, 13)]
        self.assertFalse(memory.maybe_compress(turns))
        self.assertEqual(memory.summary, "")

    def test_maybe_compress_updates_summary_after_limit(self) -> None:
        memory = MemoryManager(max_history_turns=3)
        turns = [make_turn(i, f"obs-{i}") for i in range(1, 14)]
        self.assertTrue(memory.maybe_compress(turns))
        self.assertIn("turn 7: obs-7", memory.summary)
        self.assertIn("turn 10: obs-10", memory.summary)


if __name__ == "__main__":
    unittest.main()
