from __future__ import annotations

import tempfile
import unittest

from src.harness import HarnessAgent, RunConfig, ScriptedLLM


class HarnessAgentTests(unittest.TestCase):
    def test_unknown_tool_observation_is_recorded_and_agent_can_finish(self) -> None:
        llm = ScriptedLLM(
            [
                {"type": "tool_call", "tool_name": "missing", "arguments": {}},
                {"type": "final_response", "content": "handled"},
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(llm=llm, config=RunConfig(log_dir=tmp, max_steps=3))
            result = agent.run("try unknown tool")
            self.assertEqual(result.stop_reason, "final_response")
            self.assertEqual(result.turns[0].tool_result["ok"], False)
            self.assertIn("Unknown tool", result.turns[0].observation)

    def test_max_steps_returns_fallback_response(self) -> None:
        llm = ScriptedLLM(
            [{"type": "tool_call", "tool_name": "echo", "arguments": {"text": "loop"}}]
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(llm=llm, config=RunConfig(log_dir=tmp, max_steps=1))
            result = agent.run("never finalize")
            self.assertEqual(result.stop_reason, "max_steps_reached")
            self.assertIn("Stopped without final response", result.final_response)

    def test_run_accepts_none_context(self) -> None:
        llm = ScriptedLLM([{"type": "final_response", "content": "ok"}])
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(llm=llm, config=RunConfig(log_dir=tmp, max_steps=1))
            result = agent.run("direct", context=None)
            self.assertEqual(result.final_response, "ok")
            self.assertEqual(len(result.turns), 1)


if __name__ == "__main__":
    unittest.main()
