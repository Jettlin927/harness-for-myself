import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionManager, MAX_SUMMARY_ENTRIES } from "../src/session.js";

describe("SessionManager", () => {
  let tmpDir: string;
  let mgr: SessionManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-test-"));
    mgr = new SessionManager(tmpDir);
  });

  // ── loadOrCreate ──────────────────────────────────────────────

  describe("loadOrCreate", () => {
    it("creates new session when no id given", () => {
      const state = mgr.loadOrCreate();
      expect(state.session_id).toBeTruthy();
      expect(state.goals_completed).toEqual([]);
      expect(state.accumulated_summary).toBe("");
    });

    it("loads existing session by id", () => {
      const state = mgr.loadOrCreate();
      mgr.save(state);
      const loaded = mgr.loadOrCreate(state.session_id);
      expect(loaded.session_id).toBe(state.session_id);
    });

    it("creates new session when id not found", () => {
      const state = mgr.loadOrCreate("nonexistent-id");
      expect(state.session_id).not.toBe("nonexistent-id");
    });
  });

  // ── latest ────────────────────────────────────────────────────

  describe("latest", () => {
    it("returns null when empty", () => {
      expect(mgr.latest()).toBeNull();
    });

    it("returns most recent session", () => {
      const s1 = mgr.loadOrCreate();
      mgr.save(s1);

      // Small delay to ensure different mtime
      const s2 = mgr.loadOrCreate();
      mgr.save(s2);

      const latest = mgr.latest();
      expect(latest).not.toBeNull();
      expect(latest!.session_id).toBe(s2.session_id);
    });
  });

  // ── update ────────────────────────────────────────────────────

  describe("update", () => {
    it("appends goal record", () => {
      const state = mgr.loadOrCreate();
      mgr.update(state, "计算 1+1", "final_response", 2);
      expect(state.goals_completed).toHaveLength(1);
      const entry = state.goals_completed[0];
      expect(entry.goal).toBe("计算 1+1");
      expect(entry.stop_reason).toBe("final_response");
      expect(entry.turns).toBe(2);
      expect(entry.timestamp).toBeTruthy();
    });

    it("sets accumulated summary", () => {
      const state = mgr.loadOrCreate();
      mgr.update(state, "计算 1+1", "final_response", 2);
      expect(state.accumulated_summary).toContain("计算 1+1");
      expect(state.accumulated_summary).toContain("final_response");
    });

    it("tracks snapshot path", () => {
      const state = mgr.loadOrCreate();
      mgr.update(state, "test", "final_response", 1, "/tmp/snap.json");
      expect(state.last_snapshot_path).toBe("/tmp/snap.json");
    });

    it("caps summary entries at MAX_SUMMARY_ENTRIES", () => {
      const state = mgr.loadOrCreate();
      for (let i = 0; i < MAX_SUMMARY_ENTRIES + 3; i++) {
        mgr.update(state, `目标 ${i}`, "final_response", 1);
      }
      const lines = state.accumulated_summary.split("\n").filter((l) => l.trim());
      expect(lines).toHaveLength(MAX_SUMMARY_ENTRIES);
    });

    it("does not update snapshot_path when not provided", () => {
      const state = mgr.loadOrCreate();
      mgr.update(state, "test", "final_response", 1, "/first.json");
      mgr.update(state, "test2", "final_response", 1);
      expect(state.last_snapshot_path).toBe("/first.json");
    });

    it("updates snapshot_path when provided", () => {
      const state = mgr.loadOrCreate();
      mgr.update(state, "test", "final_response", 1, "/first.json");
      mgr.update(state, "test2", "final_response", 1, "/second.json");
      expect(state.last_snapshot_path).toBe("/second.json");
    });
  });

  // ── save / load roundtrip ─────────────────────────────────────

  describe("save", () => {
    it("creates file on disk", () => {
      const state = mgr.loadOrCreate();
      const filePath = mgr.save(state);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("roundtrip preserves data", () => {
      const state = mgr.loadOrCreate();
      mgr.update(state, "hello", "final_response", 3);
      mgr.save(state);

      const loaded = mgr.loadOrCreate(state.session_id);
      expect(loaded.goals_completed[0].goal).toBe("hello");
      expect(loaded.accumulated_summary).toBe(state.accumulated_summary);
    });
  });

  // ── delete ────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes existing session", () => {
      const state = mgr.loadOrCreate();
      mgr.save(state);
      expect(mgr.delete(state.session_id)).toBe(true);
      expect(mgr.latest()).toBeNull();
    });

    it("returns false for nonexistent session", () => {
      expect(mgr.delete("ghost-id")).toBe(false);
    });
  });

  // ── listSessions ──────────────────────────────────────────────

  describe("listSessions", () => {
    it("returns empty array when no sessions", () => {
      expect(mgr.listSessions()).toEqual([]);
    });

    it("returns all sessions", () => {
      for (let i = 0; i < 3; i++) {
        const s = mgr.loadOrCreate();
        mgr.save(s);
      }
      const sessions = mgr.listSessions();
      expect(sessions).toHaveLength(3);
    });

    it("returns sessions sorted by modification time (newest first)", () => {
      const s1 = mgr.loadOrCreate();
      mgr.save(s1);

      const s2 = mgr.loadOrCreate();
      mgr.save(s2);

      const sessions = mgr.listSessions();
      expect(sessions[0].session_id).toBe(s2.session_id);
      expect(sessions[1].session_id).toBe(s1.session_id);
    });
  });
});
