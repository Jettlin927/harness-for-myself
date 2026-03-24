from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any


def read_file(arguments: dict[str, Any]) -> Any:
    """Read a file and return its content with line numbers."""
    path = arguments.get("path")
    if not isinstance(path, str) or not path.strip():
        raise ValueError("read_file requires a non-empty string 'path'.")
    if not Path(path).is_absolute():
        raise ValueError("read_file requires an absolute 'path'.")

    p = Path(path)
    if not p.exists():
        raise ValueError(f"File not found: {path}")

    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise ValueError(f"File is not valid UTF-8: {path}")
    lines = text.splitlines()
    total_lines = len(lines)

    offset = arguments.get("offset", 1)
    limit = arguments.get("limit", 200)

    start = offset - 1  # convert 1-based to 0-based
    end = start + limit
    selected = lines[start:end]

    # Format with line numbers (cat -n style)
    numbered = []
    for i, line in enumerate(selected, start=offset):
        numbered.append(f"     {i}\t{line}")
    content = "\n".join(numbered)

    truncated = total_lines > start + limit
    if truncated:
        last_shown = offset + len(selected) - 1
        content += f"\n[truncated: showing lines {offset}-{last_shown} of {total_lines}]"

    return {
        "content": content,
        "lines": total_lines,
        "truncated": truncated,
    }


def edit_file(arguments: dict[str, Any]) -> Any:
    """Replace exactly one occurrence of old_text with new_text in a file."""
    path = arguments.get("path")
    if not isinstance(path, str) or not path.strip():
        raise ValueError("edit_file requires a non-empty string 'path'.")
    if not Path(path).is_absolute():
        raise ValueError("edit_file requires an absolute 'path'.")

    old_text = arguments.get("old_text")
    new_text = arguments.get("new_text")
    if not isinstance(old_text, str):
        raise ValueError("edit_file requires a string 'old_text'.")
    if not isinstance(new_text, str):
        raise ValueError("edit_file requires a string 'new_text'.")

    p = Path(path)
    if not p.exists():
        raise ValueError(f"File not found: {path}")

    content = p.read_text(encoding="utf-8")
    count = content.count(old_text)

    if count == 0:
        raise ValueError("old_text not found in file")
    if count > 1:
        raise ValueError(
            f"Found {count} matches for old_text, provide more context to make it unique"
        )

    new_content = content.replace(old_text, new_text, 1)
    p.write_text(new_content, encoding="utf-8")

    return {"path": str(p), "replacements": 1}


def run_bash(arguments: dict[str, Any]) -> Any:
    """Execute a shell command and return its output."""
    command = arguments.get("command")
    if not isinstance(command, str) or not command.strip():
        raise ValueError("run_bash requires a non-empty string 'command'.")

    timeout = arguments.get("timeout", 30)

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {
            "stdout": "",
            "stderr": f"Command timed out after {timeout}s",
            "returncode": -1,
        }
