import { beforeEach, describe, expect, it } from "vitest";
import { TaskManager } from "../src/tasks.js";

describe("TaskManager", () => {
  let tm: TaskManager;

  beforeEach(() => {
    tm = new TaskManager();
  });

  it("create returns a pending task", () => {
    const task = tm.create("Write tests");
    expect(task.id).toBe("task_1");
    expect(task.description).toBe("Write tests");
    expect(task.status).toBe("pending");
    expect(task.created_at).toBeTruthy();
  });

  it("create increments IDs", () => {
    const t1 = tm.create("First");
    const t2 = tm.create("Second");
    expect(t1.id).toBe("task_1");
    expect(t2.id).toBe("task_2");
  });

  it("create rejects empty description", () => {
    expect(() => tm.create("")).toThrow("empty");
    expect(() => tm.create("   ")).toThrow("empty");
  });

  it("update changes status", () => {
    const task = tm.create("Do something");
    const updated = tm.update(task.id, "in_progress");
    expect(updated.status).toBe("in_progress");
    expect(updated.updated_at).toBeTruthy();
  });

  it("update to completed", () => {
    const task = tm.create("Fix bug");
    tm.update(task.id, "in_progress");
    const done = tm.update(task.id, "completed");
    expect(done.status).toBe("completed");
  });

  it("update unknown task raises", () => {
    expect(() => tm.update("task_999", "completed")).toThrow("not found");
  });

  it("update invalid status raises", () => {
    const task = tm.create("Test");
    expect(() => tm.update(task.id, "invalid" as any)).toThrow("Invalid status");
  });

  it("get returns task copy", () => {
    const task = tm.create("Read file");
    const got = tm.get(task.id);
    expect(got).not.toBeNull();
    expect(got!.description).toBe("Read file");
    // Verify it's a copy
    got!.description = "mutated";
    expect(tm.get(task.id)!.description).toBe("Read file");
  });

  it("get returns null for unknown id", () => {
    expect(tm.get("task_999")).toBeNull();
  });

  it("list returns all tasks", () => {
    tm.create("A");
    tm.create("B");
    tm.create("C");
    const tasks = tm.list();
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.description)).toEqual(["A", "B", "C"]);
  });

  it("list returns empty array initially", () => {
    expect(tm.list()).toEqual([]);
  });

  it("clear removes all tasks", () => {
    tm.create("A");
    tm.create("B");
    tm.clear();
    expect(tm.list()).toEqual([]);
  });
});
