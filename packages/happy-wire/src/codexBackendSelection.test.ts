import { describe, expect, it } from "vitest";
import {
  CODEX_REQUESTED_BACKEND_ALIASES,
  CODEX_APP_SERVER_BACKEND,
  CODEX_MCP_LEGACY_BACKEND,
  CodexBackendModeSchema,
  CodexConfigModeSchema,
  CodexRequestedBackendSchema,
  CodexResolvedBackendSchema,
  isCodexAppServerBackend,
  isCodexLegacyBackend,
  resolveCodexResolvedBackend,
  resolveCodexResumableThreadId,
  resolveRequestedCodexBackend,
} from "./codexBackendSelection";

describe("codexBackendSelection", () => {
  it("exports canonical backend constants and predicates", () => {
    expect(CODEX_APP_SERVER_BACKEND).toBe("codex-app-server");
    expect(CODEX_MCP_LEGACY_BACKEND).toBe("codex-mcp-legacy");
    expect(isCodexAppServerBackend(CODEX_APP_SERVER_BACKEND)).toBe(true);
    expect(isCodexAppServerBackend(CODEX_MCP_LEGACY_BACKEND)).toBe(false);
    expect(isCodexLegacyBackend(CODEX_MCP_LEGACY_BACKEND)).toBe(true);
    expect(isCodexLegacyBackend(CODEX_APP_SERVER_BACKEND)).toBe(false);
  });

  it("exports shared alias groups for each requested backend", () => {
    expect(CODEX_REQUESTED_BACKEND_ALIASES.auto).toEqual(["", "auto"]);
    expect(CODEX_REQUESTED_BACKEND_ALIASES["codex-app-server"]).toEqual([
      "app-server",
      "appserver",
      "codex-app-server",
    ]);
    expect(CODEX_REQUESTED_BACKEND_ALIASES["codex-mcp-legacy"]).toEqual([
      "legacy",
      "mcp",
      "mcp-legacy",
      "codex-mcp-legacy",
    ]);
  });

  it("shares the configurable backend mode values in one wire schema", () => {
    expect(CodexBackendModeSchema.parse("auto")).toBe("auto");
    expect(CodexBackendModeSchema.parse("codex-app-server")).toBe(
      "codex-app-server",
    );
    expect(CodexRequestedBackendSchema.parse("codex-mcp-legacy")).toBe(
      "codex-mcp-legacy",
    );
  });

  it("limits resolved backends to concrete transports", () => {
    expect(CodexResolvedBackendSchema.parse("codex-app-server")).toBe(
      "codex-app-server",
    );
    expect(() => CodexResolvedBackendSchema.parse("auto")).toThrow();
  });

  it("parses shared config mode values", () => {
    expect(CodexConfigModeSchema.parse("inherit")).toBe("inherit");
    expect(CodexConfigModeSchema.parse("managed-profile")).toBe(
      "managed-profile",
    );
    expect(CodexConfigModeSchema.parse("managed-overrides")).toBe(
      "managed-overrides",
    );
  });

  it("resolves the canonical backend for explicit and auto requests", () => {
    expect(resolveCodexResolvedBackend(CODEX_MCP_LEGACY_BACKEND, true)).toBe(
      CODEX_MCP_LEGACY_BACKEND,
    );
    expect(resolveCodexResolvedBackend(CODEX_APP_SERVER_BACKEND, false)).toBe(
      CODEX_APP_SERVER_BACKEND,
    );
    expect(resolveCodexResolvedBackend("auto", true)).toBe(
      CODEX_APP_SERVER_BACKEND,
    );
    expect(resolveCodexResolvedBackend("auto", false)).toBe(
      CODEX_MCP_LEGACY_BACKEND,
    );
  });

  it("resolves a resumable Codex thread id while preserving old metadata compatibility", () => {
    expect(
      resolveCodexResumableThreadId({
        resolvedBackend: CODEX_APP_SERVER_BACKEND,
        threadId: "thread_123",
      }),
    ).toBe("thread_123");
    expect(
      resolveCodexResumableThreadId({
        threadId: "thread_legacy_compatible",
      }),
    ).toBe("thread_legacy_compatible");
    expect(
      resolveCodexResumableThreadId({
        resolvedBackend: CODEX_MCP_LEGACY_BACKEND,
        threadId: "thread_blocked",
      }),
    ).toBeNull();
    expect(
      resolveCodexResumableThreadId({
        resolvedBackend: CODEX_APP_SERVER_BACKEND,
      }),
    ).toBeNull();
  });

  it("normalizes backend aliases with a shared parser", () => {
    expect(resolveRequestedCodexBackend(undefined)).toBe("auto");
    expect(resolveRequestedCodexBackend("app-server")).toBe(
      "codex-app-server",
    );
    expect(resolveRequestedCodexBackend("appserver")).toBe(
      "codex-app-server",
    );
    expect(resolveRequestedCodexBackend("legacy")).toBe(
      "codex-mcp-legacy",
    );
    expect(resolveRequestedCodexBackend("mcp")).toBe("codex-mcp-legacy");
    expect(resolveRequestedCodexBackend("surprise")).toBe("auto");
  });
});
