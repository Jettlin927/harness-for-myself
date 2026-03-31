/**
 * TaskManager — in-memory task tracking for agent runs.
 * Registered as tools so the agent can self-manage tasks.
 */

import type { Task, TaskStatus } from "./types.js";

export class TaskManager {
  private static readonly _VALID_STATUSES = new Set<TaskStatus>([
    "pending", "in_progress", "completed", "failed",
  ]);

  private _tasks: Map<string, Task> = new Map();
  private _nextId = 1;

  create(description: string): Task {
    if (!description.trim()) {
      throw new Error("Task description must not be empty");
    }
    const now = new Date().toISOString();
    const task: Task = {
      id: `task_${this._nextId++}`,
      description,
      status: "pending",
      created_at: now,
      updated_at: now,
    };
    this._tasks.set(task.id, task);
    return task;
  }

  update(id: string, status: TaskStatus): Task {
    const task = this._tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    if (!TaskManager._VALID_STATUSES.has(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${[...TaskManager._VALID_STATUSES].join(", ")}`);
    }
    task.status = status;
    task.updated_at = new Date().toISOString();
    return { ...task };
  }

  get(id: string): Task | null {
    const task = this._tasks.get(id);
    return task ? { ...task } : null;
  }

  list(): Task[] {
    return [...this._tasks.values()].map((t) => ({ ...t }));
  }

  clear(): void {
    this._tasks.clear();
  }
}
