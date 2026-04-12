import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { CodexAppServerClient } from "./CodexAppServerClient";

function hasCodexAppServer(): boolean {
  try {
    execSync("codex app-server --help", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasCodexAppServer())("CodexAppServerClient integration", () => {
  it("connects to the real codex app-server and loads capabilities", async () => {
    const client = new CodexAppServerClient();
    await client.connect();

    const capabilities = client.getCapabilities();
    expect(Array.isArray(capabilities?.models)).toBe(true);
    expect((capabilities?.models.length ?? 0) >= 0).toBe(true);

    await client.disconnect();
  }, 30_000);
});
