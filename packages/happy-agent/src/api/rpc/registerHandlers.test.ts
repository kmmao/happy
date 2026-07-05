/**
 * Integration tests for the RPC security wiring in `registerAgentHandlers`.
 *
 * `bashCommandPolicy.test.ts` and `pathValidation.test.ts` already pin the
 * policies in isolation. What they cannot catch is a *wiring* regression: a
 * handler that forgets to call `checkBlockedBashCommand` / `validatePath`, or
 * calls it with the wrong working directory, would pass every policy unit test
 * while leaving the RPC surface wide open. Those bugs live in
 * `registerHandlers.ts`, not in the policy modules.
 *
 * This suite drives the handlers the way the RpcHandlerManager does: a fake
 * manager captures each registered lambda by method name, then we invoke it
 * with a crafted request and assert the security decision. Every case here is a
 * rejection path (env exfiltration, directory traversal) that must NOT touch
 * the shell or read the target file — so if the `validatePath` call is removed
 * from, say, `readFile`, the traversal case starts actually reading
 * `/etc/passwd` and returns `success: true`, failing the test. Two happy-path
 * round-trips prove the allow branch still lets in-bounds operations through.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { registerAgentHandlers } from "./registerHandlers";
import type { RpcHandlerManager } from "./RpcHandlerManager";

type Handler = (data: any) => Promise<any>;

/**
 * A stand-in for RpcHandlerManager that records the handler lambdas by method
 * name instead of wiring them to a socket. Only `registerHandler` is exercised.
 */
function captureHandlers(
  workingDirectory: string,
  sessionId: string,
): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const fake = {
    registerHandler(method: string, handler: Handler) {
      handlers.set(method, handler);
    },
  } as unknown as RpcHandlerManager;
  registerAgentHandlers(fake, workingDirectory, sessionId);
  return handlers;
}

describe("registerAgentHandlers security wiring", () => {
  let workingDirectory: string;
  let handlers: Map<string, Handler>;

  const call = (method: string, data: unknown) => {
    const handler = handlers.get(method);
    if (!handler) throw new Error(`handler not registered: ${method}`);
    return handler(data);
  };

  beforeAll(() => {
    // realpath the temp dir so validatePath's realpathSync reconciliation
    // (e.g. macOS /var -> /private/var) matches the working directory.
    workingDirectory = realpathSync(mkdtempSync(join(tmpdir(), "happy-rpc-")));
    handlers = captureHandlers(workingDirectory, "test-session");
  });

  it("registers the security-sensitive handlers", () => {
    for (const method of [
      "bash",
      "readFile",
      "writeFile",
      "listDirectory",
      "getDirectoryTree",
    ]) {
      expect(handlers.has(method)).toBe(true);
    }
  });

  describe("bash", () => {
    it("blocks env-exfiltration commands before executing", async () => {
      const res = await call("bash", { command: "printenv" });
      expect(res.success).toBe(false);
      expect(res.error).toBe("printenv is blocked for security");
    });

    it("blocks reads of sensitive env vars", async () => {
      const res = await call("bash", { command: "echo $ANTHROPIC_API_KEY" });
      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "accessing sensitive environment variables is blocked",
      );
    });

    it("rejects a cwd outside the working directory", async () => {
      const outside = join(workingDirectory, "..");
      const res = await call("bash", { command: "ls", cwd: outside });
      expect(res.success).toBe(false);
      expect(res.error).toContain("outside the allowed directories");
    });
  });

  describe("path-confined file handlers", () => {
    const traversal = "../../../../../../etc/passwd";

    it("readFile rejects directory traversal without reading the file", async () => {
      const res = await call("readFile", { path: traversal });
      expect(res.success).toBe(false);
      expect(res.error).toContain("outside the allowed directories");
      expect(res.content).toBeUndefined();
    });

    it("writeFile rejects directory traversal without writing", async () => {
      const res = await call("writeFile", {
        path: traversal,
        content: Buffer.from("pwned").toString("base64"),
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain("outside the allowed directories");
    });

    it("listDirectory rejects directory traversal", async () => {
      const res = await call("listDirectory", { path: "/etc" });
      expect(res.success).toBe(false);
      expect(res.error).toContain("outside the allowed directories");
    });

    it("getDirectoryTree rejects directory traversal", async () => {
      const res = await call("getDirectoryTree", { path: "/etc", maxDepth: 1 });
      expect(res.success).toBe(false);
      expect(res.error).toContain("outside the allowed directories");
    });
  });

  describe("allow branch still lets in-bounds operations through", () => {
    it("readFile returns the content of a file inside the working directory", async () => {
      writeFileSync(join(workingDirectory, "inside.txt"), "hello");
      const res = await call("readFile", { path: "inside.txt" });
      expect(res.success).toBe(true);
      expect(Buffer.from(res.content, "base64").toString()).toBe("hello");
    });

    it("writeFile then readFile round-trips within the working directory", async () => {
      const content = Buffer.from("round-trip").toString("base64");
      const write = await call("writeFile", { path: "written.txt", content });
      expect(write.success).toBe(true);
      expect(typeof write.hash).toBe("string");

      const read = await call("readFile", { path: "written.txt" });
      expect(read.success).toBe(true);
      expect(Buffer.from(read.content, "base64").toString()).toBe("round-trip");
    });
  });
});
