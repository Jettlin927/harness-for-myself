"""Tests for SubAgentSpawner, trust resolution, tool whitelist, and use_skill."""

from __future__ import annotations

import unittest

from harness.agent import HarnessAgent, RunConfig
from harness.definitions import AgentDefinition, SkillDefinition
from harness.llm import ScriptedLLM
from harness.subagent import SubAgentSpawner, _resolve_trust, create_use_skill_callable


class TestTrustResolution(unittest.TestCase):
    """Trust level only decreases."""

    def test_trust_level_only_decreases(self) -> None:
        # Parent=ask, child wants yolo -> stays ask
        self.assertEqual(_resolve_trust("ask", "yolo"), "ask")
        # Parent=ask, child wants auto-edit -> stays ask
        self.assertEqual(_resolve_trust("ask", "auto-edit"), "ask")

    def test_trust_level_inherits_when_lower(self) -> None:
        # Parent=yolo, child wants auto-edit -> auto-edit (lower)
        self.assertEqual(_resolve_trust("yolo", "auto-edit"), "auto-edit")
        # Parent=yolo, child wants ask -> ask (lower)
        self.assertEqual(_resolve_trust("yolo", "ask"), "ask")
        # Parent=auto-edit, child wants ask -> ask (lower)
        self.assertEqual(_resolve_trust("auto-edit", "ask"), "ask")

    def test_trust_level_none_inherits_parent(self) -> None:
        self.assertEqual(_resolve_trust("yolo", None), "yolo")
        self.assertEqual(_resolve_trust("ask", None), "ask")

    def test_trust_level_same(self) -> None:
        self.assertEqual(_resolve_trust("ask", "ask"), "ask")
        self.assertEqual(_resolve_trust("yolo", "yolo"), "yolo")


class TestSpawnChildCompletes(unittest.TestCase):
    """Parent spawns child, child echoes and returns final_response."""

    def test_spawn_child_completes(self) -> None:
        # Child LLM script: one echo call, then final response
        child_llm = ScriptedLLM(
            [
                {"type": "tool_call", "tool_name": "echo", "arguments": {"text": "hello"}},
                {"type": "final_response", "content": "Child done."},
            ]
        )

        parent_config = RunConfig(
            max_steps=5,
            trust_level="yolo",
            agent_depth=0,
        )
        agent_def = AgentDefinition(
            name="helper",
            description="A helper agent",
        )

        spawner = SubAgentSpawner(
            parent_config=parent_config,
            parent_llm=child_llm,
            agent_definitions=[agent_def],
        )

        result = spawner({"goal": "Do something", "agent": "helper"})
        self.assertEqual(result["final_response"], "Child done.")
        self.assertEqual(result["stop_reason"], "final_response")
        self.assertGreaterEqual(result["turns"], 1)

    def test_spawn_without_agent_name(self) -> None:
        child_llm = ScriptedLLM(
            [
                {"type": "final_response", "content": "Done without agent."},
            ]
        )
        parent_config = RunConfig(max_steps=5, trust_level="yolo", agent_depth=0)
        spawner = SubAgentSpawner(
            parent_config=parent_config,
            parent_llm=child_llm,
            agent_definitions=[],
        )
        result = spawner({"goal": "Quick task"})
        self.assertEqual(result["final_response"], "Done without agent.")


class TestUnknownAgentRaises(unittest.TestCase):
    def test_unknown_agent_raises(self) -> None:
        parent_config = RunConfig(max_steps=5, trust_level="yolo", agent_depth=0)
        child_llm = ScriptedLLM([])
        spawner = SubAgentSpawner(
            parent_config=parent_config,
            parent_llm=child_llm,
            agent_definitions=[],
        )
        with self.assertRaises(ValueError) as ctx:
            spawner({"goal": "Do something", "agent": "nonexistent"})
        self.assertIn("Unknown agent", str(ctx.exception))

    def test_empty_goal_raises(self) -> None:
        parent_config = RunConfig(max_steps=5, trust_level="yolo", agent_depth=0)
        child_llm = ScriptedLLM([])
        spawner = SubAgentSpawner(
            parent_config=parent_config,
            parent_llm=child_llm,
            agent_definitions=[],
        )
        with self.assertRaises(ValueError) as ctx:
            spawner({"goal": ""})
        self.assertIn("non-empty 'goal'", str(ctx.exception))


class TestToolWhitelist(unittest.TestCase):
    def test_tool_whitelist(self) -> None:
        child_llm = ScriptedLLM(
            [
                {"type": "tool_call", "tool_name": "echo", "arguments": {"text": "hi"}},
                {"type": "final_response", "content": "Done."},
            ]
        )
        parent_config = RunConfig(max_steps=5, trust_level="yolo", agent_depth=0)
        agent_def = AgentDefinition(
            name="restricted",
            description="Only echo allowed",
            tools=["echo"],
        )
        spawner = SubAgentSpawner(
            parent_config=parent_config,
            parent_llm=child_llm,
            agent_definitions=[agent_def],
        )
        result = spawner({"goal": "Echo only", "agent": "restricted"})
        self.assertEqual(result["final_response"], "Done.")


class TestDepthLimit(unittest.TestCase):
    def test_depth_limit(self) -> None:
        """agent_depth=3 should not register spawn_agent tool."""
        llm = ScriptedLLM(
            [
                {"type": "final_response", "content": "Done."},
            ]
        )
        config = RunConfig(
            max_steps=5,
            trust_level="yolo",
            agent_depth=3,
            project_root="/tmp/fake_hau_project",
        )
        agent = HarnessAgent(llm=llm, config=config)
        self.assertNotIn("spawn_agent", agent.tools._tools)

    def test_depth_below_limit_registers(self) -> None:
        """agent_depth=2 with project_root should register spawn_agent."""
        llm = ScriptedLLM(
            [
                {"type": "final_response", "content": "Done."},
            ]
        )
        config = RunConfig(
            max_steps=5,
            trust_level="yolo",
            agent_depth=2,
            project_root="/tmp/fake_hau_project",
        )
        agent = HarnessAgent(llm=llm, config=config)
        self.assertIn("spawn_agent", agent.tools._tools)


class TestUseSkill(unittest.TestCase):
    def test_use_skill(self) -> None:
        skill = SkillDefinition(
            name="review",
            description="Code review skill",
            body="Review the code carefully.",
        )
        fn = create_use_skill_callable([skill])
        result = fn({"name": "review"})
        self.assertEqual(result["skill"], "review")
        self.assertEqual(result["instructions"], "Review the code carefully.")

    def test_use_skill_unknown(self) -> None:
        fn = create_use_skill_callable([])
        with self.assertRaises(ValueError) as ctx:
            fn({"name": "nonexistent"})
        self.assertIn("Unknown skill", str(ctx.exception))

    def test_use_skill_empty_name(self) -> None:
        fn = create_use_skill_callable([])
        with self.assertRaises(ValueError) as ctx:
            fn({"name": ""})
        self.assertIn("non-empty 'name'", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
