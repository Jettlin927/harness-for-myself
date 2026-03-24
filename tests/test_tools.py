from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.harness.tools import ToolDispatcher


class ToolDispatcherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.allowed_root = Path(self.tmp_dir.name)
        self.dispatcher = ToolDispatcher(allowed_write_roots=[self.allowed_root])

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

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

    def test_write_text_file_happy_path(self) -> None:
        output_path = self.allowed_root / "poems" / "jingyesi.txt"
        result = self.dispatcher.execute(
            "write_text_file",
            {"path": str(output_path), "content": "床前明月光"},
        )
        self.assertTrue(result.ok)
        self.assertEqual(output_path.read_text(encoding="utf-8"), "床前明月光")
        self.assertEqual(result.output["path"], str(output_path.resolve()))

    def test_write_text_file_rejects_empty_content(self) -> None:
        output_path = self.allowed_root / "empty.txt"
        result = self.dispatcher.execute(
            "write_text_file",
            {"path": str(output_path), "content": ""},
        )
        self.assertFalse(result.ok)
        self.assertIn("non-empty string 'content'", result.error or "")

    def test_write_text_file_rejects_missing_path(self) -> None:
        result = self.dispatcher.execute("write_text_file", {"content": "hello"})
        self.assertFalse(result.ok)
        self.assertIn("non-empty string 'path'", result.error or "")

    def test_write_text_file_rejects_outside_allowed_root(self) -> None:
        blocked_path = Path(self.tmp_dir.name).parent / "blocked.txt"
        result = self.dispatcher.execute(
            "write_text_file",
            {"path": str(blocked_path), "content": "nope"},
        )
        self.assertFalse(result.ok)
        self.assertIn("outside allowed write roots", result.error or "")

    def test_write_text_file_rejects_none_arguments(self) -> None:
        result = self.dispatcher.execute("write_text_file", {"path": None, "content": None})
        self.assertFalse(result.ok)
        self.assertIn("non-empty string 'path'", result.error or "")


class ToolSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dispatcher = ToolDispatcher()

    def test_register_tool_with_schema(self) -> None:
        schema = {
            "type": "object",
            "description": "A test tool",
            "properties": {"x": {"type": "integer"}},
            "required": ["x"],
        }
        self.dispatcher.register_tool(
            "test_tool",
            lambda args: args,
            schema=schema,
        )
        self.assertIn("test_tool", self.dispatcher._schemas)
        self.assertEqual(self.dispatcher._schemas["test_tool"], schema)

    def test_register_tool_without_schema(self) -> None:
        self.dispatcher.register_tool("bare", lambda args: args)
        self.assertNotIn("bare", self.dispatcher._schemas)

    def test_get_tool_schemas_format(self) -> None:
        schemas = self.dispatcher.get_tool_schemas()
        self.assertIsInstance(schemas, list)
        for entry in schemas:
            self.assertIn("name", entry)
            self.assertIn("description", entry)
            self.assertIn("input_schema", entry)

    def test_builtin_tools_have_schemas(self) -> None:
        expected = {"echo", "add", "utc_now", "write_text_file"}
        schema_names = {s["name"] for s in self.dispatcher.get_tool_schemas()}
        self.assertTrue(
            expected.issubset(schema_names),
            f"Missing schemas: {expected - schema_names}",
        )

    def test_get_tool_schemas_returns_correct_count(self) -> None:
        initial_count = len(self.dispatcher.get_tool_schemas())
        self.dispatcher.register_tool(
            "new_tool",
            lambda args: args,
            schema={
                "type": "object",
                "description": "New",
                "properties": {},
            },
        )
        self.assertEqual(
            len(self.dispatcher.get_tool_schemas()),
            initial_count + 1,
        )


if __name__ == "__main__":
    unittest.main()
