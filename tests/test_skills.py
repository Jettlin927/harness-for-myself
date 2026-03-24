"""Tests for skill expansion in InteractiveSession."""

from __future__ import annotations

import unittest

from harness.definitions import SkillDefinition
from harness.tui import InteractiveSession


class TestExpandSkill(unittest.TestCase):
    """Unit tests for InteractiveSession._expand_skill static method."""

    def setUp(self) -> None:
        self.skills: dict[str, SkillDefinition] = {
            "review": SkillDefinition(
                name="review",
                description="Code review helper",
                body="Please review the following code for bugs and style issues.",
            ),
            "test": SkillDefinition(
                name="test",
                description="Generate tests",
                body="Write unit tests for the given module.",
            ),
        }

    def test_skill_expansion(self) -> None:
        """Typing /review expands to the skill body."""
        expanded, err = InteractiveSession._expand_skill("/review", self.skills)
        self.assertIsNone(err)
        self.assertEqual(expanded, "Please review the following code for bugs and style issues.")

    def test_unknown_skill(self) -> None:
        """/nonexistent returns None goal and an error message."""
        expanded, err = InteractiveSession._expand_skill("/nonexistent", self.skills)
        self.assertIsNone(expanded)
        self.assertIn("Unknown skill: /nonexistent", err)
        self.assertIn("/review", err)
        self.assertIn("/test", err)

    def test_unknown_skill_no_available(self) -> None:
        """/nonexistent with empty skills dict shows no 'Available' line."""
        expanded, err = InteractiveSession._expand_skill("/nonexistent", {})
        self.assertIsNone(expanded)
        self.assertIn("Unknown skill: /nonexistent", err)
        self.assertNotIn("Available", err)

    def test_skill_with_extra_args(self) -> None:
        """/review src/main.py appends additional context to body."""
        expanded, err = InteractiveSession._expand_skill("/review src/main.py", self.skills)
        self.assertIsNone(err)
        self.assertIn("Please review the following code", expanded)
        self.assertIn("Additional context: src/main.py", expanded)

    def test_non_slash_input_passes_through(self) -> None:
        """Regular input (no leading /) is returned unchanged."""
        expanded, err = InteractiveSession._expand_skill("hello world", self.skills)
        self.assertIsNone(err)
        self.assertEqual(expanded, "hello world")

    def test_skill_with_multi_word_args(self) -> None:
        """/review src/main.py --verbose preserves all extra args."""
        expanded, err = InteractiveSession._expand_skill(
            "/review src/main.py --verbose", self.skills
        )
        self.assertIsNone(err)
        self.assertIn("Additional context: src/main.py --verbose", expanded)


if __name__ == "__main__":
    unittest.main()
