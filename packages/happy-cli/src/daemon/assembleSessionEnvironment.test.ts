import { describe, expect, it } from "vitest";
import { assembleSessionEnvironment } from "./assembleSessionEnvironment";
import type { SpawnSessionOptions } from "@/modules/common/registerCommonHandlers";

// These cases drive the GUI-profile path (options.environmentVariables set),
// which is fully deterministic: no local settings read, no profile-API load, no
// startup bash script. The seam's precedence + validation rules are the test
// surface — no spawn, no daemon.
function baseInput(overrides?: {
  options?: Partial<SpawnSessionOptions>;
  authEnv?: Record<string, string>;
}) {
  const options: SpawnSessionOptions = {
    directory: "/tmp/happy-test",
    agent: "claude",
    environmentVariables: {},
    ...overrides?.options,
  };
  return {
    options,
    runtimeProfile: undefined,
    directory: "/tmp/happy-test",
    happySessionId: "sess-1",
    daemonControlPort: 4242,
    automationContext: undefined,
    authEnv: overrides?.authEnv ?? {},
  };
}

describe("assembleSessionEnvironment", () => {
  it("returns ok with injected HAPPY_* control vars and a spawn id", async () => {
    const result = await assembleSessionEnvironment(
      baseInput({ authEnv: { CLAUDE_CODE_OAUTH_TOKEN: "tok-123" } }),
    );
    expect(result.type).toBe("ok");
    if (result.type !== "ok") return;
    expect(result.spawnId).toMatch(/[0-9a-f-]{36}/);
    expect(result.finalSessionEnv.HAPPY_SPAWN_ID).toBe(result.spawnId);
    expect(result.finalSessionEnv.HAPPY_SESSION_ID).toBe("sess-1");
    expect(result.finalSessionEnv.HAPPY_DAEMON_CONTROL_URL).toBe(
      "http://127.0.0.1:4242",
    );
    expect(result.finalSessionEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe("tok-123");
  });

  it("lets authEnv take precedence over a conflicting profile var", async () => {
    const result = await assembleSessionEnvironment(
      baseInput({
        options: { environmentVariables: { CLAUDE_CODE_OAUTH_TOKEN: "profile-tok" } },
        authEnv: { CLAUDE_CODE_OAUTH_TOKEN: "auth-tok" },
      }),
    );
    expect(result.type).toBe("ok");
    if (result.type !== "ok") return;
    expect(result.finalSessionEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe("auth-tok");
  });

  it("builds the daemon control URL from the provided control port", async () => {
    const input = { ...baseInput(), daemonControlPort: 5555 };
    const result = await assembleSessionEnvironment(input);
    expect(result.type).toBe("ok");
    if (result.type !== "ok") return;
    expect(result.finalSessionEnv.HAPPY_DAEMON_CONTROL_URL).toBe(
      "http://127.0.0.1:5555",
    );
    expect(result.finalSessionEnv.HAPPY_INTER_AGENT_URL).toBe(
      "http://127.0.0.1:5555/inter-agent-message",
    );
  });

  it("fails fast when an auth var carries an unexpanded reference", async () => {
    const result = await assembleSessionEnvironment(
      baseInput({
        authEnv: {
          ANTHROPIC_AUTH_TOKEN: "${HAPPY_TEST_DEFINITELY_MISSING_VAR_98765}",
        },
      }),
    );
    expect(result.type).toBe("error");
    if (result.type !== "error") return;
    expect(result.errorMessage).toContain("Authentication will fail");
    expect(result.errorMessage).toContain("ANTHROPIC_AUTH_TOKEN");
  });

  it("stamps automationContext as a JSON env var when present", async () => {
    const input = {
      ...baseInput(),
      automationContext: { kind: "agent_loop" as const, loopId: "loop-9" },
    };
    const result = await assembleSessionEnvironment(input);
    expect(result.type).toBe("ok");
    if (result.type !== "ok") return;
    expect(JSON.parse(result.finalSessionEnv.HAPPY_AUTOMATION_CONTEXT_JSON)).toEqual({
      kind: "agent_loop",
      loopId: "loop-9",
    });
  });
});
