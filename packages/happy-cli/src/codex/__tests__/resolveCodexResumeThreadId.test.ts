import { describe, expect, it } from "vitest";

import { resolveCodexResumeThreadId } from "../utils/resolveCodexResumeThreadId";

describe("resolveCodexResumeThreadId", () => {
  it("returns the thread id for app-server sessions", () => {
    expect(
      resolveCodexResumeThreadId({
        codex: {
          resolvedBackend: "codex-app-server",
          threadId: "thread_123",
        },
      } as any),
    ).toBe("thread_123");
  });

  it("returns the thread id when older metadata omitted resolvedBackend", () => {
    expect(
      resolveCodexResumeThreadId({
        codex: {
          threadId: "thread_123",
        },
      } as any),
    ).toBe("thread_123");
  });

  it("blocks resume for explicit legacy backend sessions", () => {
    expect(
      resolveCodexResumeThreadId({
        codex: {
          resolvedBackend: "codex-mcp-legacy",
          threadId: "thread_123",
        },
      } as any),
    ).toBeNull();
  });
});
