import { describe, expect, it } from "vitest";

import {
  getFilteredDaemonEnvironment,
  resolveStartupScriptEnvironment,
} from "./startupScriptEnvironment";

describe("getFilteredDaemonEnvironment", () => {
  it("strips server-only secrets and keeps ordinary variables", () => {
    const filtered = getFilteredDaemonEnvironment({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-test",
      DATABASE_URL: "postgres://secret",
      JWT_SECRET: "super-secret",
    });

    expect(filtered).toEqual({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-test",
    });
  });
});

describe("resolveStartupScriptEnvironment", () => {
  it("captures exported variables and changed values from the startup script", async () => {
    const envDelta = await resolveStartupScriptEnvironment({
      cwd: process.cwd(),
      startupBashScript: `
export OPENAI_API_KEY="script-key"
export EXTRA_FLAG="enabled"
export PATH="$PATH:/custom/bin"
      `,
      baseEnv: {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "initial-key",
      },
    });

    expect(envDelta).toEqual({
      OPENAI_API_KEY: "script-key",
      EXTRA_FLAG: "enabled",
      PATH: "/usr/bin:/custom/bin",
    });
  });

  it("rejects when the startup script exits with a failure", async () => {
    await expect(
      resolveStartupScriptEnvironment({
        cwd: process.cwd(),
        startupBashScript: `
export SHOULD_NOT_SURVIVE="1"
false
        `,
        baseEnv: {
          PATH: "/usr/bin",
        },
      }),
    ).rejects.toThrow();
  });
});
