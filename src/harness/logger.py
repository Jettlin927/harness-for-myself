from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from .types import TurnRecord


class TrajectoryLogger:
    def __init__(self, log_dir: str | Path) -> None:
        log_path = Path(log_dir)
        log_path.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        self.path = log_path / f"trajectory-{stamp}.jsonl"

    def append(self, record: TurnRecord) -> None:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")
