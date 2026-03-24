from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.harness import HarnessAgent, RunConfig, ScriptedLLM
from src.harness.tools import RetryableToolError
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


class HarnessReliabilityTests(unittest.TestCase):
    def test_goal_reached_token_stops_run(self) -> None:
        llm = ScriptedLLM(
            [
                {"type": "final_response", "content": "done GOAL_REACHED"},
                {"type": "final_response", "content": "should not be used"},
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(
                llm=llm,
                config=RunConfig(log_dir=tmp, goal_reached_token="GOAL_REACHED"),
            )
            result = agent.run("finish when marker appears")
            self.assertEqual(result.stop_reason, "goal_reached")
            self.assertEqual(result.final_response, "done GOAL_REACHED")
            self.assertEqual(len(result.turns), 1)

    def test_retryable_tool_error_retries_once_and_succeeds(self) -> None:
        llm = ScriptedLLM(
            [
                {"type": "tool_call", "tool_name": "flaky", "arguments": {"value": 7}},
                {"type": "final_response", "content": "recovered"},
            ]
        )
        attempts = {"count": 0}

        def flaky(arguments: dict[str, int]) -> dict[str, int]:
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise RetryableToolError("temporary issue")
            return {"value": arguments["value"]}

        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(
                llm=llm,
                config=RunConfig(log_dir=tmp, tool_retry_limit=1),
            )
            agent.tools.register_tool("flaky", flaky)
            result = agent.run("call flaky tool")
            self.assertEqual(result.stop_reason, "final_response")
            self.assertEqual(attempts["count"], 2)
            self.assertTrue(result.turns[0].tool_result["ok"])
            self.assertEqual(result.turns[0].tool_result["attempts"], 2)

    def test_non_retryable_failures_stop_at_max_failures(self) -> None:
        llm = ScriptedLLM(
            [
                {"type": "tool_call", "tool_name": "missing", "arguments": {}},
                {"type": "final_response", "content": "should not be reached"},
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(
                llm=llm,
                config=RunConfig(log_dir=tmp, max_failures=1),
            )
            result = agent.run("fail fast")
            self.assertEqual(result.stop_reason, "max_failures_reached")
            self.assertIn("Stopped without final response", result.final_response)
            self.assertEqual(len(result.turns), 1)

    def test_max_budget_stops_before_extra_turn(self) -> None:
        llm = ScriptedLLM(
            [
                {"type": "tool_call", "tool_name": "echo", "arguments": {"text": "once"}},
                {"type": "final_response", "content": "late final"},
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(
                llm=llm,
                config=RunConfig(log_dir=tmp, max_steps=5, max_budget=2),
            )
            result = agent.run("budgeted run")
            self.assertEqual(result.stop_reason, "max_budget_reached")
            self.assertEqual(len(result.turns), 1)

    def test_snapshot_is_persisted_and_resume_continues(self) -> None:
        llm = ScriptedLLM(
            [
                {"type": "tool_call", "tool_name": "echo", "arguments": {"text": "first"}},
                {"type": "final_response", "content": "resumed final"},
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(
                llm=llm,
                config=RunConfig(log_dir=tmp, max_steps=1, snapshot_dir=tmp),
            )
            first = agent.run("resume demo", context={"user": "alice"})
            self.assertEqual(first.stop_reason, "max_steps_reached")
            self.assertIsNotNone(first.snapshot_path)
            snapshot = Path(first.snapshot_path or "")
            self.assertTrue(snapshot.exists())

            resumed = agent.resume(first.snapshot_path or "")
            self.assertEqual(resumed.stop_reason, "final_response")
            self.assertEqual(resumed.final_response, "resumed final")
            self.assertEqual(len(resumed.turns), 2)
            self.assertEqual(resumed.turns[0].goal, "resume demo")

            payload = json.loads(snapshot.read_text(encoding="utf-8"))
            self.assertEqual(payload["goal"], "resume demo")
            self.assertEqual(payload["context"], {"user": "alice"})

    def test_repeated_dangerous_tool_call_is_blocked(self) -> None:
        llm = ScriptedLLM(
            [
                {"type": "tool_call", "tool_name": "delete_file", "arguments": {"path": "/tmp/a"}},
                {"type": "tool_call", "tool_name": "delete_file", "arguments": {"path": "/tmp/a"}},
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(
                llm=llm,
                config=RunConfig(log_dir=tmp, max_steps=2, dangerous_tools=("delete_file",)),
            )
            agent.tools.register_tool(
                "delete_file", lambda arguments: {"deleted": arguments["path"]}
            )
            result = agent.run("dangerous repeat")
            self.assertFalse(result.turns[1].tool_result["ok"])
            self.assertTrue(result.turns[1].tool_result["blocked"])
            self.assertIn("Repeated dangerous tool call", result.turns[1].tool_result["error"])


class TokenBudgetTests(unittest.TestCase):
    def test_token_budget_exceeded_stops_run(self) -> None:
        """Each action returns 5000 tokens; budget=8000 => stops after 2nd turn."""
        llm = ScriptedLLM(
            [
                {
                    "type": "tool_call",
                    "tool_name": "echo",
                    "arguments": {"text": "a"},
                    "_usage": {"total_tokens": 5000},
                },
                {
                    "type": "tool_call",
                    "tool_name": "echo",
                    "arguments": {"text": "b"},
                    "_usage": {"total_tokens": 5000},
                },
                {
                    "type": "tool_call",
                    "tool_name": "echo",
                    "arguments": {"text": "c"},
                    "_usage": {"total_tokens": 5000},
                },
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(
                llm=llm,
                config=RunConfig(
                    log_dir=tmp, max_steps=10, max_tokens_budget=8000
                ),
            )
            result = agent.run("token budget test")
            self.assertEqual(result.stop_reason, "token_budget_exceeded")
            # Turn 1 completes (5000 tokens), turn 2 generation triggers
            # budget check (10000 > 8000) and breaks before tool execution,
            # so only 1 turn is recorded.
            self.assertEqual(len(result.turns), 1)

    def test_token_budget_none_allows_unlimited(self) -> None:
        """With max_tokens_budget=None, all turns run without token budget stop."""
        llm = ScriptedLLM(
            [
                {
                    "type": "tool_call",
                    "tool_name": "echo",
                    "arguments": {"text": "a"},
                    "_usage": {"total_tokens": 99999},
                },
                {
                    "type": "final_response",
                    "content": "done",
                    "_usage": {"total_tokens": 99999},
                },
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(
                llm=llm,
                config=RunConfig(log_dir=tmp, max_tokens_budget=None),
            )
            result = agent.run("unlimited tokens")
            self.assertEqual(result.stop_reason, "final_response")
            self.assertEqual(result.final_response, "done")


class MemoryCompactionTests(unittest.TestCase):
    def test_summary_preserves_constraints_todos_and_evidence(self) -> None:
        from src.harness.memory import MemoryManager

        memory = MemoryManager(max_history_turns=2)
        turns = [
            make_turn(1, "constraint: stay within budget"),
            make_turn(2, "todo: still need final answer"),
            make_turn(3, "evidence: api returned 200"),
            make_turn(4, "plain observation"),
            make_turn(5, "recent"),
        ]

        compressed = memory.maybe_compress(turns, max_total_turns=4)

        self.assertTrue(compressed)
        self.assertIn("Constraints: stay within budget", memory.summary)
        self.assertIn("Open items: still need final answer", memory.summary)
        self.assertIn("Evidence: api returned 200", memory.summary)


if __name__ == "__main__":
    unittest.main()
