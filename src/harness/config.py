"""Versioned strategy configuration for the agent harness.

A :class:`StrategyConfig` captures the tunable parameters that define a named
strategy version.  Config files (JSON) live in ``configs/`` by convention and
are referenced by version string, enabling side-by-side comparison of eval
results across strategy iterations.

Example::

    config = StrategyConfig.load("configs/default.json")
    run_config = config.to_run_config()

    # or use the built-in default
    config = StrategyConfig.default()
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict


@dataclass
class StrategyConfig:
    """A versioned set of agent run parameters.

    Attributes:
        version: Human-readable version tag (e.g. ``"v1.0"``).
        description: Free-text note describing what changed in this version.
        max_steps: Maps to :attr:`~harness.agent.RunConfig.max_steps`.
        max_budget: Maps to :attr:`~harness.agent.RunConfig.max_budget`.
        max_failures: Maps to :attr:`~harness.agent.RunConfig.max_failures`.
        max_history_turns: Maps to
            :attr:`~harness.agent.RunConfig.max_history_turns`.
        goal_reached_token: Maps to
            :attr:`~harness.agent.RunConfig.goal_reached_token`.
    """

    version: str = "v1.0"
    description: str = ""
    max_steps: int = 8
    max_budget: int | None = None
    max_failures: int | None = 3
    max_history_turns: int = 8
    goal_reached_token: str | None = None

    # ------------------------------------------------------------------
    # Constructors
    # ------------------------------------------------------------------

    @classmethod
    def default(cls) -> StrategyConfig:
        """Return the built-in baseline strategy (matches RunConfig defaults)."""
        return cls(
            version="v1.0",
            description="Baseline strategy — mirrors RunConfig defaults.",
        )

    @classmethod
    def load(cls, path: str | Path) -> StrategyConfig:
        """Load a :class:`StrategyConfig` from a JSON file.

        The JSON object may include any subset of the dataclass fields; missing
        fields fall back to their defaults.

        Args:
            path: Path to the JSON config file.

        Returns:
            A populated :class:`StrategyConfig` instance.

        Raises:
            FileNotFoundError: If ``path`` does not exist.
            ValueError: If the JSON is invalid or contains unexpected fields.
        """
        raw: Dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        unknown = set(raw) - known
        if unknown:
            raise ValueError(f"Unknown fields in config file: {unknown}")
        return cls(**{k: v for k, v in raw.items()})

    # ------------------------------------------------------------------
    # Conversion
    # ------------------------------------------------------------------

    def to_run_config(self) -> Any:
        """Convert to a :class:`~harness.agent.RunConfig`.

        Returns:
            A :class:`~harness.agent.RunConfig` initialised from this config's
            fields.  Fields not present on :class:`~harness.agent.RunConfig`
            (``version``, ``description``) are ignored.
        """
        from .agent import RunConfig

        return RunConfig(
            max_steps=self.max_steps,
            max_budget=self.max_budget,
            max_failures=self.max_failures,
            max_history_turns=self.max_history_turns,
            goal_reached_token=self.goal_reached_token,
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a plain dict."""
        return asdict(self)
