from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.harness.snapshot import SnapshotStore
from src.harness.types import TurnRecord


def _make_turn(turn: int) -> TurnRecord:
    return TurnRecord(
        turn=turn,
        goal="snapshot test",
        working_memory={},
        llm_raw_output={},
        llm_action={"type": "tool_call"},
        tool_result=None,
        observation=f"obs-{turn}",
    )


class SnapshotAtomicWriteTests(unittest.TestCase):
    def test_save_is_atomic(self) -> None:
        """After save(), the file contains valid JSON."""
        with tempfile.TemporaryDirectory() as tmp:
            store = SnapshotStore(tmp)
            state = {
                "goal": "test",
                "context": {},
                "turns": [_make_turn(1)],
                "summary": "",
                "failure_count": 0,
                "budget_used": 0,
                "dangerous_tool_signatures": [],
            }
            path = store.save(state)
            content = Path(path).read_text(encoding="utf-8")
            payload = json.loads(content)
            self.assertEqual(payload["goal"], "test")
            self.assertEqual(len(payload["turns"]), 1)
            # Ensure no .tmp file is left behind
            tmp_files = list(Path(tmp).glob("*.tmp"))
            self.assertEqual(len(tmp_files), 0)

    def test_load_corrupted_json_raises(self) -> None:
        """Truncated/corrupted JSON should raise ValueError, not JSONDecodeError."""
        with tempfile.TemporaryDirectory() as tmp:
            bad_path = Path(tmp) / "bad.json"
            bad_path.write_text('{"goal": "test", "turns": [', encoding="utf-8")
            store = SnapshotStore(tmp)
            with self.assertRaises(ValueError) as ctx:
                store.load(str(bad_path))
            self.assertIn("corrupted", str(ctx.exception).lower())

    def test_load_missing_file_raises(self) -> None:
        """Loading a non-existent file should raise ValueError."""
        with tempfile.TemporaryDirectory() as tmp:
            store = SnapshotStore(tmp)
            with self.assertRaises(ValueError) as ctx:
                store.load(str(Path(tmp) / "nonexistent.json"))
            self.assertIn("not found", str(ctx.exception).lower())

    def test_roundtrip(self) -> None:
        """save() then load() should return consistent data."""
        with tempfile.TemporaryDirectory() as tmp:
            store = SnapshotStore(tmp)
            turns = [_make_turn(1), _make_turn(2)]
            state = {
                "goal": "roundtrip",
                "context": {"key": "value"},
                "turns": turns,
                "summary": "test summary",
                "failure_count": 1,
                "budget_used": 3,
                "dangerous_tool_signatures": ["sig1"],
            }
            path = store.save(state)
            loaded = store.load(path)
            self.assertEqual(loaded["goal"], "roundtrip")
            self.assertEqual(loaded["context"], {"key": "value"})
            self.assertEqual(len(loaded["turns"]), 2)
            self.assertIsInstance(loaded["turns"][0], TurnRecord)
            self.assertEqual(loaded["turns"][0].observation, "obs-1")
            self.assertEqual(loaded["turns"][1].observation, "obs-2")
            self.assertEqual(loaded["summary"], "test summary")
            self.assertEqual(loaded["failure_count"], 1)
            self.assertEqual(loaded["budget_used"], 3)
            self.assertEqual(loaded["dangerous_tool_signatures"], ["sig1"])


if __name__ == "__main__":
    unittest.main()
