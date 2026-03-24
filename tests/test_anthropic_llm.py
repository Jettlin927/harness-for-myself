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
class FakeUsage:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class FakeResponse:
    content: list[Any] | None = None
    usage: FakeUsage | None = None


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
        self,
        mock_anthropic: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client
        mock_client.messages.create.return_value = FakeResponse(
            content=[
                FakeTextBlock(text="Let me run that."),
                FakeToolUseBlock(
                    name="bash",
                    input={"command": "ls"},
                ),
            ],
        )

        llm = AnthropicLLM(api_key="test-key")
        result = llm.generate({"goal": "list files", "history": []})

        self.assertEqual(result["type"], "tool_call")
        self.assertEqual(result["tool_name"], "bash")

    @patch("src.harness.anthropic_llm.anthropic")
    def test_tool_schemas_passed_to_api(
        self,
        mock_anthropic: MagicMock,
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
        self,
        mock_anthropic: MagicMock,
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
        self,
        mock_anthropic: MagicMock,
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
        self,
        mock_anthropic: MagicMock,
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
        self,
        mock_anthropic: MagicMock,
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
            name="bash",
            input={"command": "ls"},
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


class TestSetToolSchemas(unittest.TestCase):
    """Test set_tool_schemas updates schemas used in generate calls."""

    @patch("src.harness.anthropic_llm.anthropic")
    def test_set_tool_schemas_updates_schemas(
        self,
        mock_anthropic: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client
        mock_client.messages.create.return_value = FakeResponse(
            content=[FakeTextBlock(text="done")],
        )

        llm = AnthropicLLM(api_key="test-key")
        self.assertEqual(llm.tool_schemas, [])

        new_schemas = [
            {
                "name": "read_file",
                "description": "Read a file",
                "input_schema": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                },
            },
        ]
        llm.set_tool_schemas(new_schemas)
        llm.generate({"goal": "test", "history": []})

        call_kwargs = mock_client.messages.create.call_args
        self.assertEqual(call_kwargs.kwargs["tools"], new_schemas)


class TestUsageInResponse(unittest.TestCase):
    """Test that _parse_response returns _usage field."""

    @patch("src.harness.anthropic_llm.anthropic")
    def test_usage_returned_in_response(
        self,
        mock_anthropic: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client
        mock_client.messages.create.return_value = FakeResponse(
            content=[FakeTextBlock(text="hello")],
            usage=FakeUsage(input_tokens=100, output_tokens=50),
        )

        llm = AnthropicLLM(api_key="test-key")
        result = llm.generate({"goal": "test", "history": []})

        self.assertIn("_usage", result)
        self.assertEqual(result["_usage"]["input_tokens"], 100)
        self.assertEqual(result["_usage"]["output_tokens"], 50)
        self.assertEqual(result["_usage"]["total_tokens"], 150)

    @patch("src.harness.anthropic_llm.anthropic")
    def test_no_usage_when_absent(
        self,
        mock_anthropic: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client
        mock_client.messages.create.return_value = FakeResponse(
            content=[FakeTextBlock(text="hello")],
            usage=None,
        )

        llm = AnthropicLLM(api_key="test-key")
        result = llm.generate({"goal": "test", "history": []})

        self.assertNotIn("_usage", result)

    @patch("src.harness.anthropic_llm.anthropic")
    def test_streaming_returns_usage(
        self,
        mock_anthropic: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_anthropic.Anthropic.return_value = mock_client

        mock_stream_ctx = MagicMock()
        mock_stream = MagicMock()
        mock_stream_ctx.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream_ctx.__exit__ = MagicMock(return_value=False)
        mock_client.messages.stream.return_value = mock_stream_ctx
        mock_stream.__iter__ = MagicMock(return_value=iter([]))

        final_msg = FakeResponse(
            content=[FakeTextBlock(text="streamed")],
            usage=FakeUsage(input_tokens=200, output_tokens=80),
        )
        mock_stream.get_final_message.return_value = final_msg

        llm = AnthropicLLM(api_key="test-key")
        llm.on_token = lambda t: None
        result = llm.generate({"goal": "test", "history": []})

        self.assertIn("_usage", result)
        self.assertEqual(result["_usage"]["total_tokens"], 280)


class TestMultiTurnMessagesFormat(unittest.TestCase):
    """Test _build_messages generates correct multi-turn format."""

    def test_empty_history_single_user_message(self) -> None:
        wm = {
            "goal": "do something",
            "context": {},
            "summary_memory": "",
            "history": [],
        }
        msgs = AnthropicLLM._build_messages(wm)
        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0]["role"], "user")
        self.assertIn("Goal: do something", msgs[0]["content"])

    def test_summary_included_in_first_message(self) -> None:
        wm = {
            "goal": "test",
            "context": {"file": "a.py"},
            "summary_memory": "Previously read file a.py",
            "history": [],
        }
        msgs = AnthropicLLM._build_messages(wm)
        self.assertIn("Summary: Previously read file a.py", msgs[0]["content"])
        self.assertIn("Context:", msgs[0]["content"])

    def test_tool_call_history_produces_assistant_and_user(self) -> None:
        wm = {
            "goal": "read file",
            "context": {},
            "summary_memory": "",
            "history": [
                {
                    "turn": 1,
                    "action": {
                        "action_type": "tool_call",
                        "tool_name": "read_file",
                        "arguments": {"path": "/tmp/test.py"},
                    },
                    "observation": "tool=read_file; ok=True; output=content",
                    "tool_result": {"ok": True, "output": "content", "error": None},
                },
            ],
        }
        msgs = AnthropicLLM._build_messages(wm)

        # First msg: user with goal
        self.assertEqual(msgs[0]["role"], "user")
        # Second msg: assistant with tool call info
        self.assertEqual(msgs[1]["role"], "assistant")
        self.assertIn("read_file", msgs[1]["content"])
        # Third msg: user with tool result
        self.assertEqual(msgs[2]["role"], "user")
        # Verify alternating roles
        for i in range(1, len(msgs)):
            self.assertNotEqual(msgs[i]["role"], msgs[i - 1]["role"])

    def test_final_response_history(self) -> None:
        wm = {
            "goal": "test",
            "context": {},
            "summary_memory": "",
            "history": [
                {
                    "turn": 1,
                    "action": {
                        "action_type": "final_response",
                        "content": "I finished.",
                    },
                    "observation": "",
                    "tool_result": None,
                },
            ],
        }
        msgs = AnthropicLLM._build_messages(wm)
        # user, assistant (final_response), user (continuation)
        self.assertEqual(msgs[1]["role"], "assistant")
        self.assertEqual(msgs[1]["content"], "I finished.")
        self.assertEqual(msgs[2]["role"], "user")
        self.assertIn("Continue", msgs[2]["content"])

    def test_schema_feedback_appended(self) -> None:
        wm = {
            "goal": "test",
            "context": {},
            "summary_memory": "",
            "history": [
                {
                    "turn": 1,
                    "action": {
                        "action_type": "final_response",
                        "content": "done",
                    },
                    "observation": "",
                    "tool_result": None,
                },
            ],
            "schema_feedback": "Your output was invalid JSON",
        }
        msgs = AnthropicLLM._build_messages(wm)
        last_msg = msgs[-1]
        self.assertEqual(last_msg["role"], "user")
        self.assertIn("Your output was invalid JSON", last_msg["content"])

    def test_consecutive_final_responses_alternate_roles(self) -> None:
        """Bug A: Two consecutive final_response turns must not produce
        consecutive assistant messages."""
        wm = {
            "goal": "test goal",
            "context": {},
            "summary_memory": "",
            "history": [
                {
                    "turn": 1,
                    "action": {
                        "action_type": "final_response",
                        "content": "First response",
                    },
                    "observation": "First response",
                    "tool_result": None,
                },
                {
                    "turn": 2,
                    "action": {
                        "action_type": "final_response",
                        "content": "Second response",
                    },
                    "observation": "Second response",
                    "tool_result": None,
                },
            ],
        }
        msgs = AnthropicLLM._build_messages(wm)
        for i in range(1, len(msgs)):
            self.assertNotEqual(
                msgs[i]["role"],
                msgs[i - 1]["role"],
                f"Consecutive messages at index {i - 1} and {i} both have "
                f"role '{msgs[i]['role']}'",
            )

    def test_empty_history_with_schema_feedback(self) -> None:
        """Bug B: Empty history + schema_feedback must not produce
        consecutive user messages."""
        wm = {
            "goal": "test goal",
            "context": {},
            "summary_memory": "",
            "history": [],
            "schema_feedback": {
                "last_error": "Invalid output format",
                "required_types": ["tool_call", "final_response"],
            },
        }
        msgs = AnthropicLLM._build_messages(wm)
        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0]["role"], "user")
        self.assertIn("Schema feedback", msgs[0]["content"])
        self.assertIn("Invalid output format", msgs[0]["content"])

    def test_tool_result_uses_structured_data(self) -> None:
        """Bug C: tool_result content should use JSON format, not Python repr."""
        wm = {
            "goal": "read file",
            "context": {},
            "summary_memory": "",
            "history": [
                {
                    "turn": 1,
                    "action": {
                        "action_type": "tool_call",
                        "tool_name": "read_file",
                        "arguments": {"path": "/tmp/test.py"},
                    },
                    "observation": (
                        "tool=read_file; ok=True; "
                        "output={'content': 'hello'}; error=None"
                    ),
                    "tool_result": {
                        "ok": True,
                        "output": {"content": "hello"},
                        "error": None,
                        "retryable": False,
                        "blocked": False,
                        "attempts": 1,
                    },
                },
            ],
        }
        msgs = AnthropicLLM._build_messages(wm)
        # Find the user message with tool result (not the first goal message)
        tool_result_msgs = [
            m for m in msgs if m["role"] == "user" and "ok" in str(m["content"])
        ]
        self.assertTrue(len(tool_result_msgs) > 0, "No tool result message found")
        content = tool_result_msgs[0]["content"]
        # Should be valid JSON
        import json

        parsed = json.loads(content)
        self.assertTrue(parsed["ok"])
        self.assertEqual(parsed["output"]["content"], "hello")
        # Should NOT contain Python-style repr markers
        self.assertNotIn("{'content':", content)


class TestAnthropicLLMImportError(unittest.TestCase):
    """Test that missing anthropic package raises ImportError."""

    def test_raises_import_error_when_sdk_missing(self) -> None:
        with patch("src.harness.anthropic_llm.anthropic", None):
            with self.assertRaises(ImportError) as ctx:
                AnthropicLLM(api_key="test-key")
            self.assertIn("anthropic", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
