"""HAU — Harness for Yourself."""

from .agent import HarnessAgent, RunConfig
from .config import StrategyConfig
from .eval import EvalCase, EvalReport, EvalRunner
from .llm import DeepSeekLLM, RuleBasedLLM, ScriptedLLM, build_system_prompt
from .session import SessionManager, SessionState
from .tools import RetryableToolError

__all__ = [
    "HarnessAgent",
    "RunConfig",
    "StrategyConfig",
    "RuleBasedLLM",
    "ScriptedLLM",
    "DeepSeekLLM",
    "build_system_prompt",
    "RetryableToolError",
    "EvalCase",
    "EvalRunner",
    "EvalReport",
    "SessionManager",
    "SessionState",
]

try:
    from .anthropic_llm import AnthropicLLM  # noqa: F401

    __all__.append("AnthropicLLM")
except ImportError:
    pass
