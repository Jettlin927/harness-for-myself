from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.harness.llm import DeepSeekLLM


class DeepSeekLLMTests(unittest.TestCase):
    def test_generate_happy_path_returns_final_response(self) -> None:
        captured: dict[str, object] = {}

        def fake_transport(
            payload: dict[str, object], api_key: str, base_url: str
        ) -> dict[str, object]:
            captured["payload"] = payload
            captured["api_key"] = api_key
            captured["base_url"] = base_url
            return {
                "choices": [
                    {
                        "message": {
                            "content": '{"type":"final_response","content":"done"}',
                        }
                    }
                ]
            }

        llm = DeepSeekLLM(api_key="secret", transport=fake_transport)

        result = llm.generate(
            {
                "goal": "finish task",
                "context": {"user": "jett"},
                "summary_memory": "constraint: stay safe",
                "history": [{"turn": 1, "observation": "tool ok"}],
            }
        )

        self.assertEqual(result["type"], "final_response")
        self.assertEqual(result["content"], "done")
        self.assertEqual(captured["api_key"], "secret")
        self.assertEqual(captured["base_url"], "https://api.deepseek.com")
        self.assertEqual(captured["payload"]["model"], "deepseek-chat")

    def test_generate_uses_environment_variable_when_available(self) -> None:
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "env-secret"}, clear=False):
            llm = DeepSeekLLM(
                transport=lambda payload, api_key, base_url: {
                    "choices": [
                        {"message": {"content": '{"type":"final_response","content":"env ok"}'}}
                    ]
                }
            )
            result = llm.generate(
                {"goal": "demo", "context": {}, "summary_memory": "", "history": []}
            )
            self.assertEqual(result["content"], "env ok")

    def test_generate_uses_dotenv_file_when_available(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("DEEPSEEK_API_KEY=dotenv-secret\n", encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                llm = DeepSeekLLM(
                    env_path=env_path,
                    transport=lambda payload, api_key, base_url: {
                        "choices": [
                            {
                                "message": {
                                    "content": '{"type":"final_response","content":"dotenv ok"}'
                                }
                            }
                        ]
                    },
                )
                result = llm.generate(
                    {"goal": "demo", "context": {}, "summary_memory": "", "history": []}
                )

        self.assertEqual(result["content"], "dotenv ok")

    def test_generate_prompts_for_api_key_when_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            with patch.dict(os.environ, {}, clear=True):
                with patch("src.harness.llm.getpass", return_value="prompt-secret") as prompt:
                    llm = DeepSeekLLM(
                        env_path=env_path,
                        transport=lambda payload, api_key, base_url: {
                            "choices": [
                                {
                                    "message": {
                                        "content": '{"type":"final_response","content":"prompt ok"}'
                                    }
                                }
                            ]
                        },
                    )
                    result = llm.generate(
                        {"goal": "demo", "context": {}, "summary_memory": "", "history": []}
                    )
                    saved_env = env_path.read_text(encoding="utf-8")

        self.assertEqual(result["content"], "prompt ok")
        prompt.assert_called_once()
        self.assertIn("DEEPSEEK_API_KEY=prompt-secret", saved_env)

    def test_generate_rejects_empty_prompted_api_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            with patch.dict(os.environ, {}, clear=True):
                with patch("src.harness.llm.getpass", return_value=""):
                    llm = DeepSeekLLM(
                        env_path=env_path,
                        transport=lambda payload, api_key, base_url: {},
                    )
                    with self.assertRaises(ValueError):
                        llm.generate(
                            {"goal": "demo", "context": {}, "summary_memory": "", "history": []}
                        )

    def test_generate_handles_empty_choice_list(self) -> None:
        llm = DeepSeekLLM(
            api_key="secret",
            transport=lambda payload, api_key, base_url: {"choices": []},
        )

        with self.assertRaises(ValueError):
            llm.generate({"goal": "demo", "context": {}, "summary_memory": "", "history": []})

    def test_generate_wraps_plain_text_response_as_final_response(self) -> None:
        llm = DeepSeekLLM(
            api_key="secret",
            transport=lambda payload, api_key, base_url: {
                "choices": [{"message": {"content": "plain answer"}}]
            },
        )

        result = llm.generate({"goal": "demo", "context": {}, "summary_memory": "", "history": []})

        self.assertEqual(result["type"], "final_response")
        self.assertEqual(result["content"], "plain answer")

    def test_set_tool_schemas_updates_tool_names(self) -> None:
        """set_tool_schemas populates _tool_names from schema list."""
        mock_response = {
            "choices": [{"message": {"content": '{"type":"final_response","content":"ok"}'}}]
        }
        llm = DeepSeekLLM(
            api_key="test",
            transport=lambda *a: mock_response,
        )
        llm.set_tool_schemas(
            [
                {"name": "read_file", "description": "...", "input_schema": {}},
                {"name": "bash", "description": "...", "input_schema": {}},
            ]
        )
        self.assertEqual(llm._tool_names, ["read_file", "bash"])

    def test_build_messages_uses_dynamic_tool_names(self) -> None:
        """After set_tool_schemas, _build_messages uses dynamic names."""
        captured: dict[str, object] = {}

        def fake_transport(
            payload: dict[str, object], api_key: str, base_url: str
        ) -> dict[str, object]:
            captured["payload"] = payload
            return {
                "choices": [{"message": {"content": '{"type":"final_response","content":"ok"}'}}]
            }

        llm = DeepSeekLLM(api_key="test", transport=fake_transport)
        llm.set_tool_schemas(
            [
                {"name": "read_file", "description": "...", "input_schema": {}},
                {"name": "bash", "description": "...", "input_schema": {}},
            ]
        )
        llm.generate({"goal": "demo", "context": {}, "summary_memory": "", "history": []})
        messages = captured["payload"]["messages"]
        system_content = messages[0]["content"]
        self.assertIn("read_file", system_content)
        self.assertIn("bash", system_content)
        # Should NOT contain old hardcoded tools
        self.assertNotIn("echo", system_content)


class TestDeepSeekRetry(unittest.TestCase):
    """Test retry logic for transient transport errors."""

    @patch("src.harness.llm.time")
    def test_transient_error_retries(self, mock_time: unittest.mock.MagicMock) -> None:
        """Transport fails once with 500, then succeeds on retry."""
        call_count = 0

        def flaky_transport(
            payload: dict[str, object], api_key: str, base_url: str
        ) -> dict[str, object]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("DeepSeek API returned HTTP 500: internal error")
            return {
                "choices": [{"message": {"content": '{"type":"final_response","content":"ok"}'}}]
            }

        llm = DeepSeekLLM(api_key="secret", transport=flaky_transport)
        result = llm.generate({"goal": "test", "context": {}, "summary_memory": "", "history": []})

        self.assertEqual(result["type"], "final_response")
        self.assertEqual(result["content"], "ok")
        self.assertEqual(call_count, 2)
        mock_time.sleep.assert_called_once_with(1)

    @patch("src.harness.llm.time")
    def test_permanent_error_raises(self, mock_time: unittest.mock.MagicMock) -> None:
        """A 400 error should not be retried."""

        def bad_transport(
            payload: dict[str, object], api_key: str, base_url: str
        ) -> dict[str, object]:
            raise RuntimeError("DeepSeek API returned HTTP 400: bad request")

        llm = DeepSeekLLM(api_key="secret", transport=bad_transport)
        with self.assertRaises(RuntimeError) as ctx:
            llm.generate({"goal": "test", "context": {}, "summary_memory": "", "history": []})

        self.assertIn("HTTP 400", str(ctx.exception))
        mock_time.sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
