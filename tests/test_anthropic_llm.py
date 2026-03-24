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


class TestAnthropicLLMStreaming(unittest.TestCase):
    """Test streaming token output via on_token callback."""

    @patch("src.harness.anthropic_llm.anthropic")
    def test_on_token_triggers_streaming_path(
        self, mock_anthropic: MagicMock,
    ) -> None:
        """When on_token is set, generate() uses _generate_streaming."""
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client

        # Set up the stream context manager mock
        mock_stream_ctx = MagicMock()
        mock_stream = MagicMock()
        mock_stream_ctx.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream_ctx.__exit__ = MagicMock(return_value=False)
        mock_client.messages.stream.return_value = mock_stream_ctx

        # Stream yields text delta events
        delta = MagicMock()
        delta.text = "Hello"
        event = MagicMock()
        event.type = "content_block_delta"
        event.delta = delta
        mock_stream.__iter__ = MagicMock(return_value=iter([event]))

        final_msg = FakeResponse(
            content=[FakeTextBlock(text="Hello world")],
        )
        mock_stream.get_final_message.return_value = final_msg

        tokens: list[str] = []
        llm = AnthropicLLM(api_key="test-key")
        llm.on_token = lambda t: tokens.append(t)
        result = llm.generate({"goal": "greet", "history": []})

        # Verify streaming path was used (not .create)
        mock_client.messages.stream.assert_called_once()
        mock_client.messages.create.assert_not_called()
        self.assertEqual(tokens, ["Hello"])
        self.assertEqual(result["type"], "final_response")
        self.assertEqual(result["content"], "Hello world")

    @patch("src.harness.anthropic_llm.anthropic")
    def test_no_on_token_uses_create(
        self, mock_anthropic: MagicMock,
    ) -> None:
        """When on_token is None, generate() uses messages.create."""
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client
        mock_client.messages.create.return_value = FakeResponse(
            content=[FakeTextBlock(text="hi")],
        )

        llm = AnthropicLLM(api_key="test-key")
        # on_token defaults to None via BaseLLM.__init__
        result = llm.generate({"goal": "greet", "history": []})

        mock_client.messages.create.assert_called_once()
        mock_client.messages.stream.assert_not_called()
        self.assertEqual(result["type"], "final_response")

    @patch("src.harness.anthropic_llm.anthropic")
    def test_streaming_tool_use_no_text_tokens(
        self, mock_anthropic: MagicMock,
    ) -> None:
        """Tool-use responses may emit no text deltas."""
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client

        mock_stream_ctx = MagicMock()
        mock_stream = MagicMock()
        mock_stream_ctx.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream_ctx.__exit__ = MagicMock(return_value=False)
        mock_client.messages.stream.return_value = mock_stream_ctx

        # Only a content_block_start for tool_use, no text deltas
        event = MagicMock()
        event.type = "content_block_start"
        event.content_block = FakeToolUseBlock(
            name="bash", input={"command": "ls"},
        )
        mock_stream.__iter__ = MagicMock(return_value=iter([event]))

        final_msg = FakeResponse(
            content=[
                FakeToolUseBlock(name="bash", input={"command": "ls"}),
            ],
        )
        mock_stream.get_final_message.return_value = final_msg

        tokens: list[str] = []
        llm = AnthropicLLM(api_key="test-key")
        llm.on_token = lambda t: tokens.append(t)
        result = llm.generate({"goal": "list", "history": []})

        self.assertEqual(tokens, [])
        self.assertEqual(result["type"], "tool_call")
        self.assertEqual(result["tool_name"], "bash")


class TestAnthropicLLMImportError(unittest.TestCase):
    """Test that missing anthropic package raises ImportError."""

    def test_raises_import_error_when_sdk_missing(self) -> None:
        with patch("src.harness.anthropic_llm.anthropic", None):
            with self.assertRaises(ImportError) as ctx:
                AnthropicLLM(api_key="test-key")
            self.assertIn("anthropic", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
