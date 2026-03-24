from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.harness.coding_tools import (
    edit_file,
    glob_files,
    grep_search,
    list_directory,
    read_file,
    run_bash,
    write_file,
)


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

    def test_read_binary_file_raises(self) -> None:
        """Reading a binary file raises ValueError."""
        binary_path = self.root / "binary.bin"
        binary_path.write_bytes(b"\x80\x81\x82\xff\xfe")
        with self.assertRaises(ValueError) as cm:
            read_file({"path": str(binary_path)})
        self.assertIn("not valid UTF-8", str(cm.exception))


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

    def test_edit_file_returns_diff(self) -> None:
        """edit_file should return a diff field with unified diff format."""
        p = self.root / "diffme.txt"
        p.write_text("alpha\nbeta\ngamma\n", encoding="utf-8")
        result = edit_file(
            {
                "path": str(p),
                "old_text": "beta",
                "new_text": "BETA",
            }
        )
        self.assertIn("diff", result)
        diff = result["diff"]
        self.assertIn("--- a/diffme.txt", diff)
        self.assertIn("+++ b/diffme.txt", diff)
        self.assertIn("-beta", diff)
        self.assertIn("+BETA", diff)

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


class WriteFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp_dir.name)

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_create_new_file(self) -> None:
        p = self.root / "new.txt"
        result = write_file({"path": str(p), "content": "hello world"})
        self.assertEqual(result["bytes_written"], len("hello world".encode("utf-8")))
        self.assertEqual(p.read_text(encoding="utf-8"), "hello world")

    def test_creates_parent_dirs(self) -> None:
        p = self.root / "a" / "b" / "c" / "deep.txt"
        result = write_file({"path": str(p), "content": "nested"})
        self.assertTrue(p.exists())
        self.assertEqual(p.read_text(encoding="utf-8"), "nested")
        self.assertIn("bytes_written", result)

    def test_refuses_overwrite(self) -> None:
        p = self.root / "existing.txt"
        p.write_text("original", encoding="utf-8")
        with self.assertRaises(ValueError) as ctx:
            write_file({"path": str(p), "content": "overwrite"})
        self.assertIn("edit_file", str(ctx.exception))

    def test_relative_path_raises(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            write_file({"path": "relative/file.txt", "content": "data"})
        self.assertIn("absolute", str(ctx.exception))

    def test_missing_path_raises(self) -> None:
        with self.assertRaises(ValueError):
            write_file({"path": "", "content": "data"})
        with self.assertRaises(ValueError):
            write_file({"path": 123, "content": "data"})  # type: ignore[dict-item]


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


class GlobFilesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp_dir.name)
        # Create a small file tree
        (self.root / "a.py").write_text("a", encoding="utf-8")
        (self.root / "b.txt").write_text("b", encoding="utf-8")
        sub = self.root / "sub"
        sub.mkdir()
        (sub / "c.py").write_text("c", encoding="utf-8")
        (sub / "d.py").write_text("d", encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_basic_glob(self) -> None:
        result = glob_files({"pattern": "*.py", "root": str(self.root)})
        self.assertEqual(result["total"], 1)
        self.assertIn("a.py", result["matches"][0])

    def test_recursive_glob(self) -> None:
        result = glob_files({"pattern": "**/*.py", "root": str(self.root)})
        self.assertEqual(result["total"], 3)
        self.assertFalse(result["truncated"])

    def test_empty_match(self) -> None:
        result = glob_files({"pattern": "*.rs", "root": str(self.root)})
        self.assertEqual(result["total"], 0)
        self.assertEqual(result["matches"], [])

    def test_limit_truncation(self) -> None:
        result = glob_files({"pattern": "**/*.py", "root": str(self.root), "limit": 2})
        self.assertEqual(len(result["matches"]), 2)
        self.assertTrue(result["truncated"])
        self.assertEqual(result["total"], 3)

    def test_relative_root_raises(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            glob_files({"pattern": "*.py", "root": "relative/path"})
        self.assertIn("absolute", str(ctx.exception))

    def test_missing_root_raises(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            glob_files({"pattern": "*.py", "root": str(self.root / "nonexistent")})
        self.assertIn("not found", str(ctx.exception).lower())


class GrepSearchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp_dir.name)
        (self.root / "hello.py").write_text("def hello():\n    return 42\n", encoding="utf-8")
        (self.root / "world.txt").write_text("hello world\ngoodbye world\n", encoding="utf-8")
        sub = self.root / "sub"
        sub.mkdir()
        (sub / "deep.py").write_text("# deep module\nimport os\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_basic_search(self) -> None:
        result = grep_search({"pattern": "hello", "root": str(self.root)})
        self.assertGreaterEqual(result["total"], 2)
        paths = [m["path"] for m in result["matches"]]
        self.assertTrue(any("hello.py" in p for p in paths))

    def test_include_filter(self) -> None:
        result = grep_search({"pattern": "hello", "root": str(self.root), "include": "*.py"})
        for m in result["matches"]:
            self.assertTrue(m["path"].endswith(".py"))

    def test_regex_pattern(self) -> None:
        result = grep_search({"pattern": r"def \w+\(", "root": str(self.root)})
        self.assertEqual(result["total"], 1)
        self.assertIn("def hello()", result["matches"][0]["content"])

    def test_no_matches(self) -> None:
        result = grep_search({"pattern": "zzz_nonexistent", "root": str(self.root)})
        self.assertEqual(result["total"], 0)

    def test_limit_truncation(self) -> None:
        result = grep_search({"pattern": ".", "root": str(self.root), "limit": 2})
        self.assertEqual(len(result["matches"]), 2)
        self.assertTrue(result["truncated"])

    def test_binary_file_skipped(self) -> None:
        binary_path = self.root / "data.bin"
        binary_path.write_bytes(b"\x00\x01\x02\xff\xfe hello \x00")
        result = grep_search({"pattern": "hello", "root": str(self.root)})
        bin_matches = [m for m in result["matches"] if "data.bin" in m["path"]]
        self.assertEqual(len(bin_matches), 0)

    def test_context_lines(self) -> None:
        result = grep_search(
            {
                "pattern": "return",
                "root": str(self.root),
                "context_lines": 1,
            }
        )
        self.assertGreaterEqual(result["total"], 1)
        match = result["matches"][0]
        # context should include surrounding lines
        self.assertIn("\n", match["content"])


class ListDirectoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp_dir.name)

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_list_files_and_dirs(self) -> None:
        (self.root / "file.txt").write_text("x", encoding="utf-8")
        (self.root / "subdir").mkdir()
        result = list_directory({"path": str(self.root)})
        names = {e["name"] for e in result["entries"]}
        self.assertIn("file.txt", names)
        self.assertIn("subdir", names)
        types = {e["name"]: e["type"] for e in result["entries"]}
        self.assertEqual(types["file.txt"], "file")
        self.assertEqual(types["subdir"], "directory")

    def test_empty_directory(self) -> None:
        result = list_directory({"path": str(self.root)})
        self.assertEqual(result["entries"], [])

    def test_relative_path_raises(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            list_directory({"path": "relative/path"})
        self.assertIn("absolute", str(ctx.exception))

    def test_missing_path_raises(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            list_directory({"path": str(self.root / "nonexistent")})
        self.assertIn("not found", str(ctx.exception).lower())

    def test_file_path_raises(self) -> None:
        f = self.root / "afile.txt"
        f.write_text("x", encoding="utf-8")
        with self.assertRaises(ValueError) as ctx:
            list_directory({"path": str(f)})
        self.assertIn("not a directory", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
