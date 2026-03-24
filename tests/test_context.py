"""Tests for src/harness/context.py."""
from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from harness.context import (
    _MAX_CONTEXT_LINES,
    _detect_project_type,
    _load_context_md,
    _load_git_state,
    load_project_context,
)


class TestLoadContextMd(unittest.TestCase):
    """Tests for _load_context_md."""

    def test_no_hau_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(_load_context_md(Path(tmp)))

    def test_reads_context_md(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hau = root / ".hau"
            hau.mkdir()
            content = "# My Project\n\nSome context here.\n"
            (hau / "CONTEXT.md").write_text(content, encoding="utf-8")

            result = _load_context_md(root)
            self.assertEqual(result, content)

    def test_truncates_long_context(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hau = root / ".hau"
            hau.mkdir()

            total = _MAX_CONTEXT_LINES + 100
            lines = [f"line {i}" for i in range(total)]
            (hau / "CONTEXT.md").write_text(
                "\n".join(lines), encoding="utf-8"
            )

            result = _load_context_md(root)
            assert result is not None
            self.assertIn(
                f"[truncated: showing first {_MAX_CONTEXT_LINES}"
                f" of {total} lines]",
                result,
            )
            # Exactly _MAX_CONTEXT_LINES of content + 1 truncation notice
            result_lines = result.splitlines()
            self.assertEqual(len(result_lines), _MAX_CONTEXT_LINES + 1)


class TestDetectProjectType(unittest.TestCase):
    """Tests for _detect_project_type."""

    def test_python_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pyproject.toml").touch()
            (root / "uv.lock").touch()

            result = _detect_project_type(root)
            self.assertIn("python", result["languages"])
            self.assertEqual(result["package_manager"], "uv")
            self.assertEqual(result["test_command"], "uv run pytest")
            self.assertEqual(result["build_file"], "pyproject.toml")

    def test_python_without_uv(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pyproject.toml").touch()

            result = _detect_project_type(root)
            self.assertEqual(result["package_manager"], "pip")

    def test_node_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "package.json").touch()

            result = _detect_project_type(root)
            self.assertIn("javascript", result["languages"])
            self.assertEqual(result["package_manager"], "npm")

    def test_node_yarn(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "package.json").touch()
            (root / "yarn.lock").touch()

            result = _detect_project_type(root)
            self.assertEqual(result["package_manager"], "yarn")

    def test_rust_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "Cargo.toml").touch()

            result = _detect_project_type(root)
            self.assertIn("rust", result["languages"])
            self.assertEqual(result["package_manager"], "cargo")

    def test_go_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "go.mod").touch()

            result = _detect_project_type(root)
            self.assertIn("go", result["languages"])

    def test_empty_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = _detect_project_type(Path(tmp))
            self.assertEqual(result["languages"], [])
            self.assertEqual(result["package_manager"], "none")
            self.assertEqual(result["build_file"], "")

    def test_makefile_detected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "Makefile").touch()

            result = _detect_project_type(root)
            self.assertTrue(result.get("has_makefile"))


class TestLoadGitState(unittest.TestCase):
    """Tests for _load_git_state."""

    def test_non_git_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(_load_git_state(Path(tmp)))

    def test_git_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(
                ["git", "init"], cwd=root, capture_output=True, check=True
            )
            subprocess.run(
                ["git", "config", "user.email", "test@test.com"],
                cwd=root,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Test"],
                cwd=root,
                capture_output=True,
                check=True,
            )
            (root / "README.md").write_text("hello", encoding="utf-8")
            subprocess.run(
                ["git", "add", "."], cwd=root, capture_output=True, check=True
            )
            subprocess.run(
                ["git", "commit", "-m", "init"],
                cwd=root,
                capture_output=True,
                check=True,
            )

            result = _load_git_state(root)
            self.assertIsNotNone(result)
            assert result is not None
            self.assertIn(result["branch"], ("main", "master"))
            self.assertIn("init", result["recent_commits"])


class TestLoadProjectContext(unittest.TestCase):
    """Integration test for load_project_context."""

    def test_full_context(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # Set up git
            subprocess.run(
                ["git", "init"], cwd=root, capture_output=True, check=True
            )
            subprocess.run(
                ["git", "config", "user.email", "test@test.com"],
                cwd=root,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Test"],
                cwd=root,
                capture_output=True,
                check=True,
            )
            (root / "README.md").write_text("hello", encoding="utf-8")
            subprocess.run(
                ["git", "add", "."], cwd=root, capture_output=True, check=True
            )
            subprocess.run(
                ["git", "commit", "-m", "init"],
                cwd=root,
                capture_output=True,
                check=True,
            )

            # Set up project files
            (root / "pyproject.toml").touch()
            (root / "uv.lock").touch()
            (root / "Makefile").touch()

            # Set up context
            hau = root / ".hau"
            hau.mkdir()
            (hau / "CONTEXT.md").write_text(
                "# Context\n", encoding="utf-8"
            )

            ctx = load_project_context(root)

            self.assertEqual(ctx["project_root"], str(root.resolve()))
            self.assertEqual(ctx["context_md"], "# Context\n")
            self.assertIsNotNone(ctx["git"])
            self.assertIn("python", ctx["project_type"]["languages"])
            self.assertEqual(ctx["project_type"]["package_manager"], "uv")
            self.assertTrue(ctx["project_type"].get("has_makefile"))


if __name__ == "__main__":
    unittest.main()
