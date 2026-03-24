from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.harness.coding_tools import edit_file, read_file, run_bash


class ReadFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp_dir.name)

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_read_small_file(self) -> None:
        p = self.root / "small.txt"
        p.write_text("line1\nline2\nline3\n", encoding="utf-8")
        result = read_file({"path": str(p)})
        self.assertEqual(result["lines"], 3)
        self.assertFalse(result["truncated"])
        self.assertIn("line1", result["content"])

    def test_read_with_offset_and_limit(self) -> None:
        p = self.root / "nums.txt"
        p.write_text("\n".join(f"L{i}" for i in range(1, 11)), encoding="utf-8")
        result = read_file({"path": str(p), "offset": 3, "limit": 2})
        self.assertIn("L3", result["content"])
        self.assertIn("L4", result["content"])
        self.assertNotIn("L2", result["content"])
        self.assertNotIn("L5", result["content"])

    def test_large_file_truncation(self) -> None:
        p = self.root / "big.txt"
        p.write_text("\n".join(f"row{i}" for i in range(500)), encoding="utf-8")
        result = read_file({"path": str(p), "limit": 10})
        self.assertTrue(result["truncated"])
        self.assertIn("[truncated:", result["content"])
        self.assertIn("of 500", result["content"])

    def test_relative_path_raises(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            read_file({"path": "relative/file.txt"})
        self.assertIn("absolute", str(ctx.exception))

    def test_missing_file_raises(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            read_file({"path": str(self.root / "nope.txt")})
        self.assertIn("not found", str(ctx.exception).lower())


class EditFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp_dir.name)

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_single_match_replacement(self) -> None:
        p = self.root / "code.py"
        p.write_text("hello world\n", encoding="utf-8")
        result = edit_file(
            {
                "path": str(p),
                "old_text": "hello",
                "new_text": "goodbye",
            }
        )
        self.assertEqual(result["replacements"], 1)

    def test_old_text_not_found_raises(self) -> None:
        p = self.root / "code.py"
        p.write_text("hello world\n", encoding="utf-8")
        with self.assertRaises(ValueError) as ctx:
            edit_file(
                {
                    "path": str(p),
                    "old_text": "missing",
                    "new_text": "x",
                }
            )
        self.assertIn("not found", str(ctx.exception))

    def test_multiple_matches_raises(self) -> None:
        p = self.root / "dup.py"
        p.write_text("aaa\naaa\n", encoding="utf-8")
        with self.assertRaises(ValueError) as ctx:
            edit_file(
                {
                    "path": str(p),
                    "old_text": "aaa",
                    "new_text": "bbb",
                }
            )
        self.assertIn("2 matches", str(ctx.exception))

    def test_replacement_content_correct(self) -> None:
        p = self.root / "verify.txt"
        p.write_text("foo bar baz\n", encoding="utf-8")
        edit_file(
            {
                "path": str(p),
                "old_text": "bar",
                "new_text": "qux",
            }
        )
        self.assertEqual(p.read_text(encoding="utf-8"), "foo qux baz\n")


class RunBashTests(unittest.TestCase):
    def test_echo_command(self) -> None:
        result = run_bash({"command": "echo hello"})
        self.assertEqual(result["returncode"], 0)
        self.assertIn("hello", result["stdout"])

    def test_failing_command(self) -> None:
        result = run_bash({"command": "exit 42"})
        self.assertEqual(result["returncode"], 42)

    def test_timeout_handling(self) -> None:
        result = run_bash({"command": "sleep 60", "timeout": 1})
        self.assertEqual(result["returncode"], -1)
        self.assertIn("timed out", result["stderr"])


if __name__ == "__main__":
    unittest.main()
