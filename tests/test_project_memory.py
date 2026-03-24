"""Tests for the persistent cross-session project memory system."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from harness.project_memory import ProjectMemory


class TestProjectMemory(unittest.TestCase):
    """Unit tests for ProjectMemory."""

    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.root = Path(self._tmpdir.name)
        self.pm = ProjectMemory(self.root)

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def test_save_and_load(self) -> None:
        """Save an entry and load it back; content must match."""
        self.pm.save("test_command", "make check", tags=["convention"])
        entry = self.pm.load("test_command")
        self.assertIsNotNone(entry)
        assert entry is not None
        self.assertEqual(entry.key, "test_command")
        self.assertEqual(entry.content, "make check")
        self.assertEqual(entry.tags, ["convention"])
        self.assertTrue(entry.created_at)

    def test_load_missing_returns_none(self) -> None:
        """Loading a non-existent key returns None."""
        self.assertIsNone(self.pm.load("nonexistent"))

    def test_search_by_content(self) -> None:
        """Search by content substring (case-insensitive)."""
        self.pm.save("arch", "MVC pattern with service layer")
        self.pm.save("test_cmd", "uv run pytest")
        results = self.pm.search(query="mvc")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].key, "arch")

    def test_search_by_tags(self) -> None:
        """Search filtering by tags."""
        self.pm.save("a", "alpha", tags=["constraint"])
        self.pm.save("b", "beta", tags=["convention"])
        self.pm.save("c", "gamma", tags=["constraint", "convention"])
        results = self.pm.search(tags=["constraint"])
        keys = {e.key for e in results}
        self.assertEqual(keys, {"a", "c"})

    def test_search_by_content_and_tags(self) -> None:
        """Search combining content and tag filters."""
        self.pm.save("a", "alpha value", tags=["constraint"])
        self.pm.save("b", "alpha beta", tags=["convention"])
        results = self.pm.search(query="alpha", tags=["constraint"])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].key, "a")

    def test_search_empty_returns_all(self) -> None:
        """Search with no filters returns all entries."""
        self.pm.save("x", "one")
        self.pm.save("y", "two")
        results = self.pm.search()
        self.assertEqual(len(results), 2)

    def test_delete(self) -> None:
        """Delete an entry; subsequent load returns None."""
        self.pm.save("tmp", "temporary data")
        self.assertTrue(self.pm.delete("tmp"))
        self.assertIsNone(self.pm.load("tmp"))

    def test_delete_missing_returns_false(self) -> None:
        """Deleting a non-existent key returns False."""
        self.assertFalse(self.pm.delete("ghost"))

    def test_list_all(self) -> None:
        """list_all returns all stored entries."""
        self.pm.save("a", "first")
        self.pm.save("b", "second")
        self.pm.save("c", "third")
        entries = self.pm.list_all()
        keys = {e.key for e in entries}
        self.assertEqual(keys, {"a", "b", "c"})

    def test_to_context_string(self) -> None:
        """to_context_string formats entries as a readable string."""
        self.pm.save("test_cmd", "make check", tags=["convention"])
        self.pm.save("arch", "MVC pattern")
        ctx = self.pm.to_context_string()
        self.assertIn("test_cmd", ctx)
        self.assertIn("make check", ctx)
        self.assertIn("arch", ctx)
        self.assertIn("MVC pattern", ctx)
        self.assertIn("convention", ctx)

    def test_to_context_string_empty(self) -> None:
        """to_context_string returns empty string when no memories exist."""
        self.assertEqual(self.pm.to_context_string(), "")

    def test_to_context_string_max_entries(self) -> None:
        """to_context_string respects max_entries limit."""
        for i in range(5):
            self.pm.save(f"key{i}", f"value{i}")
        ctx = self.pm.to_context_string(max_entries=2)
        # Should only contain 2 entries
        lines = [ln for ln in ctx.splitlines() if ln.startswith("- ")]
        self.assertEqual(len(lines), 2)

    def test_update_existing(self) -> None:
        """Saving with the same key overwrites the previous entry."""
        self.pm.save("ver", "v1.0", tags=["release"])
        self.pm.save("ver", "v2.0", tags=["release", "latest"])
        entry = self.pm.load("ver")
        self.assertIsNotNone(entry)
        assert entry is not None
        self.assertEqual(entry.content, "v2.0")
        self.assertEqual(entry.tags, ["release", "latest"])

    def test_memory_dir_created(self) -> None:
        """ProjectMemory creates the .hau/memory/ directory on init."""
        new_root = self.root / "subproject"
        ProjectMemory(new_root)
        self.assertTrue((new_root / ".hau" / "memory").is_dir())

    def test_corrupted_file_skipped(self) -> None:
        """Corrupted JSON files are silently skipped in list_all and load."""
        self.pm.save("good", "valid entry")
        bad_path = self.pm.memory_dir / "bad.json"
        bad_path.write_text("not valid json{{{", encoding="utf-8")
        entries = self.pm.list_all()
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].key, "good")
        self.assertIsNone(self.pm.load("bad"))


if __name__ == "__main__":
    unittest.main()
