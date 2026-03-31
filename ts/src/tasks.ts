/**
 * TaskManager — in-memory task tracking for agent runs.
 * Registered as tools so the agent can self-manage tasks.
 */

import type { Task, TaskStatus } from "./types.js";

let _nextId = 1;

function generateId(): string {
  return `task_${_nextId++}`;
}

export class TaskManager {
  private _tasks: Map<string, Task> = new Map();

  create(description: string): Task {
    if (!description.trim()) {
      throw new Error("Task description must not be empty");
    }
    const now = new Date().toISOString();
    const task: Task = {
      id: generateId(),
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
    const validStatuses: TaskStatus[] = ["pending", "in_progress", "completed", "failed"];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(", ")}`);
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

/** Reset the ID counter (for testing). */
export function _resetTaskIdCounter(): void {
  _nextId = 1;
}
