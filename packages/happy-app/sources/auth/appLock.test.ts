import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";

// In-memory secure store, reset before each test.
const store = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => (store.has(key) ? store.get(key)! : null),
  setItemAsync: async (key: string, value: string) => {
    store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    store.delete(key);
  },
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: async (_algo: string, buffer: ArrayBuffer) =>
    new Uint8Array(createHash("sha256").update(Buffer.from(buffer)).digest()).buffer,
  getRandomBytesAsync: async (n: number) => new Uint8Array(randomBytes(n)),
}));

import {
  setPin,
  verifyPin,
  hasPin,
  clearPin,
  derivePinHash,
  isValidPinFormat,
  PIN_LENGTH,
} from "./appLock";

describe("appLock PIN store", () => {
  beforeEach(() => {
    store.clear();
  });

  it("validates PIN format (exactly 6 digits)", () => {
    expect(isValidPinFormat("123456")).toBe(true);
    expect(isValidPinFormat("12345")).toBe(false);
    expect(isValidPinFormat("1234567")).toBe(false);
    expect(isValidPinFormat("12a456")).toBe(false);
    expect(isValidPinFormat("")).toBe(false);
    expect(PIN_LENGTH).toBe(6);
  });

  it("rejects setting an invalid PIN", async () => {
    await expect(setPin("12")).rejects.toThrow();
    expect(await hasPin()).toBe(false);
  });

  it("hasPin reflects storage state", async () => {
    expect(await hasPin()).toBe(false);
    await setPin("135790");
    expect(await hasPin()).toBe(true);
    await clearPin();
    expect(await hasPin()).toBe(false);
  });

  it("verifies the correct PIN and rejects the wrong one", async () => {
    await setPin("246810");
    expect(await verifyPin("246810")).toBe(true);
    expect(await verifyPin("000000")).toBe(false);
  });

  it("returns false when no PIN is set", async () => {
    expect(await verifyPin("123456")).toBe(false);
  });

  it("never persists the plaintext PIN", async () => {
    await setPin("424242");
    const raw = JSON.stringify([...store.values()]);
    expect(raw).not.toContain("424242");
  });

  it("salts the hash: same PIN yields different stored hashes across devices", async () => {
    await setPin("111111");
    const first = JSON.parse([...store.values()][0]);
    store.clear();
    await setPin("111111");
    const second = JSON.parse([...store.values()][0]);
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it("derivePinHash is deterministic for a fixed salt and salt-sensitive", async () => {
    const a = await derivePinHash("123456", "aabbcc");
    const b = await derivePinHash("123456", "aabbcc");
    const c = await derivePinHash("123456", "ddeeff");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
