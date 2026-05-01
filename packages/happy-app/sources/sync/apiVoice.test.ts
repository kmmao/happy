import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthCredentials } from "@/auth/tokenStorage";

const mockSettings = vi.hoisted(() => ({
  livekitApiKey: "lk-key",
  livekitApiSecret: "lk-secret",
  livekitWssUrl: "wss://example.livekit.cloud",
  elevenLabsApiKey: null,
}));

vi.mock("@/config", () => ({
  config: { elevenLabsAgentId: "agent-1" },
}));

vi.mock("./serverConfig", () => ({
  getServerUrl: () => "https://api.test.com",
}));

vi.mock("./storage", () => ({
  storage: {
    getState: () => ({
      settings: mockSettings,
    }),
  },
}));

let fetchLiveKitToken: typeof import("./apiVoice").fetchLiveKitToken;
let verifyLiveKitCredentials: typeof import("./apiVoice").verifyLiveKitCredentials;

const mockCredentials: AuthCredentials = {
  token: "test-token",
  secret: "test-secret",
};

describe("apiVoice livekit", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    ({ fetchLiveKitToken, verifyLiveKitCredentials } = await import("./apiVoice"));
  });

  it("includes LiveKit WSS URL when requesting a token", async () => {
    const response = {
      ok: true,
      json: vi.fn().mockResolvedValue({ token: "lk-token", url: "wss://returned.example", roomName: "room-1" }),
    };
    global.fetch = vi.fn().mockResolvedValue(response as never);

    await fetchLiveKitToken(mockCredentials, "session-1");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.test.com/v1/voice/livekit-token",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
      }),
    );

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body as string);
    expect(body).toEqual({
      sessionId: "session-1",
      userApiKey: "lk-key",
      userApiSecret: "lk-secret",
      userLivekitUrl: "wss://example.livekit.cloud",
    });
  });

  it("includes LiveKit URL when verifying credentials", async () => {
    const response = {
      ok: true,
      json: vi.fn().mockResolvedValue({ valid: true }),
    };
    global.fetch = vi.fn().mockResolvedValue(response as never);

    await verifyLiveKitCredentials(mockCredentials, "key", "secret", "wss://custom.livekit.cloud");

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body as string);
    expect(body).toEqual({
      apiKey: "key",
      apiSecret: "secret",
      livekitUrl: "wss://custom.livekit.cloud",
    });
  });
});
