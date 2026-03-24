from __future__ import annotations

import unittest
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock, patch

from src.harness.anthropic_llm import AnthropicLLM


@dataclass
class FakeTextBlock:
    type: str = "text"
    text: str = ""


@dataclass
class FakeToolUseBlock:
    type: str = "tool_use"
    name: str = ""
    input: dict[str, Any] | None = None


@dataclass
class FakeResponse:
    content: list[Any] | None = None


class TestAnthropicLLMToolUse(unittest.TestCase):
    """Test that tool_use responses are parsed correctly."""

    @patch("src.harness.anthropic_llm.anthropic")
    def test_tool_use_response(self, mock_anthropic: MagicMock) -> None:
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client
        mock_client.messages.create.return_value = FakeResponse(
            content=[
                FakeToolUseBlock(
                    name="read_file",
                    input={"path": "/tmp/test.py"},
                ),
            ],
        )

        llm = AnthropicLLM(api_key="test-key")
        result = llm.generate({"goal": "read a file", "history": []})

        self.assertEqual(result["type"], "tool_call")
        self.assertEqual(result["tool_name"], "read_file")
        self.assertEqual(result["arguments"], {"path": "/tmp/test.py"})

    @patch("src.harness.anthropic_llm.anthropic")
    def test_text_response(self, mock_anthropic: MagicMock) -> None:
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client
        mock_client.messages.create.return_value = FakeResponse(
            content=[FakeTextBlock(text="The answer is 42.")],
        )

        llm = AnthropicLLM(api_key="test-key")
        result = llm.generate({"goal": "answer", "history": []})

        self.assertEqual(result["type"], "final_response")
        self.assertEqual(result["content"], "The answer is 42.")

    @patch("src.harness.anthropic_llm.anthropic")
    def test_mixed_text_and_tool_use_prefers_tool(
        self, mock_anthropic: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client
        mock_client.messages.create.return_value = FakeResponse(
            content=[
                FakeTextBlock(text="Let me run that."),
                FakeToolUseBlock(
                    name="bash", input={"command": "ls"},
                ),
            ],
        )

        llm = AnthropicLLM(api_key="test-key")
        result = llm.generate({"goal": "list files", "history": []})

        self.assertEqual(result["type"], "tool_call")
        self.assertEqual(result["tool_name"], "bash")

    @patch("src.harness.anthropic_llm.anthropic")
    def test_tool_schemas_passed_to_api(
        self, mock_anthropic: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client
        mock_client.messages.create.return_value = FakeResponse(
            content=[FakeTextBlock(text="done")],
        )

        schemas = [
            {
                "name": "echo",
                "description": "Echo text",
                "input_schema": {"type": "object", "properties": {}},
            },
        ]
        llm = AnthropicLLM(api_key="test-key", tool_schemas=schemas)
        llm.generate({"goal": "echo", "history": []})

        call_kwargs = mock_client.messages.create.call_args
        self.assertEqual(call_kwargs.kwargs["tools"], schemas)

    @patch("src.harness.anthropic_llm.anthropic")
    def test_no_schemas_omits_tools_kwarg(
        self, mock_anthropic: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client
        mock_client.messages.create.return_value = FakeResponse(
            content=[FakeTextBlock(text="hi")],
        )

        llm = AnthropicLLM(api_key="test-key", tool_schemas=[])
        llm.generate({"goal": "greet", "history": []})

        call_kwargs = mock_client.messages.create.call_args
        self.assertNotIn("tools", call_kwargs.kwargs)


class TestAnthropicLLMImportError(unittest.TestCase):
    """Test that missing anthropic package raises ImportError."""

    def test_raises_import_error_when_sdk_missing(self) -> None:
        with patch("src.harness.anthropic_llm.anthropic", None):
            with self.assertRaises(ImportError) as ctx:
                AnthropicLLM(api_key="test-key")
            self.assertIn("anthropic", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
