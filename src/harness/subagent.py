"""SubAgentSpawner — manages child agent spawning as a tool callable."""

from __future__ import annotations

from typing import Any

from .definitions import AgentDefinition, SkillDefinition

_TRUST_ORDER = {"ask": 0, "auto-edit": 1, "yolo": 2}


def _resolve_trust(parent: str, child: str | None) -> str:
    """Resolve effective trust level: child can never exceed parent."""
    if child is None:
        return parent
    p, c = _TRUST_ORDER.get(parent, 0), _TRUST_ORDER.get(child, 0)
    return child if c <= p else parent


class SubAgentSpawner:
    """Manages child agent spawning as a tool callable."""

    def __init__(
        self,
        parent_config: Any,
        parent_llm: Any,
        agent_definitions: list[AgentDefinition],
        project_context: dict[str, Any] | None = None,
    ) -> None:
        self._parent_config = parent_config
        self._parent_llm = parent_llm
        self._definitions = {d.name: d for d in agent_definitions}
        self._project_context = project_context or {}
        self._on_approve: Any = None

    def set_approve_callback(self, on_approve: Any) -> None:
        self._on_approve = on_approve

    def __call__(self, arguments: dict[str, Any]) -> Any:
        """spawn_agent tool callable."""
        goal = arguments.get("goal")
        if not isinstance(goal, str) or not goal.strip():
            raise ValueError("spawn_agent requires a non-empty 'goal'.")

        agent_name = arguments.get("agent")
        definition = self._definitions.get(agent_name) if agent_name else None

        if agent_name and definition is None:
            available = ", ".join(self._definitions.keys()) or "(none)"
            raise ValueError(f"Unknown agent '{agent_name}'. Available: {available}")

        child_config = self._build_child_config(definition, arguments)
        child = self._create_child_agent(child_config, definition)

        result = child.run(
            goal=goal,
            context=self._project_context,
            on_approve=self._on_approve,
        )

        return {
            "final_response": result.final_response,
            "stop_reason": result.stop_reason,
            "turns": len(result.turns),
        }

    def _build_child_config(
        self,
        definition: AgentDefinition | None,
        arguments: dict[str, Any],
    ) -> Any:
        from .agent import RunConfig

        parent = self._parent_config
        child_trust = definition.trust_level if definition else None
        effective_trust = _resolve_trust(parent.trust_level, child_trust)

        max_steps = parent.max_steps
        if definition and definition.max_steps is not None:
            max_steps = definition.max_steps
        if "max_steps" in arguments and isinstance(arguments["max_steps"], int):
            max_steps = arguments["max_steps"]

        return RunConfig(
            max_steps=max_steps,
            log_dir=parent.log_dir,
            max_history_turns=parent.max_history_turns,
            schema_retry_limit=parent.schema_retry_limit,
            max_budget=parent.max_budget,
            max_failures=parent.max_failures,
            tool_retry_limit=parent.tool_retry_limit,
            snapshot_dir=parent.snapshot_dir,
            dangerous_tools=parent.dangerous_tools,
            goal_reached_token=parent.goal_reached_token,
            allowed_write_roots=parent.allowed_write_roots,
            project_root=parent.project_root,
            allow_bash=parent.allow_bash,
            max_tokens_budget=parent.max_tokens_budget,
            trust_level=effective_trust,
            agent_depth=parent.agent_depth + 1,
        )

    def _create_child_agent(
        self,
        child_config: Any,
        definition: AgentDefinition | None,
    ) -> Any:
        from .agent import HarnessAgent

        child = HarnessAgent(llm=self._parent_llm, config=child_config)

        # Apply tool whitelist if defined
        if definition and definition.tools is not None:
            allowed = set(definition.tools)
            child.tools._tools = {k: v for k, v in child.tools._tools.items() if k in allowed}
            child.tools._schemas = {k: v for k, v in child.tools._schemas.items() if k in allowed}

        return child


def create_use_skill_callable(
    skill_definitions: list[SkillDefinition],
) -> Any:
    """Create a use_skill tool callable from skill definitions."""
    skills = {s.name: s for s in skill_definitions}

    def use_skill(arguments: dict[str, Any]) -> Any:
        name = arguments.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("use_skill requires a non-empty 'name'.")
        skill = skills.get(name)
        if skill is None:
            available = ", ".join(skills.keys()) or "(none)"
            raise ValueError(f"Unknown skill '{name}'. Available: {available}")
        return {"skill": skill.name, "instructions": skill.body}

    return use_skill
