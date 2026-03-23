from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.harness import HarnessAgent, RunConfig, ScriptedLLM


class HarnessSmokeTests(unittest.TestCase):
    def test_tool_then_final(self) -> None:
        llm = ScriptedLLM(
            [
                {"type": "tool_call", "tool_name": "add", "arguments": {"a": 3, "b": 4}},
                {"type": "final_response", "content": "sum done"},
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(llm=llm, config=RunConfig(log_dir=tmp, max_steps=5))
            result = agent.run("please sum numbers")
            self.assertEqual(result.stop_reason, "final_response")
            self.assertEqual(result.final_response, "sum done")
            self.assertEqual(len(result.turns), 2)

            log_lines = Path(result.log_path).read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(log_lines), 2)
            parsed = [json.loads(line) for line in log_lines]
            self.assertEqual(parsed[0]["llm_action"]["action_type"], "tool_call")

    def test_direct_final(self) -> None:
        llm = ScriptedLLM([{"type": "final_response", "content": "hello"}])
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(llm=llm, config=RunConfig(log_dir=tmp, max_steps=3))
            result = agent.run("say hello")
            self.assertEqual(result.final_response, "hello")
            self.assertEqual(len(result.turns), 1)

    def test_schema_error_stops(self) -> None:
        llm = ScriptedLLM(
            [
                {"type": "tool_call", "arguments": {}},
                {"type": "tool_call", "arguments": {}},
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(
                llm=llm,
                config=RunConfig(log_dir=tmp, max_steps=3, schema_retry_limit=1),
            )
            result = agent.run("bad schema")
            self.assertEqual(result.stop_reason, "schema_error")
            self.assertIn("Stopped without final response", result.final_response)

    def test_schema_retry_recovers(self) -> None:
        llm = ScriptedLLM(
            [
                {"type": "tool_call", "arguments": {}},
                {"type": "final_response", "content": "recovered"},
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(
                llm=llm,
                config=RunConfig(log_dir=tmp, max_steps=3, schema_retry_limit=1),
            )
            result = agent.run("recover from schema drift")
            self.assertEqual(result.stop_reason, "final_response")
            self.assertEqual(result.final_response, "recovered")
            self.assertEqual(result.turns[0].llm_action["schema_retry_count"], 1)


if __name__ == "__main__":
    unittest.main()
