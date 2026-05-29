import { describe, it, expect, vi } from "vitest";
import { encodeBase64 } from "@/encryption/base64";
import { EncryptionCache } from "./encryptionCache";
import type { Decryptor, Encryptor } from "./encryptor";
import { SessionEncryption } from "./sessionEncryption";
import type { ApiMessage } from "../apiTypes";

// A fake adapter that JSON-encodes values to bytes instead of doing real
// crypto: encrypt → JSON bytes, decrypt → JSON.parse (or null on garbage).
// This exercises SessionEncryption's classification + caching without a real
// crypto backend, the same way codec.test.ts exercises the codec.
function jsonAdapter(): Encryptor & Decryptor {
  return {
    async encrypt(data) {
      return data.map((d) => new TextEncoder().encode(JSON.stringify(d)));
    },
    async decrypt(data) {
      return data.map((d) => {
        try {
          return JSON.parse(new TextDecoder().decode(d));
        } catch {
          return null;
        }
      });
    },
  };
}

// Build an encrypted ApiMessage whose ciphertext is the JSON bytes of `payload`.
function encryptedMessage(
  id: string,
  seq: number,
  payload: unknown,
  overrides: Partial<ApiMessage> = {},
): ApiMessage {
  const c = encodeBase64(new TextEncoder().encode(JSON.stringify(payload)));
  return {
    id,
    seq,
    localId: null,
    content: { t: "encrypted", c },
    createdAt: 1000 + seq,
    updatedAt: 1000 + seq,
    ...overrides,
  } as ApiMessage;
}

// An encrypted ApiMessage whose ciphertext is NOT valid JSON, so the adapter
// yields null — i.e. a genuine decrypt failure.
function corruptMessage(id: string, seq: number): ApiMessage {
  const c = encodeBase64(new TextEncoder().encode("not-json{"));
  return {
    id,
    seq,
    localId: null,
    content: { t: "encrypted", c },
    createdAt: 1000 + seq,
    updatedAt: 1000 + seq,
  } as ApiMessage;
}

function makeSession() {
  const cache = new EncryptionCache();
  const adapter = jsonAdapter();
  return { cache, adapter, enc: new SessionEncryption("s1", adapter, cache) };
}

describe("SessionEncryption.decryptMessageOutcomes", () => {
  it("returns ok:true with decrypted content for an encrypted message", async () => {
    const { enc } = makeSession();
    const [outcome] = await enc.decryptMessageOutcomes([
      encryptedMessage("m1", 1, { role: "user", text: "hi" }),
    ]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.message.id).toBe("m1");
    expect(outcome.message.seq).toBe(1);
    expect(outcome.message.content).toEqual({ role: "user", text: "hi" });
  });

  it("classifies a payload the cipher cannot decrypt as decrypt-failed", async () => {
    const { enc } = makeSession();
    const [outcome] = await enc.decryptMessageOutcomes([
      corruptMessage("m2", 2),
    ]);

    expect(outcome).toEqual({
      ok: false,
      reason: "decrypt-failed",
      seq: 2,
      id: "m2",
    });
  });

  it("classifies a non-encrypted record as not-encrypted", async () => {
    const { enc } = makeSession();
    const notEncrypted = {
      id: "m3",
      seq: 3,
      localId: null,
      content: { t: "plain", c: "whatever" },
      createdAt: 1003,
      updatedAt: 1003,
    } as unknown as ApiMessage;

    const [outcome] = await enc.decryptMessageOutcomes([notEncrypted]);

    expect(outcome).toEqual({
      ok: false,
      reason: "not-encrypted",
      seq: 3,
      id: "m3",
    });
  });

  it("classifies an empty input slot as missing", async () => {
    const { enc } = makeSession();
    const [outcome] = await enc.decryptMessageOutcomes([
      undefined as unknown as ApiMessage,
    ]);

    expect(outcome).toEqual({
      ok: false,
      reason: "missing",
      seq: null,
      id: null,
    });
  });

  it("preserves per-message classification across a mixed batch", async () => {
    const { enc } = makeSession();
    const outcomes = await enc.decryptMessageOutcomes([
      encryptedMessage("ok1", 1, { role: "user" }),
      corruptMessage("bad1", 2),
      encryptedMessage("ok2", 3, { role: "agent" }),
    ]);

    expect(outcomes.map((o) => (o.ok ? "ok" : o.reason))).toEqual([
      "ok",
      "decrypt-failed",
      "ok",
    ]);
  });

  it("serves a successful decrypt from cache without re-invoking the cipher", async () => {
    const { cache, adapter, enc } = makeSession();
    const spy = vi.spyOn(adapter, "decrypt");
    const msg = encryptedMessage("cached1", 1, { role: "user", text: "once" });

    const first = await enc.decryptMessageOutcomes([msg]);
    expect(first[0].ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    // Second call for the same id is served from cache — the cipher is not hit.
    const second = await enc.decryptMessageOutcomes([msg]);
    expect(second[0].ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(cache.getStats().messages).toBe(1);
  });

  it("caches a decrypt failure as a negative result (reported decrypt-failed on replay)", async () => {
    const { adapter, enc } = makeSession();
    const spy = vi.spyOn(adapter, "decrypt");
    const msg = corruptMessage("bad-cached", 7);

    const first = await enc.decryptMessageOutcomes([msg]);
    expect(first[0]).toMatchObject({ ok: false, reason: "decrypt-failed" });
    expect(spy).toHaveBeenCalledTimes(1);

    // The negative result is cached, so a replay does not re-attempt decryption.
    const second = await enc.decryptMessageOutcomes([msg]);
    expect(second[0]).toMatchObject({ ok: false, reason: "decrypt-failed" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
