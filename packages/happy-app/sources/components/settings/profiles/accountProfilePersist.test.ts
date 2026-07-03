import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AIBackendProfile } from "@/sync/settings";

const { getCreds, createFn, updateFn } = vi.hoisted(() => ({
  getCreds: vi.fn(),
  createFn: vi.fn(),
  updateFn: vi.fn(),
}));

vi.mock("@/auth/tokenStorage", () => ({ TokenStorage: { getCredentials: getCreds } }));
vi.mock("@/sync/apiAccountProfiles", () => ({
  createAccountProfile: createFn,
  updateAccountProfile: updateFn,
  fetchAccountProfiles: vi.fn(),
}));

import { persistProfileToAccount } from "./accountProfilePersist";

function prof(overrides: Partial<AIBackendProfile> = {}): AIBackendProfile {
  return {
    id: "p1",
    name: "N",
    anthropicConfig: {},
    environmentVariables: [],
    compatibility: { claude: true, codex: true, gemini: true },
    isBuiltIn: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as AIBackendProfile;
}

describe("persistProfileToAccount", () => {
  beforeEach(() => {
    getCreds.mockReset().mockResolvedValue({ token: "t" });
    createFn.mockReset().mockResolvedValue(undefined);
    updateFn.mockReset();
  });

  it("no credentials -> silent no-op", async () => {
    getCreds.mockResolvedValue(null);
    await persistProfileToAccount(prof(), undefined);
    expect(createFn).not.toHaveBeenCalled();
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("no remote entry -> create", async () => {
    await persistProfileToAccount(prof(), undefined);
    expect(createFn).toHaveBeenCalledTimes(1);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("remote entry, update succeeds -> single update at known revision", async () => {
    updateFn.mockResolvedValue({ success: true });
    await persistProfileToAccount(prof(), { revision: 5, updatedAt: 0 });
    expect(updateFn).toHaveBeenCalledTimes(1);
    expect(updateFn.mock.calls[0][3]).toBe(5); // revision arg
  });

  it("revision conflict -> retry once with rebuilt profile at server revision", async () => {
    updateFn
      .mockResolvedValueOnce({ success: false, current: { profile: prof({ name: "server" }), revision: 9 } })
      .mockResolvedValueOnce({ success: true });
    await persistProfileToAccount(prof({ name: "local" }), { revision: 5, updatedAt: 0 });
    expect(updateFn).toHaveBeenCalledTimes(2);
    expect(updateFn.mock.calls[1][3]).toBe(9); // retry at server's current revision
  });

  it("second conflict -> throws revision-mismatch", async () => {
    updateFn
      .mockResolvedValueOnce({ success: false, current: { profile: prof(), revision: 9 } })
      .mockResolvedValueOnce({ success: false, current: { profile: prof(), revision: 11 } });
    await expect(persistProfileToAccount(prof(), { revision: 5, updatedAt: 0 })).rejects.toThrow(
      "revision-mismatch",
    );
  });
});
