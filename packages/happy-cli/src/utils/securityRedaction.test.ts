import { describe, expect, it } from "vitest";
import {
  findSensitiveEnvVarReferences,
  isSensitiveEnvVarName,
  sanitizeProcessArgv,
  summarizeShellCommandForLog,
} from "./securityRedaction";

describe("isSensitiveEnvVarName", () => {
  it("flags token and secret style names", () => {
    expect(isSensitiveEnvVarName("DEEPSEEK_AUTH_TOKEN")).toBe(true);
    expect(isSensitiveEnvVarName("OPENAI_API_KEY")).toBe(true);
    expect(isSensitiveEnvVarName("HAPPY_PROVISION_TOKEN")).toBe(true);
    expect(isSensitiveEnvVarName("GITHUB_CLIENT_SECRET")).toBe(true);
  });

  it("allows non-secret configuration names", () => {
    expect(isSensitiveEnvVarName("DEEPSEEK_BASE_URL")).toBe(false);
    expect(isSensitiveEnvVarName("Z_AI_MODEL")).toBe(false);
    expect(isSensitiveEnvVarName("API_TIMEOUT_MS")).toBe(false);
  });
});

describe("findSensitiveEnvVarReferences", () => {
  it("finds sensitive variables referenced in shell commands", () => {
    expect(findSensitiveEnvVarReferences(
      'echo "DEEPSEEK_AUTH_TOKEN=$DEEPSEEK_AUTH_TOKEN" && echo "Z_AI_MODEL=$Z_AI_MODEL"',
    )).toEqual(["DEEPSEEK_AUTH_TOKEN"]);
  });
});

describe("summarizeShellCommandForLog", () => {
  it("redacts command previews when sensitive env vars are referenced", () => {
    expect(summarizeShellCommandForLog(
      'echo "OPENAI_API_KEY=$OPENAI_API_KEY"',
    )).toEqual({
      preview: "[redacted sensitive shell command referencing OPENAI_API_KEY]",
      sensitiveEnvVars: ["OPENAI_API_KEY"],
    });
  });

  it("keeps safe command previews readable", () => {
    expect(summarizeShellCommandForLog(
      'command -v codex >/dev/null 2>&1 && echo "codex:true"',
    )).toEqual({
      preview: 'command -v codex >/dev/null 2>&1 && echo "codex:true"',
      sensitiveEnvVars: [],
    });
  });
});

describe("sanitizeProcessArgv", () => {
  it("redacts sensitive flag values and env assignments", () => {
    expect(sanitizeProcessArgv([
      "node",
      "index.mjs",
      "--token",
      "secret-token",
      "--api-key=sk-real",
      "HAPPY_PROVISION_TOKEN=hp-real",
      "--safe",
      "value",
    ])).toEqual([
      "node",
      "index.mjs",
      "--token",
      "[REDACTED]",
      "--api-key=[REDACTED]",
      "HAPPY_PROVISION_TOKEN=[REDACTED]",
      "--safe",
      "value",
    ]);
  });
});
