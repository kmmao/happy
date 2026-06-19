import { beforeEach, describe, expect, it, vi } from "vitest";

// syncEncryptionScope only imports `@/log` at runtime (everything else is a
// type-only import, erased at compile time), so this is the only mock needed.
vi.mock("@/log", () => ({
  log: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let resolveSessionEncryption: typeof import("./syncEncryptionScope").resolveSessionEncryption;
let resolveMachineEncryption: typeof import("./syncEncryptionScope").resolveMachineEncryption;

describe("syncEncryptionScope", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("./syncEncryptionScope");
    resolveSessionEncryption = mod.resolveSessionEncryption;
    resolveMachineEncryption = mod.resolveMachineEncryption;
  });

  it("session:encryption 初次缺失则先 awaitQueue 再重读,而非直接丢弃 (#80/#84)", async () => {
    const enc = {};
    const getSessionEncryption = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValue(enc);
    const awaitQueue = vi.fn(async () => {});
    const forceRefetch = vi.fn();

    const result = await resolveSessionEncryption("s1", {
      encryption: { getSessionEncryption },
      sessionsSync: { awaitQueue, forceRefetch },
      machinesSync: { awaitQueue: vi.fn(async () => {}), forceRefetch: vi.fn() },
    } as any);

    expect(result).toBe(enc);
    expect(awaitQueue).toHaveBeenCalledTimes(1);
    expect(getSessionEncryption).toHaveBeenCalledTimes(2);
    expect(forceRefetch).not.toHaveBeenCalled();
  });

  it("session:awaitQueue 后仍缺失则回退到 forceRefetch 并返回 null", async () => {
    const getSessionEncryption = vi.fn().mockReturnValue(null);
    const awaitQueue = vi.fn(async () => {});
    const forceRefetch = vi.fn();

    const result = await resolveSessionEncryption("s1", {
      encryption: { getSessionEncryption },
      sessionsSync: { awaitQueue, forceRefetch },
      machinesSync: { awaitQueue: vi.fn(async () => {}), forceRefetch: vi.fn() },
    } as any);

    expect(result).toBeNull();
    expect(awaitQueue).toHaveBeenCalledTimes(1);
    expect(forceRefetch).toHaveBeenCalledTimes(1);
  });

  it("machine:encryption 初次缺失则先 awaitQueue(machinesSync) 再重读 —— 修复此前被静默丢弃的 race", async () => {
    const enc = {};
    const getMachineEncryption = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValue(enc);
    const awaitQueue = vi.fn(async () => {});
    const forceRefetch = vi.fn();

    const result = await resolveMachineEncryption("m1", {
      encryption: { getMachineEncryption },
      sessionsSync: { awaitQueue: vi.fn(async () => {}), forceRefetch: vi.fn() },
      machinesSync: { awaitQueue, forceRefetch },
    } as any);

    expect(result).toBe(enc);
    expect(awaitQueue).toHaveBeenCalledTimes(1);
    expect(getMachineEncryption).toHaveBeenCalledTimes(2);
    expect(forceRefetch).not.toHaveBeenCalled();
  });

  it("machine:awaitQueue 后仍缺失则回退到 forceRefetch 并返回 null", async () => {
    const getMachineEncryption = vi.fn().mockReturnValue(null);
    const awaitQueue = vi.fn(async () => {});
    const forceRefetch = vi.fn();

    const result = await resolveMachineEncryption("m1", {
      encryption: { getMachineEncryption },
      sessionsSync: { awaitQueue: vi.fn(async () => {}), forceRefetch: vi.fn() },
      machinesSync: { awaitQueue, forceRefetch },
    } as any);

    expect(result).toBeNull();
    expect(awaitQueue).toHaveBeenCalledTimes(1);
    expect(forceRefetch).toHaveBeenCalledTimes(1);
  });

  it("session:encryptor 已就绪但 extraReady(session row)初次未就绪时,仍 awaitQueue 而非丢弃 (#80 窗口)", async () => {
    const enc = {};
    // encryptor 一直在(initializeSessions 早于 applySessions 注册)
    const getSessionEncryption = vi.fn().mockReturnValue(enc);
    let sessionRowReady = false;
    const awaitQueue = vi.fn(async () => {
      sessionRowReady = true; // in-flight sync 落地后才写入 session row
    });
    const forceRefetch = vi.fn();

    const result = await resolveSessionEncryption(
      "s1",
      {
        encryption: { getSessionEncryption },
        sessionsSync: { awaitQueue, forceRefetch },
        machinesSync: {
          awaitQueue: vi.fn(async () => {}),
          forceRefetch: vi.fn(),
        },
      } as any,
      () => sessionRowReady,
    );

    expect(result).toBe(enc);
    expect(awaitQueue).toHaveBeenCalledTimes(1);
    expect(forceRefetch).not.toHaveBeenCalled();
  });
});
