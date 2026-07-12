import { describe, it, expect } from "vitest";
import {
  parseSkillFrontmatter,
  resolveSkillModelId,
} from "./skillFrontmatter";

describe("parseSkillFrontmatter", () => {
  it("returns empty frontmatter and full body when no fence present", () => {
    const r = parseSkillFrontmatter("# Just a skill\nbody text");
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe("# Just a skill\nbody text");
  });

  it("extracts model and strips the block from the body", () => {
    const r = parseSkillFrontmatter(
      "---\nmodel: haiku\n---\n# Deploy\nrun it",
    );
    expect(r.frontmatter.model).toBe("haiku");
    expect(r.body).toBe("# Deploy\nrun it");
  });

  it("parses booleans in snake_case and kebab-case", () => {
    const r = parseSkillFrontmatter(
      "---\nuser_invocable: false\ndisable-model-invocation: true\n---\nbody",
    );
    expect(r.frontmatter.userInvocable).toBe(false);
    expect(r.frontmatter.disableModelInvocation).toBe(true);
    expect(r.body).toBe("body");
  });

  it("ignores unknown keys and comments", () => {
    const r = parseSkillFrontmatter(
      "---\n# a comment\nmodel: opus\nfoo: bar\n---\nbody",
    );
    expect(r.frontmatter.model).toBe("opus");
    expect(r.frontmatter).not.toHaveProperty("foo");
  });

  it("does not throw on a malformed / unterminated block", () => {
    const r = parseSkillFrontmatter("---\nmodel: haiku\nno closing fence");
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe("---\nmodel: haiku\nno closing fence");
  });
});

describe("resolveSkillModelId", () => {
  it("maps short aliases to concrete ids", () => {
    expect(resolveSkillModelId("haiku")).toBe("claude-haiku-4-5-20251001");
    expect(resolveSkillModelId("opus")).toBe("claude-opus-4-8");
    expect(resolveSkillModelId("SONNET")).toBe("claude-sonnet-5");
  });

  it("passes through full model ids", () => {
    expect(resolveSkillModelId("claude-sonnet-4-20250514")).toBe(
      "claude-sonnet-4-20250514",
    );
  });

  it("returns undefined for empty input", () => {
    expect(resolveSkillModelId(undefined)).toBeUndefined();
    expect(resolveSkillModelId("")).toBeUndefined();
  });
});
