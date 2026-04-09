import { describe, expect, it } from "vitest";
import { buildGoalDetailRouteState } from "./goalDetailRouteSafety";

describe("buildGoalDetailRouteState", () => {
    it("accepts safe project and goal ids", () => {
        expect(buildGoalDetailRouteState({
            projectId: "project_1",
            goalId: "goal-1",
        })).toEqual({
            kind: "ready",
            projectId: "project_1",
            goalId: "goal-1",
        });
    });

    it("rejects invalid route params", () => {
        expect(buildGoalDetailRouteState({
            projectId: "../../evil",
            goalId: "goal-1",
        })).toEqual({
            kind: "invalid",
        });

        expect(buildGoalDetailRouteState({
            projectId: "project-1",
            goalId: "goal/1",
        })).toEqual({
            kind: "invalid",
        });
    });
});
