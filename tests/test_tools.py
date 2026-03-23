from __future__ import annotations

import unittest

from src.harness.tools import ToolDispatcher


class ToolDispatcherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dispatcher = ToolDispatcher()

    def test_echo_happy_path(self) -> None:
        result = self.dispatcher.execute("echo", {"text": "hello"})
        self.assertTrue(result.ok)
        self.assertEqual(result.output, {"echo": "hello"})

    def test_add_happy_path(self) -> None:
        result = self.dispatcher.execute("add", {"a": 2, "b": 5})
        self.assertTrue(result.ok)
        self.assertEqual(result.output, {"sum": 7})

    def test_add_boundary_values(self) -> None:
        result = self.dispatcher.execute("add", {"a": 0, "b": -1})
        self.assertTrue(result.ok)
        self.assertEqual(result.output, {"sum": -1})

    def test_unknown_tool_returns_error(self) -> None:
        result = self.dispatcher.execute("missing", {})
        self.assertFalse(result.ok)
        self.assertIn("Unknown tool", result.error or "")

    def test_add_rejects_none_arguments(self) -> None:
        result = self.dispatcher.execute("add", {"a": None, "b": 1})
        self.assertFalse(result.ok)
        self.assertIn("must be numbers", result.error or "")

    def test_add_rejects_non_numeric_arguments(self) -> None:
        result = self.dispatcher.execute("add", {"a": "1", "b": 2})
        self.assertFalse(result.ok)
        self.assertIn("must be numbers", result.error or "")

    def test_utc_now_returns_utc_key(self) -> None:
        result = self.dispatcher.execute("utc_now", {})
        self.assertTrue(result.ok)
        self.assertIn("utc", result.output)


if __name__ == "__main__":
    unittest.main()
