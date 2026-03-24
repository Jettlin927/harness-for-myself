"""Project context loader for HAU.

Scans the project root for configuration files, git state, and user-defined
context to inject into the agent's working memory.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

_MAX_CONTEXT_LINES = 500  # .hau/CONTEXT.md 最大注入行数


def load_project_context(root: Path) -> dict[str, Any]:
    """Load project context from the given root directory.

    Returns a dict with keys:
    - "project_root": str — 绝对路径
    - "context_md": str | None — .hau/CONTEXT.md 内容（截断到 _MAX_CONTEXT_LINES 行）
    - "git": dict | None — git 状态（branch, status, recent_commits）
    - "project_type": dict — 检测到的项目类型信息
    """
    ctx: dict[str, Any] = {"project_root": str(root.resolve())}
    ctx["context_md"] = _load_context_md(root)
    ctx["git"] = _load_git_state(root)
    ctx["project_type"] = _detect_project_type(root)
    return ctx


def _load_context_md(root: Path) -> str | None:
    """Read .hau/CONTEXT.md, truncating to _MAX_CONTEXT_LINES lines."""
    context_file = root / ".hau" / "CONTEXT.md"
    if not context_file.is_file():
        return None

    text = context_file.read_text(encoding="utf-8")
    lines = text.splitlines()
    total = len(lines)

    if total <= _MAX_CONTEXT_LINES:
        return text

    truncated = "\n".join(lines[:_MAX_CONTEXT_LINES])
    truncated += (
        f"\n[truncated: showing first {_MAX_CONTEXT_LINES} of {total} lines]"
    )
    return truncated


def _run_git(root: Path, *args: str) -> str:
    """Run a git command in *root* and return stdout, or "" on failure."""
    try:
        result = subprocess.run(
            ["git", *args],
            capture_output=True,
            text=True,
            timeout=5,
            cwd=root,
        )
        if result.returncode != 0:
            return ""
        return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def _load_git_state(root: Path) -> dict[str, str] | None:
    """Return branch / status / recent_commits, or None if not a git repo."""
    # Quick check: is this a git repo?
    check = _run_git(root, "rev-parse", "--is-inside-work-tree")
    if check != "true":
        return None

    return {
        "branch": _run_git(root, "rev-parse", "--abbrev-ref", "HEAD"),
        "status": _run_git(root, "status", "--short"),
        "recent_commits": _run_git(root, "log", "--oneline", "-5"),
    }


def _detect_project_type(root: Path) -> dict[str, Any]:
    """Detect project type by checking for well-known config files."""
    languages: list[str] = []
    package_manager = "none"
    test_command = ""
    build_file = ""
    extra: dict[str, Any] = {}

    # Python
    if (root / "pyproject.toml").is_file():
        languages.append("python")
        build_file = "pyproject.toml"
        if (root / "uv.lock").is_file():
            package_manager = "uv"
            test_command = "uv run pytest"
        else:
            package_manager = "pip"
            test_command = "pytest"

    # JavaScript / TypeScript
    if (root / "package.json").is_file():
        languages.extend(["javascript", "typescript"])
        if not build_file:
            build_file = "package.json"
        if (root / "pnpm-lock.yaml").is_file():
            package_manager = "pnpm"
        elif (root / "yarn.lock").is_file():
            package_manager = "yarn"
        else:
            package_manager = "npm"
        if not test_command:
            test_command = "npm test"

    # Rust
    if (root / "Cargo.toml").is_file():
        languages.append("rust")
        if not build_file:
            build_file = "Cargo.toml"
        package_manager = "cargo"
        if not test_command:
            test_command = "cargo test"

    # Go
    if (root / "go.mod").is_file():
        languages.append("go")
        if not build_file:
            build_file = "go.mod"
        if not test_command:
            test_command = "go test ./..."

    # Makefile
    if (root / "Makefile").is_file():
        extra["has_makefile"] = True

    result: dict[str, Any] = {
        "languages": languages,
        "package_manager": package_manager,
        "test_command": test_command,
        "build_file": build_file,
    }
    result.update(extra)
    return result
