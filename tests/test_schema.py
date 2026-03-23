from __future__ import annotations

import unittest

from src.harness.schema import SchemaError, parse_llm_action


class SchemaParsingTests(unittest.TestCase):
    def test_parse_tool_call_happy_path_from_dict(self) -> None:
        action = parse_llm_action(
            {"type": "tool_call", "tool_name": "echo", "arguments": {"text": "hi"}}
        )
        self.assertEqual(action.action_type, "tool_call")
        self.assertEqual(action.tool_name, "echo")
        self.assertEqual(action.arguments, {"text": "hi"})

    def test_parse_final_response_happy_path_from_json_string(self) -> None:
        action = parse_llm_action('{"type": "final_response", "content": "done"}')
        self.assertEqual(action.action_type, "final_response")
        self.assertEqual(action.content, "done")

    def test_parse_rejects_null_input(self) -> None:
        with self.assertRaises(SchemaError):
            parse_llm_action(None)

    def test_parse_rejects_non_object_json(self) -> None:
        with self.assertRaises(SchemaError):
            parse_llm_action("[]")

    def test_parse_rejects_empty_final_response_content(self) -> None:
        with self.assertRaises(SchemaError):
            parse_llm_action({"type": "final_response", "content": "   "})

    def test_parse_rejects_missing_tool_name(self) -> None:
        with self.assertRaises(SchemaError):
            parse_llm_action({"type": "tool_call", "arguments": {}})

    def test_parse_rejects_non_dict_arguments(self) -> None:
        with self.assertRaises(SchemaError):
            parse_llm_action({"type": "tool_call", "tool_name": "echo", "arguments": None})

    def test_parse_rejects_invalid_json(self) -> None:
        with self.assertRaises(SchemaError):
            parse_llm_action("{bad json}")


if __name__ == "__main__":
    unittest.main()
