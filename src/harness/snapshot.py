from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from .types import TurnRecord


class SnapshotStore:
    def __init__(self, snapshot_dir: str | Path) -> None:
        self.snapshot_dir = Path(snapshot_dir)
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)

    def save(self, state: Dict[str, Any]) -> str:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        path = self.snapshot_dir / f"snapshot-{stamp}.json"
        tmp_path = path.with_suffix(".json.tmp")
        payload = dict(state)
        payload["turns"] = [asdict(turn) for turn in state.get("turns", [])]
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(str(tmp_path), str(path))
        return str(path)

    def load(self, path: str | Path) -> Dict[str, Any]:
        target = Path(path)
        if not target.exists():
            raise ValueError(f"Snapshot file not found: {path}")
        try:
            raw = json.loads(target.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Snapshot file is corrupted (invalid JSON): {path}") from exc
        if not isinstance(raw, dict):
            raise ValueError(f"Snapshot file does not contain a JSON object: {path}")
        try:
            raw["turns"] = [TurnRecord(**turn) for turn in raw.get("turns", [])]
        except (TypeError, KeyError) as exc:
            raise ValueError(f"Snapshot file has invalid turn data: {path}") from exc
        raw["dangerous_tool_signatures"] = list(raw.get("dangerous_tool_signatures", []))
        return raw
