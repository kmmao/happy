import { describe, it, expect } from "vitest";
import { describeSkillRouting } from "./skillRouting";

describe("describeSkillRouting", () => {
    it("returns null when no routing front-matter", () => {
        expect(describeSkillRouting("# Skill\nbody")).toBeNull();
    });

    it("extracts model", () => {
        expect(describeSkillRouting("---\nmodel: haiku\n---\nbody")).toEqual({
            model: "haiku",
            userOnly: false,
        });
    });

    it("flags user-only via disable_model_invocation or user_invocable:false", () => {
        expect(describeSkillRouting("---\ndisable_model_invocation: true\n---\nx")?.userOnly).toBe(true);
        expect(describeSkillRouting("---\nuser_invocable: false\n---\nx")?.userOnly).toBe(true);
    });
});
