from __future__ import annotations

import difflib
import re
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

    # Generate unified diff before writing
    old_lines = content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)
    diff = "".join(
        difflib.unified_diff(
            old_lines,
            new_lines,
            fromfile=f"a/{p.name}",
            tofile=f"b/{p.name}",
        )
    )

    p.write_text(new_content, encoding="utf-8")

    return {"path": str(p), "replacements": 1, "diff": diff}


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


def write_file(arguments: dict[str, Any]) -> Any:
    """Create a new file with the given content. Refuses to overwrite existing files."""
    path = arguments.get("path")
    if not isinstance(path, str) or not path.strip():
        raise ValueError("write_file requires a non-empty string 'path'.")
    if not Path(path).is_absolute():
        raise ValueError("write_file requires an absolute 'path'.")

    content = arguments.get("content")
    if not isinstance(content, str):
        raise ValueError("write_file requires a string 'content'.")

    p = Path(path)
    if p.exists():
        raise ValueError(f"File already exists: {path} — use edit_file to modify existing files.")

    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")

    return {"path": str(p.resolve()), "bytes_written": len(content.encode("utf-8"))}


def glob_files(arguments: dict[str, Any]) -> Any:
    """Search for files matching a glob pattern under a root directory."""
    pattern = arguments.get("pattern")
    if not isinstance(pattern, str) or not pattern.strip():
        raise ValueError("glob_files requires a non-empty string 'pattern'.")

    root = arguments.get("root")
    if not isinstance(root, str) or not root.strip():
        raise ValueError("glob_files requires a non-empty string 'root'.")
    if not Path(root).is_absolute():
        raise ValueError("glob_files requires an absolute 'root'.")

    root_path = Path(root)
    if not root_path.exists():
        raise ValueError(f"Root directory not found: {root}")
    if not root_path.is_dir():
        raise ValueError(f"Root is not a directory: {root}")

    limit = arguments.get("limit", 100)
    matches = sorted(str(p) for p in root_path.glob(pattern))
    total = len(matches)
    truncated = total > limit
    return {
        "matches": matches[:limit],
        "total": total,
        "truncated": truncated,
    }


def grep_search(arguments: dict[str, Any]) -> Any:
    """Search file contents for lines matching a regex pattern."""
    pattern = arguments.get("pattern")
    if not isinstance(pattern, str) or not pattern.strip():
        raise ValueError("grep_search requires a non-empty string 'pattern'.")

    root = arguments.get("root")
    if not isinstance(root, str) or not root.strip():
        raise ValueError("grep_search requires a non-empty string 'root'.")
    if not Path(root).is_absolute():
        raise ValueError("grep_search requires an absolute 'root'.")

    root_path = Path(root)
    if not root_path.exists():
        raise ValueError(f"Root directory not found: {root}")

    include = arguments.get("include")
    limit = arguments.get("limit", 50)
    context_lines = arguments.get("context_lines", 0)

    _SKIP_DIRS = {".git", "node_modules", "__pycache__"}

    try:
        regex = re.compile(pattern)
    except re.error as exc:
        raise ValueError(f"Invalid regex pattern: {exc}") from exc

    matches: list[dict[str, Any]] = []

    def _walk(directory: Path) -> None:
        try:
            entries = sorted(directory.iterdir())
        except PermissionError:
            return
        for entry in entries:
            if entry.is_dir():
                if entry.name not in _SKIP_DIRS:
                    _walk(entry)
            elif entry.is_file():
                if include and not entry.match(include):
                    continue
                _search_file(entry)
            if len(matches) >= limit:
                return

    def _search_file(file_path: Path) -> None:
        try:
            lines = file_path.read_text(encoding="utf-8").splitlines()
        except (UnicodeDecodeError, PermissionError):
            return
        for i, line in enumerate(lines):
            if len(matches) >= limit:
                return
            if regex.search(line):
                if context_lines > 0:
                    start = max(0, i - context_lines)
                    end = min(len(lines), i + context_lines + 1)
                    content = "\n".join(lines[start:end])
                else:
                    content = line
                matches.append(
                    {
                        "path": str(file_path),
                        "line": i + 1,
                        "content": content,
                    }
                )

    _walk(root_path)
    total = len(matches)
    truncated = total >= limit
    return {
        "matches": matches[:limit],
        "total": total,
        "truncated": truncated,
    }


def list_directory(arguments: dict[str, Any]) -> Any:
    """List entries in a directory, annotating each as file or directory."""
    path = arguments.get("path")
    if not isinstance(path, str) or not path.strip():
        raise ValueError("list_directory requires a non-empty string 'path'.")
    if not Path(path).is_absolute():
        raise ValueError("list_directory requires an absolute 'path'.")

    p = Path(path)
    if not p.exists():
        raise ValueError(f"Directory not found: {path}")
    if not p.is_dir():
        raise ValueError(f"Path is not a directory: {path}")

    entries = []
    for entry in sorted(p.iterdir(), key=lambda e: e.name):
        entry_type = "directory" if entry.is_dir() else "file"
        entries.append({"name": entry.name, "type": entry_type})

    return {"entries": entries}
