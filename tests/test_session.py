"""Tests for session-level persistence (SessionManager + SessionState)."""

from __future__ import annotations

from pathlib import Path

import pytest

from harness.session import _MAX_SUMMARY_ENTRIES, SessionManager

# ── fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
def tmp_mgr(tmp_path: Path) -> SessionManager:
    return SessionManager(session_dir=tmp_path)


# ── load_or_create ────────────────────────────────────────────────────────────


def test_load_or_create_new(tmp_mgr: SessionManager) -> None:
    state = tmp_mgr.load_or_create()
    assert state.session_id
    assert state.goals_completed == []
    assert state.accumulated_summary == ""


def test_load_or_create_existing(tmp_mgr: SessionManager) -> None:
    state = tmp_mgr.load_or_create()
    tmp_mgr.save(state)

    loaded = tmp_mgr.load_or_create(session_id=state.session_id)
    assert loaded.session_id == state.session_id


def test_load_or_create_missing_id_returns_new(tmp_mgr: SessionManager) -> None:
    state = tmp_mgr.load_or_create(session_id="nonexistent-id")
    assert state.session_id != "nonexistent-id"


# ── latest ────────────────────────────────────────────────────────────────────


def test_latest_none_when_empty(tmp_mgr: SessionManager) -> None:
    assert tmp_mgr.latest() is None


def test_latest_returns_most_recent(tmp_mgr: SessionManager) -> None:
    s1 = tmp_mgr.load_or_create()
    tmp_mgr.save(s1)

    s2 = tmp_mgr.load_or_create()
    tmp_mgr.save(s2)

    latest = tmp_mgr.latest()
    assert latest is not None
    assert latest.session_id == s2.session_id


# ── update ────────────────────────────────────────────────────────────────────


def test_update_appends_goal(tmp_mgr: SessionManager) -> None:
    state = tmp_mgr.load_or_create()
    tmp_mgr.update(state, goal="计算 1+1", stop_reason="final_response", turns=2)

    assert len(state.goals_completed) == 1
    entry = state.goals_completed[0]
    assert entry["goal"] == "计算 1+1"
    assert entry["stop_reason"] == "final_response"
    assert entry["turns"] == 2
    assert "timestamp" in entry


def test_update_sets_accumulated_summary(tmp_mgr: SessionManager) -> None:
    state = tmp_mgr.load_or_create()
    tmp_mgr.update(state, goal="计算 1+1", stop_reason="final_response", turns=2)

    assert "计算 1+1" in state.accumulated_summary
    assert "final_response" in state.accumulated_summary


def test_update_tracks_snapshot_path(tmp_mgr: SessionManager) -> None:
    state = tmp_mgr.load_or_create()
    tmp_mgr.update(
        state, goal="test", stop_reason="final_response", turns=1, snapshot_path="/tmp/snap.json"
    )
    assert state.last_snapshot_path == "/tmp/snap.json"


def test_update_caps_summary_entries(tmp_mgr: SessionManager) -> None:
    state = tmp_mgr.load_or_create()
    for i in range(_MAX_SUMMARY_ENTRIES + 3):
        tmp_mgr.update(state, goal=f"目标 {i}", stop_reason="final_response", turns=1)

    # Summary should only reference the most recent _MAX_SUMMARY_ENTRIES entries
    lines = [line for line in state.accumulated_summary.splitlines() if line.strip()]
    assert len(lines) == _MAX_SUMMARY_ENTRIES


# ── save / load roundtrip ─────────────────────────────────────────────────────


def test_save_creates_file(tmp_mgr: SessionManager, tmp_path: Path) -> None:
    state = tmp_mgr.load_or_create()
    path = tmp_mgr.save(state)
    assert path.exists()


def test_roundtrip(tmp_mgr: SessionManager) -> None:
    state = tmp_mgr.load_or_create()
    tmp_mgr.update(state, goal="hello", stop_reason="final_response", turns=3)
    tmp_mgr.save(state)

    loaded = tmp_mgr.load_or_create(session_id=state.session_id)
    assert loaded.goals_completed[0]["goal"] == "hello"
    assert loaded.accumulated_summary == state.accumulated_summary


# ── delete ────────────────────────────────────────────────────────────────────


def test_delete_existing(tmp_mgr: SessionManager) -> None:
    state = tmp_mgr.load_or_create()
    tmp_mgr.save(state)
    assert tmp_mgr.delete(state.session_id) is True
    assert tmp_mgr.latest() is None


def test_delete_nonexistent(tmp_mgr: SessionManager) -> None:
    assert tmp_mgr.delete("ghost-id") is False


# ── list_sessions ─────────────────────────────────────────────────────────────


def test_list_sessions_empty(tmp_mgr: SessionManager) -> None:
    assert tmp_mgr.list_sessions() == []


def test_list_sessions_multiple(tmp_mgr: SessionManager) -> None:
    for _ in range(3):
        s = tmp_mgr.load_or_create()
        tmp_mgr.save(s)

    sessions = tmp_mgr.list_sessions()
    assert len(sessions) == 3


# ── memory.summarize_run integration ─────────────────────────────────────────


def test_memory_summarize_run() -> None:
    from harness.memory import MemoryManager
    from harness.types import TurnRecord

    mgr = MemoryManager()
    turns = [
        TurnRecord(
            turn=1,
            goal="test",
            working_memory={},
            llm_raw_output={},
            llm_action={"type": "tool_call"},
            tool_result=None,
            observation="evidence: x=42",
        )
    ]
    summary = mgr.summarize_run("compute x", turns, stop_reason="final_response")
    assert "compute x" in summary
    assert "final_response" in summary
    assert "turns=1" in summary
    assert "x=42" in summary
