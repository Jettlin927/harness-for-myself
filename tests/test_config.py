from __future__ import annotations

import json
import tempfile
import unittest

from src.harness import HarnessAgent, RuleBasedLLM, RunConfig
from src.harness.config import StrategyConfig
from src.harness.eval import EvalCase, EvalRunner


class StrategyConfigDefaultTests(unittest.TestCase):
    def test_default_returns_instance(self) -> None:
        cfg = StrategyConfig.default()
        self.assertIsInstance(cfg, StrategyConfig)
        self.assertEqual(cfg.version, "v1.0")


class StrategyConfigLoadTests(unittest.TestCase):
    def test_load_from_file(self) -> None:
        data = {
            "version": "v2.0",
            "description": "test config",
            "max_steps": 5,
            "max_budget": 100,
            "max_failures": 2,
            "max_history_turns": 4,
            "goal_reached_token": "DONE",
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f)
            tmp_path = f.name

        cfg = StrategyConfig.load(tmp_path)
        self.assertEqual(cfg.version, "v2.0")
        self.assertEqual(cfg.description, "test config")
        self.assertEqual(cfg.max_steps, 5)
        self.assertEqual(cfg.max_budget, 100)
        self.assertEqual(cfg.max_failures, 2)
        self.assertEqual(cfg.max_history_turns, 4)
        self.assertEqual(cfg.goal_reached_token, "DONE")

    def test_load_partial_file(self) -> None:
        data = {"version": "v3.0", "max_steps": 12}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f)
            tmp_path = f.name

        cfg = StrategyConfig.load(tmp_path)
        self.assertEqual(cfg.version, "v3.0")
        self.assertEqual(cfg.max_steps, 12)
        # 缺失字段应回落到 dataclass 默认值
        default = StrategyConfig()
        self.assertEqual(cfg.description, default.description)
        self.assertEqual(cfg.max_budget, default.max_budget)
        self.assertEqual(cfg.max_failures, default.max_failures)
        self.assertEqual(cfg.max_history_turns, default.max_history_turns)
        self.assertEqual(cfg.goal_reached_token, default.goal_reached_token)

    def test_load_unknown_field_raises(self) -> None:
        data = {"version": "v1.0", "unknown_field": "oops"}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f)
            tmp_path = f.name

        with self.assertRaises(ValueError):
            StrategyConfig.load(tmp_path)


class StrategyConfigToRunConfigTests(unittest.TestCase):
    def test_to_run_config_mapping(self) -> None:
        cfg = StrategyConfig(
            version="v1.0",
            description="mapping test",
            max_steps=10,
            max_budget=50,
            max_failures=4,
            max_history_turns=6,
            goal_reached_token="FINISHED",
        )
        run_cfg = cfg.to_run_config()
        self.assertEqual(run_cfg.max_steps, 10)
        self.assertEqual(run_cfg.max_budget, 50)
        self.assertEqual(run_cfg.max_failures, 4)
        self.assertEqual(run_cfg.max_history_turns, 6)
        self.assertEqual(run_cfg.goal_reached_token, "FINISHED")


class EvalReportConfigVersionTests(unittest.TestCase):
    def _make_runner(self) -> EvalRunner:
        with tempfile.TemporaryDirectory() as tmp:
            agent = HarnessAgent(
                llm=RuleBasedLLM(),
                config=RunConfig(log_dir=tmp),
            )
            # 保存 agent 引用，不依赖 context manager 外的 tmp 目录
            self._tmp = tempfile.mkdtemp()
            agent = HarnessAgent(
                llm=RuleBasedLLM(),
                config=RunConfig(log_dir=self._tmp),
            )
        return EvalRunner(agent)

    def _simple_cases(self) -> list[EvalCase]:
        return [EvalCase(id="hello", goal="hello world")]

    def test_eval_report_config_version(self) -> None:
        runner = self._make_runner()
        report = runner.run(self._simple_cases(), config_version="v1.0")
        self.assertEqual(report.config_version, "v1.0")

    def test_eval_report_default_config_version(self) -> None:
        runner = self._make_runner()
        report = runner.run(self._simple_cases())
        self.assertEqual(report.config_version, "unversioned")


if __name__ == "__main__":
    unittest.main()
