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
        # Dynamic threshold = max_history_turns + 4 = 7; 7 turns should NOT trigger
        turns = [make_turn(i, f"obs-{i}") for i in range(1, 8)]
        self.assertFalse(memory.maybe_compress(turns))
        self.assertEqual(memory.summary, "")

    def test_maybe_compress_updates_summary_after_limit(self) -> None:
        memory = MemoryManager(max_history_turns=3)
        # Dynamic threshold = 7; 8 turns should trigger compression
        turns = [make_turn(i, f"obs-{i}") for i in range(1, 9)]
        self.assertTrue(memory.maybe_compress(turns))
        self.assertIn("turn 5: obs-5", memory.summary)


    def test_long_observation_truncated(self) -> None:
        """Observations exceeding _MAX_OBSERVATION_CHARS are truncated."""
        long_obs = "x" * 3000
        turns = [make_turn(1, long_obs)]
        memory = MemoryManager(max_history_turns=5)
        wm = memory.build_working_memory("goal", {}, turns)
        obs = wm["history"][0]["observation"]
        self.assertTrue(obs.endswith("[observation truncated at 2000 chars]"))
        # The first 2000 chars should be preserved
        self.assertTrue(obs.startswith("x" * 2000))

    def test_short_observation_not_truncated(self) -> None:
        """Observations within the limit are returned unchanged."""
        short_obs = "hello world"
        turns = [make_turn(1, short_obs)]
        memory = MemoryManager(max_history_turns=5)
        wm = memory.build_working_memory("goal", {}, turns)
        self.assertEqual(wm["history"][0]["observation"], short_obs)

    def test_tool_result_output_string_truncated(self) -> None:
        """tool_result with a long string output is truncated."""
        tr = TurnRecord(
            turn=1,
            goal="demo",
            working_memory={},
            llm_raw_output={},
            llm_action={"type": "tool_call"},
            tool_result={"ok": True, "output": "y" * 3000, "error": None},
            observation="ok",
        )
        memory = MemoryManager(max_history_turns=5)
        wm = memory.build_working_memory("goal", {}, [tr])
        output = wm["history"][0]["tool_result"]["output"]
        self.assertIn("[observation truncated at 2000 chars]", output)
        self.assertTrue(output.startswith("y" * 2000))

    def test_tool_result_read_file_content_truncated(self) -> None:
        """tool_result with output.content (read_file style) is truncated."""
        tr = TurnRecord(
            turn=1,
            goal="demo",
            working_memory={},
            llm_raw_output={},
            llm_action={"type": "tool_call"},
            tool_result={
                "ok": True,
                "output": {"content": "z" * 3000},
                "error": None,
            },
            observation="ok",
        )
        memory = MemoryManager(max_history_turns=5)
        wm = memory.build_working_memory("goal", {}, [tr])
        content = wm["history"][0]["tool_result"]["output"]["content"]
        self.assertIn("[observation truncated at 2000 chars]", content)

    def test_tool_result_not_dict_unchanged(self) -> None:
        """Non-dict tool_result is returned as-is."""
        tr = TurnRecord(
            turn=1,
            goal="demo",
            working_memory={},
            llm_raw_output={},
            llm_action={"type": "tool_call"},
            tool_result="plain string result",
            observation="ok",
        )
        memory = MemoryManager(max_history_turns=5)
        wm = memory.build_working_memory("goal", {}, [tr])
        self.assertEqual(wm["history"][0]["tool_result"], "plain string result")


if __name__ == "__main__":
    unittest.main()
