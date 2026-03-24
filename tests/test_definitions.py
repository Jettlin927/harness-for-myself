"""Tests for harness.definitions — definition file parsing."""

from __future__ import annotations

import tempfile
import unittest
import warnings
from pathlib import Path

from harness.definitions import (
    load_agent_definitions,
    load_skill_definitions,
    parse_definition_file,
)


class TestParseDefinitionFile(unittest.TestCase):
    """Tests for parse_definition_file."""

    def _write(self, tmpdir: str, name: str, content: str) -> Path:
        p = Path(tmpdir) / name
        p.write_text(content, encoding="utf-8")
        return p

    def test_parse_valid_agent_definition(self) -> None:
        """Complete frontmatter + body parses correctly."""
        with tempfile.TemporaryDirectory() as tmpdir:
            p = self._write(
                tmpdir,
                "agent.md",
                "---\nname: test-runner\ndescription: Runs tests\n"
                "max_steps: 10\ntrust_level: yolo\ntools: [bash, read_file]\n"
                "---\nYou are a test runner agent.\n",
            )
            meta, body = parse_definition_file(p)
            self.assertEqual(meta["name"], "test-runner")
            self.assertEqual(meta["description"], "Runs tests")
            self.assertEqual(meta["max_steps"], 10)
            self.assertEqual(meta["trust_level"], "yolo")
            self.assertEqual(meta["tools"], ["bash", "read_file"])
            self.assertEqual(body, "You are a test runner agent.\n")

    def test_parse_skill_definition(self) -> None:
        """Skill format with name/description + body."""
        with tempfile.TemporaryDirectory() as tmpdir:
            p = self._write(
                tmpdir,
                "skill.md",
                "---\nname: summarize\ndescription: Summarize text\n---\n"
                "Please summarize the following text.\n",
            )
            meta, body = parse_definition_file(p)
            self.assertEqual(meta["name"], "summarize")
            self.assertEqual(meta["description"], "Summarize text")
            self.assertEqual(body, "Please summarize the following text.\n")

    def test_parse_no_frontmatter(self) -> None:
        """No --- markers means entire file is body, empty metadata."""
        with tempfile.TemporaryDirectory() as tmpdir:
            p = self._write(tmpdir, "plain.md", "Just plain text.\nLine two.\n")
            meta, body = parse_definition_file(p)
            self.assertEqual(meta, {})
            self.assertEqual(body, "Just plain text.\nLine two.\n")

    def test_parse_empty_body(self) -> None:
        """Frontmatter present but body is empty."""
        with tempfile.TemporaryDirectory() as tmpdir:
            p = self._write(
                tmpdir,
                "empty.md",
                "---\nname: empty-agent\ndescription: No body\n---\n",
            )
            meta, body = parse_definition_file(p)
            self.assertEqual(meta["name"], "empty-agent")
            self.assertEqual(body, "")

    def test_parse_list_value(self) -> None:
        """tools: [bash, read_file] parses as list."""
        with tempfile.TemporaryDirectory() as tmpdir:
            p = self._write(
                tmpdir,
                "list.md",
                "---\ntools: [bash, read_file, glob_files]\n---\n",
            )
            meta, body = parse_definition_file(p)
            self.assertEqual(meta["tools"], ["bash", "read_file", "glob_files"])

    def test_parse_integer_value(self) -> None:
        """max_steps: 10 parses as int."""
        with tempfile.TemporaryDirectory() as tmpdir:
            p = self._write(tmpdir, "int.md", "---\nmax_steps: 10\n---\n")
            meta, body = parse_definition_file(p)
            self.assertIsInstance(meta["max_steps"], int)
            self.assertEqual(meta["max_steps"], 10)


class TestLoadAgentDefinitions(unittest.TestCase):
    """Tests for load_agent_definitions."""

    def test_load_agent_definitions(self) -> None:
        """Multiple .md files load correctly."""
        with tempfile.TemporaryDirectory() as tmpdir:
            hau = Path(tmpdir)
            agents_dir = hau / "agents"
            agents_dir.mkdir()

            (agents_dir / "runner.md").write_text(
                "---\nname: test-runner\ndescription: Runs tests\n"
                "trust_level: yolo\n---\nRun all tests.\n",
                encoding="utf-8",
            )
            (agents_dir / "linter.md").write_text(
                "---\nname: linter\ndescription: Lint code\ntools: [bash]\n---\nLint everything.\n",
                encoding="utf-8",
            )

            agents = load_agent_definitions(hau)
            self.assertEqual(len(agents), 2)
            names = {a.name for a in agents}
            self.assertEqual(names, {"test-runner", "linter"})

    def test_load_missing_directory(self) -> None:
        """Missing agents/ directory returns empty list."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = load_agent_definitions(Path(tmpdir))
            self.assertEqual(result, [])

    def test_invalid_trust_level_skipped(self) -> None:
        """File with invalid trust_level is skipped with a warning."""
        with tempfile.TemporaryDirectory() as tmpdir:
            hau = Path(tmpdir)
            agents_dir = hau / "agents"
            agents_dir.mkdir()

            (agents_dir / "bad.md").write_text(
                "---\nname: bad-agent\ndescription: Bad trust\ntrust_level: dangerous\n---\n",
                encoding="utf-8",
            )

            with warnings.catch_warnings(record=True) as w:
                warnings.simplefilter("always")
                agents = load_agent_definitions(hau)
                self.assertEqual(agents, [])
                self.assertTrue(any("trust_level" in str(warning.message) for warning in w))

    def test_missing_name_skipped(self) -> None:
        """File without name field is skipped with a warning."""
        with tempfile.TemporaryDirectory() as tmpdir:
            hau = Path(tmpdir)
            agents_dir = hau / "agents"
            agents_dir.mkdir()

            (agents_dir / "noname.md").write_text(
                "---\ndescription: No name here\n---\nBody text.\n",
                encoding="utf-8",
            )

            with warnings.catch_warnings(record=True) as w:
                warnings.simplefilter("always")
                agents = load_agent_definitions(hau)
                self.assertEqual(agents, [])
                self.assertTrue(any("name" in str(warning.message) for warning in w))


class TestLoadSkillDefinitions(unittest.TestCase):
    """Tests for load_skill_definitions."""

    def test_load_skill_definitions(self) -> None:
        """Multiple skill .md files load correctly."""
        with tempfile.TemporaryDirectory() as tmpdir:
            hau = Path(tmpdir)
            skills_dir = hau / "skills"
            skills_dir.mkdir()

            (skills_dir / "summarize.md").write_text(
                "---\nname: summarize\ndescription: Summarize text\n---\nSummarize it.\n",
                encoding="utf-8",
            )
            (skills_dir / "translate.md").write_text(
                "---\nname: translate\ndescription: Translate text\n---\nTranslate it.\n",
                encoding="utf-8",
            )

            skills = load_skill_definitions(hau)
            self.assertEqual(len(skills), 2)
            names = {s.name for s in skills}
            self.assertEqual(names, {"summarize", "translate"})

    def test_load_skills_missing_directory(self) -> None:
        """Missing skills/ directory returns empty list."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = load_skill_definitions(Path(tmpdir))
            self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
