from __future__ import annotations

import json
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
        payload = dict(state)
        payload["turns"] = [asdict(turn) for turn in state.get("turns", [])]
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(path)

    def load(self, path: str | Path) -> Dict[str, Any]:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        raw["turns"] = [TurnRecord(**turn) for turn in raw.get("turns", [])]
        raw["dangerous_tool_signatures"] = list(raw.get("dangerous_tool_signatures", []))
        return raw
