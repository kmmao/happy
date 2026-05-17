import { describe, it, expect } from "vitest";
import { TaskMirrorState } from "./taskMirrorState";

describe("TaskMirrorState", () => {
  describe("processToolUse", () => {
    it("creates tasks from TaskCreate tool_use input", () => {
      const state = new TaskMirrorState();
      const changed = state.processToolUse("TaskCreate", {
        subject: "Fix the bug",
        description: "Something is broken",
      });

      expect(changed).toBe(true);
      expect(state.hasTasks()).toBe(true);
      expect(state.getTodos()).toEqual([
        { content: "Fix the bug", status: "pending", activeForm: undefined },
      ]);
    });

    it("preserves activeForm from TaskCreate", () => {
      const state = new TaskMirrorState();
      state.processToolUse("TaskCreate", {
        subject: "Run tests",
        activeForm: "Running tests",
      });

      expect(state.getTodos()[0]?.activeForm).toBe("Running tests");
    });

    it("assigns sequential IDs for TaskUpdate references", () => {
      const state = new TaskMirrorState();
      state.processToolUse("TaskCreate", { subject: "Task A" });
      state.processToolUse("TaskCreate", { subject: "Task B" });

      state.processToolUse("TaskUpdate", {
        taskId: "1",
        status: "in_progress",
      });

      const todos = state.getTodos();
      expect(todos[0]?.status).toBe("in_progress");
      expect(todos[1]?.status).toBe("pending");
    });

    it("updates status via TaskUpdate", () => {
      const state = new TaskMirrorState();
      state.processToolUse("TaskCreate", { subject: "Do thing" });

      const changed = state.processToolUse("TaskUpdate", {
        taskId: "1",
        status: "completed",
      });

      expect(changed).toBe(true);
      expect(state.getTodos()[0]?.status).toBe("completed");
    });

    it("removes tasks with deleted status", () => {
      const state = new TaskMirrorState();
      state.processToolUse("TaskCreate", { subject: "Temp task" });
      expect(state.hasTasks()).toBe(true);

      const changed = state.processToolUse("TaskUpdate", {
        taskId: "1",
        status: "deleted",
      });

      expect(changed).toBe(true);
      expect(state.hasTasks()).toBe(false);
      expect(state.getTodos()).toEqual([]);
    });

    it("updates subject via TaskUpdate", () => {
      const state = new TaskMirrorState();
      state.processToolUse("TaskCreate", { subject: "Old name" });

      state.processToolUse("TaskUpdate", {
        taskId: "1",
        subject: "New name",
      });

      expect(state.getTodos()[0]?.content).toBe("New name");
    });

    it("ignores TaskUpdate for unknown taskId", () => {
      const state = new TaskMirrorState();
      const changed = state.processToolUse("TaskUpdate", {
        taskId: "999",
        status: "completed",
      });

      expect(changed).toBe(false);
    });

    it("ignores TaskCreate with empty subject", () => {
      const state = new TaskMirrorState();
      const changed = state.processToolUse("TaskCreate", {
        subject: "  ",
      });

      expect(changed).toBe(false);
      expect(state.hasTasks()).toBe(false);
    });

    it("ignores unrelated tool names", () => {
      const state = new TaskMirrorState();
      const changed = state.processToolUse("Read", { file_path: "/foo" });

      expect(changed).toBe(false);
    });

    it("returns false when TaskUpdate causes no actual change", () => {
      const state = new TaskMirrorState();
      state.processToolUse("TaskCreate", { subject: "Task" });

      const changed = state.processToolUse("TaskUpdate", {
        taskId: "1",
        status: "pending",
      });

      expect(changed).toBe(false);
    });

    it("registers TaskList pending without changing state", () => {
      const state = new TaskMirrorState();
      const changed = state.processToolUse("TaskList", {}, "toolu_abc");
      expect(changed).toBe(false);
    });
  });

  describe("processToolResult", () => {
    it("corrects task ID from TaskCreate result", () => {
      const state = new TaskMirrorState();
      state.processToolUse("TaskCreate", { subject: "Do thing" }, "toolu_1");

      state.processToolResult("toolu_1", "Task #1 created successfully: Do thing");

      // TaskUpdate with real ID should work
      const changed = state.processToolUse("TaskUpdate", {
        taskId: "1",
        status: "completed",
      });
      expect(changed).toBe(true);
    });

    it("fixes ID mismatch when runtime assigns different ID", () => {
      const state = new TaskMirrorState();
      // Simulate: we assign ID "1" but runtime assigns "5"
      state.processToolUse("TaskCreate", { subject: "My task" }, "toolu_x");
      expect(state.getTodos()).toHaveLength(1);

      state.processToolResult("toolu_x", "Task #5 created successfully: My task");

      // Old temp ID no longer works, real ID does
      expect(
        state.processToolUse("TaskUpdate", { taskId: "1", status: "completed" }),
      ).toBe(false);
      expect(
        state.processToolUse("TaskUpdate", { taskId: "5", status: "completed" }),
      ).toBe(true);
    });

    it("advances nextId based on confirmed real ID", () => {
      const state = new TaskMirrorState();
      state.processToolUse("TaskCreate", { subject: "First" }, "toolu_a");
      state.processToolResult("toolu_a", "Task #10 created successfully: First");

      // Next create should get ID > 10
      state.processToolUse("TaskCreate", { subject: "Second" });
      state.processToolUse("TaskUpdate", { taskId: "11", status: "in_progress" });

      const todos = state.getTodos();
      expect(todos.find((t) => t.content === "Second")?.status).toBe("in_progress");
    });

    it("ignores result for unknown tool_use_id", () => {
      const state = new TaskMirrorState();
      const changed = state.processToolResult("toolu_unknown", "Task #1 created");
      expect(changed).toBe(false);
    });
  });

  describe("reconcileFromTaskList", () => {
    it("rebuilds state from TaskList output", () => {
      const state = new TaskMirrorState();
      // Start with stale state
      state.processToolUse("TaskCreate", { subject: "Old task" });

      const changed = state.reconcileFromTaskList(
        "#1 [completed] Fix the bug\n#2 [in_progress] Write tests\n#3 [pending] Deploy",
      );

      expect(changed).toBe(true);
      expect(state.getTodos()).toEqual([
        { content: "Fix the bug", status: "completed", activeForm: undefined },
        { content: "Write tests", status: "in_progress", activeForm: undefined },
        { content: "Deploy", status: "pending", activeForm: undefined },
      ]);
    });

    it("preserves activeForm from existing tasks during reconcile", () => {
      const state = new TaskMirrorState();
      state.processToolUse("TaskCreate", {
        subject: "Task A",
        activeForm: "Working on A",
      });

      state.reconcileFromTaskList("#1 [in_progress] Task A");

      expect(state.getTodos()[0]?.activeForm).toBe("Working on A");
    });

    it("returns false when state is unchanged", () => {
      const state = new TaskMirrorState();
      state.processToolUse("TaskCreate", { subject: "Task A" });

      const changed = state.reconcileFromTaskList("#1 [pending] Task A");
      expect(changed).toBe(false);
    });

    it("returns false for empty text", () => {
      const state = new TaskMirrorState();
      const changed = state.reconcileFromTaskList("");
      expect(changed).toBe(false);
    });

    it("handles reconcile via processToolResult for TaskList", () => {
      const state = new TaskMirrorState();
      state.processToolUse("TaskCreate", { subject: "Old" });
      state.processToolUse("TaskList", {}, "toolu_list");

      const changed = state.processToolResult(
        "toolu_list",
        "#1 [completed] Old\n#2 [pending] New",
      );

      expect(changed).toBe(true);
      expect(state.getTodos()).toHaveLength(2);
      expect(state.getTodos()[0]?.status).toBe("completed");
    });
  });
});
