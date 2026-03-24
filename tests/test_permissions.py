"""Tests for the three-level trust / permission system."""

from __future__ import annotations

import unittest
from typing import Any, Dict
from unittest.mock import MagicMock

from harness.agent import HarnessAgent, RunConfig
from harness.llm import ScriptedLLM


class TestNeedsApproval(unittest.TestCase):
    """Test HarnessAgent._needs_approval logic."""

    def _agent(self, trust: str) -> HarnessAgent:
        return HarnessAgent(ScriptedLLM([]), RunConfig(trust_level=trust))

    # -- ask mode --

    def test_ask_mode_bash_needs_approval(self) -> None:
        agent = self._agent("ask")
        self.assertTrue(agent._needs_approval("bash"))

    def test_ask_mode_edit_file_needs_approval(self) -> None:
        agent = self._agent("ask")
        self.assertTrue(agent._needs_approval("edit_file"))

    def test_ask_mode_write_text_file_needs_approval(self) -> None:
        agent = self._agent("ask")
        self.assertTrue(agent._needs_approval("write_text_file"))

    def test_ask_mode_read_file_no_approval(self) -> None:
        agent = self._agent("ask")
        self.assertFalse(agent._needs_approval("read_file"))

    def test_ask_mode_echo_no_approval(self) -> None:
        agent = self._agent("ask")
        self.assertFalse(agent._needs_approval("echo"))

    # -- auto-edit mode --

    def test_auto_edit_bash_needs_approval(self) -> None:
        agent = self._agent("auto-edit")
        self.assertTrue(agent._needs_approval("bash"))

    def test_auto_edit_edit_file_no_approval(self) -> None:
        agent = self._agent("auto-edit")
        self.assertFalse(agent._needs_approval("edit_file"))

    def test_auto_edit_write_text_file_no_approval(self) -> None:
        agent = self._agent("auto-edit")
        self.assertFalse(agent._needs_approval("write_text_file"))

    # -- yolo mode --

    def test_yolo_nothing_needs_approval(self) -> None:
        agent = self._agent("yolo")
        self.assertFalse(agent._needs_approval("bash"))
        self.assertFalse(agent._needs_approval("edit_file"))
        self.assertFalse(agent._needs_approval("write_text_file"))
        self.assertFalse(agent._needs_approval("read_file"))


class TestTrustEndToEnd(unittest.TestCase):
    """End-to-end tests: ScriptedLLM drives a tool call through different
    trust levels and verifies the approval callback behaviour."""

    @staticmethod
    def _bash_action() -> Dict[str, Any]:
        return {
            "type": "tool_call",
            "tool_name": "bash",
            "arguments": {"command": "echo hi"},
        }

    @staticmethod
    def _edit_action() -> Dict[str, Any]:
        return {
            "type": "tool_call",
            "tool_name": "edit_file",
            "arguments": {
                "path": "/tmp/test_permissions_dummy.txt",
                "old_text": "a",
                "new_text": "b",
            },
        }

    @staticmethod
    def _echo_action() -> Dict[str, Any]:
        return {
            "type": "tool_call",
            "tool_name": "echo",
            "arguments": {"text": "hello"},
        }

    @staticmethod
    def _final() -> Dict[str, Any]:
        return {"type": "final_response", "content": "done"}

    def test_ask_denied_blocks_tool(self) -> None:
        """trust=ask + on_approve returns False -> bash tool blocked."""
        llm = ScriptedLLM([self._bash_action(), self._final()])
        agent = HarnessAgent(llm, RunConfig(trust_level="ask", max_steps=4))
        agent.tools.register_tool("bash", lambda command="": command)

        deny = MagicMock(return_value=False)
        result = agent.run("test", on_approve=deny)

        deny.assert_called_once()
        self.assertTrue(
            any(
                (t.tool_result or {}).get("error") == "User denied tool execution"
                for t in result.turns
            )
        )

    def test_yolo_skips_approval(self) -> None:
        """trust=yolo -> on_approve is never called even if provided."""
        llm = ScriptedLLM([self._echo_action(), self._final()])
        agent = HarnessAgent(llm, RunConfig(trust_level="yolo", max_steps=4))
        agent.tools.register_tool("echo", lambda text="": text)

        spy = MagicMock(return_value=True)
        result = agent.run("test", on_approve=spy)

        spy.assert_not_called()
        self.assertEqual(result.stop_reason, "final_response")

    def test_auto_edit_allows_edit_file(self) -> None:
        """trust=auto-edit -> edit_file executes without approval."""
        llm = ScriptedLLM([self._edit_action(), self._final()])
        agent = HarnessAgent(
            llm,
            RunConfig(trust_level="auto-edit", max_steps=4),
        )
        agent.tools.register_tool(
            "edit_file",
            lambda path="", old_text="", new_text="": "ok",
        )

        spy = MagicMock(return_value=True)
        agent.run("test", on_approve=spy)

        # on_approve should NOT have been called for edit_file
        spy.assert_not_called()

    def test_auto_edit_still_asks_for_bash(self) -> None:
        """trust=auto-edit -> bash still triggers on_approve."""
        llm = ScriptedLLM([self._bash_action(), self._final()])
        agent = HarnessAgent(
            llm,
            RunConfig(trust_level="auto-edit", max_steps=4),
        )
        agent.tools.register_tool("bash", lambda command="": command)

        spy = MagicMock(return_value=True)
        agent.run("test", on_approve=spy)

        spy.assert_called_once()


class TestNoApproveCallbackBlocks(unittest.TestCase):
    """When on_approve is None, sensitive tools must be blocked."""

    def test_no_approve_callback_blocks_sensitive_tool(self) -> None:
        """Without on_approve, sensitive tools are blocked in ask mode."""
        agent = HarnessAgent(
            ScriptedLLM([
                {
                    "type": "tool_call",
                    "tool_name": "bash",
                    "arguments": {"command": "echo hi"},
                },
                {"type": "final_response", "content": "done"},
            ]),
            RunConfig(trust_level="ask", project_root="/tmp"),
        )
        result = agent.run(goal="test", on_approve=None)
        # bash should be blocked
        self.assertTrue(result.turns[0].tool_result["ok"] is False)
        self.assertIn(
            "requires approval", result.turns[0].tool_result["error"]
        )


if __name__ == "__main__":
    unittest.main()
