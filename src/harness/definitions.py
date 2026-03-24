"""Definition file parsing for .hau/agents/ and .hau/skills/ directories."""

from __future__ import annotations

import re
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class AgentDefinition:
    """Parsed agent definition from a .md file."""

    name: str  # 如 "test-runner"，要求 [a-z0-9-]+
    description: str  # 一句话描述
    max_steps: int | None = None  # None = 继承 parent
    trust_level: str | None = None  # None = 继承; "ask"/"auto-edit"/"yolo"
    tools: list[str] | None = None  # None = 全部工具; list = 白名单
    system_instructions: str = ""  # .md body 部分


@dataclass
class SkillDefinition:
    """Parsed skill definition from a .md file."""

    name: str
    description: str
    body: str = ""


def parse_definition_file(path: Path) -> tuple[dict[str, Any], str]:
    """Parse a .md file with --- frontmatter. Returns (metadata_dict, body_text).

    Rules:
    1. File starts with ``---``, second ``---`` ends frontmatter.
    2. Each frontmatter line is ``key: value``.
    3. Value types: string, integer, list (``[a, b, c]``).
    4. Content after second ``---`` is body.
    5. If no leading ``---``, entire file is body, frontmatter is empty dict.
    """
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")

    # Check if file starts with ---
    if not lines or lines[0].strip() != "---":
        return {}, text

    # Find the closing ---
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break

    if end_idx is None:
        # No closing ---, treat entire file as body
        return {}, text

    # Parse frontmatter lines
    metadata: dict[str, Any] = {}
    for line in lines[1:end_idx]:
        line = line.strip()
        if not line:
            continue
        colon_pos = line.find(":")
        if colon_pos < 0:
            continue
        key = line[:colon_pos].strip()
        raw_value = line[colon_pos + 1 :].strip()
        metadata[key] = _parse_value(raw_value)

    # Body is everything after the closing ---
    body = "\n".join(lines[end_idx + 1 :])
    # Strip one leading newline if present (common after ---)
    if body.startswith("\n"):
        body = body[1:]

    return metadata, body


def _parse_value(raw: str) -> Any:
    """Parse a frontmatter value into str, int, or list[str]."""
    # List: [item1, item2, ...]
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1]
        if not inner.strip():
            return []
        return [item.strip() for item in inner.split(",")]

    # Integer
    try:
        return int(raw)
    except ValueError:
        pass

    return raw


_VALID_TRUST_LEVELS = {"ask", "auto-edit", "yolo"}
_NAME_PATTERN = re.compile(r"^[a-z0-9-]+$")


def _validate_agent(meta: dict[str, Any], body: str, filepath: Path) -> AgentDefinition | None:
    """Validate and build an AgentDefinition. Returns None on validation failure."""
    name = meta.get("name")
    if not name or not isinstance(name, str):
        warnings.warn(f"definitions: skipping {filepath}: missing or empty 'name'", stacklevel=2)
        return None

    description = meta.get("description")
    if not description or not isinstance(description, str):
        warnings.warn(
            f"definitions: skipping {filepath}: missing or empty 'description'", stacklevel=2
        )
        return None

    trust_level = meta.get("trust_level")
    if trust_level is not None:
        trust_level = str(trust_level)
        if trust_level not in _VALID_TRUST_LEVELS:
            warnings.warn(
                f"definitions: skipping {filepath}: invalid trust_level '{trust_level}'",
                stacklevel=2,
            )
            return None

    max_steps = meta.get("max_steps")
    if max_steps is not None:
        if not isinstance(max_steps, int) or max_steps <= 0:
            warnings.warn(
                f"definitions: skipping {filepath}: max_steps must be a positive integer",
                stacklevel=2,
            )
            return None

    tools = meta.get("tools")
    if tools is not None and not isinstance(tools, list):
        warnings.warn(
            f"definitions: skipping {filepath}: tools must be a list",
            stacklevel=2,
        )
        return None

    return AgentDefinition(
        name=name,
        description=description,
        max_steps=max_steps,
        trust_level=trust_level,
        tools=tools,
        system_instructions=body,
    )


def _validate_skill(meta: dict[str, Any], body: str, filepath: Path) -> SkillDefinition | None:
    """Validate and build a SkillDefinition. Returns None on validation failure."""
    name = meta.get("name")
    if not name or not isinstance(name, str):
        warnings.warn(f"definitions: skipping {filepath}: missing or empty 'name'", stacklevel=2)
        return None

    description = meta.get("description")
    if not description or not isinstance(description, str):
        warnings.warn(
            f"definitions: skipping {filepath}: missing or empty 'description'", stacklevel=2
        )
        return None

    return SkillDefinition(name=name, description=description, body=body)


def load_agent_definitions(hau_dir: Path) -> list[AgentDefinition]:
    """Load all .md files from hau_dir/agents/. Returns empty list if dir missing."""
    agents_dir = hau_dir / "agents"
    if not agents_dir.is_dir():
        return []

    results: list[AgentDefinition] = []
    for md_file in sorted(agents_dir.glob("*.md")):
        meta, body = parse_definition_file(md_file)
        agent = _validate_agent(meta, body, md_file)
        if agent is not None:
            results.append(agent)
    return results


def load_skill_definitions(hau_dir: Path) -> list[SkillDefinition]:
    """Load all .md files from hau_dir/skills/. Returns empty list if dir missing."""
    skills_dir = hau_dir / "skills"
    if not skills_dir.is_dir():
        return []

    results: list[SkillDefinition] = []
    for md_file in sorted(skills_dir.glob("*.md")):
        meta, body = parse_definition_file(md_file)
        skill = _validate_skill(meta, body, md_file)
        if skill is not None:
            results.append(skill)
    return results
