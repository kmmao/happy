import { describe, expect, it } from "vitest";
import {
  prependById,
  removeById,
  replaceById,
  resetGoalToPlanning,
} from "./worldCrudState";

describe("worldCrudState", () => {
  it("prepends a new entity and deduplicates by id", () => {
    expect(
      prependById(
        [
          { id: "2", title: "older" },
          { id: "1", title: "existing" },
        ],
        { id: "1", title: "updated" },
      ),
    ).toEqual([
      { id: "1", title: "updated" },
      { id: "2", title: "older" },
    ]);
  });

  it("replaces a matching entity in place", () => {
    expect(
      replaceById(
        [
          { id: "1", value: 1 },
          { id: "2", value: 2 },
        ],
        { id: "2", value: 3 },
      ),
    ).toEqual([
      { id: "1", value: 1 },
      { id: "2", value: 3 },
    ]);
  });

  it("removes an entity by id", () => {
    expect(
      removeById(
        [
          { id: "1" },
          { id: "2" },
        ],
        "1",
      ),
    ).toEqual([{ id: "2" }]);
  });

  it("resets a goal to planning state for optimistic replan", () => {
    expect(
      resetGoalToPlanning([
        { id: "1", status: "blocked", progress: 70 },
        { id: "2", status: "completed", progress: 100 },
      ], "1"),
    ).toEqual([
      { id: "1", status: "planning", progress: 0 },
      { id: "2", status: "completed", progress: 100 },
    ]);
  });
});
