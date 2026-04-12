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

describe.skipIf(!hasCodexAppServer())("CodexAppServerClient auth integration", () => {
  it.skipIf(!process.env.OPENAI_API_KEY)(
    "logs in with a real API key when available",
    async () => {
      const client = new CodexAppServerClient();
      await client.connect();
      await client.loginWithApiKey(process.env.OPENAI_API_KEY!);
      expect(client.getCapabilities()).not.toBeNull();
      await client.disconnect();
    },
    30_000,
  );

  it.skipIf(
    !process.env.HAPPY_TEST_CODEX_ACCESS_TOKEN ||
      !process.env.HAPPY_TEST_CODEX_ACCOUNT_ID,
  )(
    "logs in with real ChatGPT auth tokens when available",
    async () => {
      const client = new CodexAppServerClient();
      await client.connect();
      await client.loginWithChatGptAuthTokens({
        accessToken: process.env.HAPPY_TEST_CODEX_ACCESS_TOKEN!,
        chatgptAccountId: process.env.HAPPY_TEST_CODEX_ACCOUNT_ID!,
        chatgptPlanType: process.env.HAPPY_TEST_CODEX_PLAN_TYPE || null,
      });
      expect(client.getCapabilities()).not.toBeNull();
      await client.disconnect();
    },
    30_000,
  );
});
