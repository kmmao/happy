import { describe, expect, it } from "vitest";

import { createSessionCryptoCodec } from "./sessionCryptoCodec";
import { createCipher, getRandomBytes } from "./encryption";
import type { AgentState, Metadata } from "./types";

// The codec is a typed wrapper around `Cipher`. The behavioural contract
// is "round-tripping any value goes through identical to the raw
// Cipher"; what the codec adds is the call-site ergonomics — intent-
// named methods + typed narrowing.
//
// These tests pin both the round-trip per content type AND that the
// codec still satisfies the structural Cipher contract (so it can be
// passed to RpcHandlerManager unchanged).

const newCodec = () => {
  const cipher = createCipher(getRandomBytes(32), "dataKey");
  return { cipher, codec: createSessionCryptoCodec(cipher) };
};

describe("SessionCryptoCodec — inherited Cipher contract (RpcCipher compat)", () => {
  it("encrypt + decrypt round-trip behaves identically to the underlying Cipher", () => {
    const { codec, cipher } = newCodec();
    const payload = { x: 1, y: "hi" };

    const wire = codec.encrypt(payload);
    expect(cipher.decrypt(wire)).toEqual({ ok: true, value: payload });

    // And the codec's own decrypt works too.
    expect(codec.decrypt(wire)).toEqual({ ok: true, value: payload });
  });

  it("decrypt returns { ok: false } on a garbage payload (same as Cipher)", () => {
    const { codec } = newCodec();
    expect(codec.decrypt("not-a-real-ciphertext")).toEqual({ ok: false });
  });
});

describe("SessionCryptoCodec — typed Metadata methods", () => {
  it("encryptMetadata + decodeMetadata round-trip preserves the value", () => {
    const { codec } = newCodec();
    const metadata: Metadata = {
      machineId: "m-1",
      summary: { text: "hi" },
    } as unknown as Metadata;

    const wire = codec.encryptMetadata(metadata);
    const decoded = codec.decodeMetadata(wire);
    expect(decoded).toEqual({ ok: true, value: metadata });
  });

  it("decodeMetadata narrows the result type to Metadata at the seam", () => {
    const { codec } = newCodec();
    const wire = codec.encryptMetadata({
      machineId: "m-1",
    } as unknown as Metadata);
    const decoded = codec.decodeMetadata(wire);

    if (decoded.ok) {
      // Type-only check: the narrowing must produce a `Metadata`-shaped
      // value at the callsite without a manual cast. This compiles only
      // if `decoded.value` is typed as Metadata (not `any`).
      const m: Metadata = decoded.value;
      expect(m.machineId).toBe("m-1");
    } else {
      throw new Error("expected decode to succeed");
    }
  });

  it("decodeMetadata returns { ok: false } on garbage", () => {
    const { codec } = newCodec();
    expect(codec.decodeMetadata("not-real")).toEqual({ ok: false });
  });
});

describe("SessionCryptoCodec — typed AgentState methods", () => {
  it("encryptAgentState + decodeAgentState round-trip preserves the value", () => {
    const { codec } = newCodec();
    const agentState: AgentState = {
      thinking: false,
    } as unknown as AgentState;

    const wire = codec.encryptAgentState(agentState);
    expect(codec.decodeAgentState(wire)).toEqual({ ok: true, value: agentState });
  });

  it("decodeAgentState narrows the result to AgentState", () => {
    const { codec } = newCodec();
    const wire = codec.encryptAgentState({
      thinking: true,
    } as unknown as AgentState);
    const decoded = codec.decodeAgentState(wire);

    if (decoded.ok) {
      const a: AgentState = decoded.value;
      expect((a as { thinking?: boolean }).thinking).toBe(true);
    } else {
      throw new Error("expected decode to succeed");
    }
  });
});

describe("SessionCryptoCodec — typed message content methods", () => {
  it("encryptMessageContent + decodeMessageContent round-trip preserves the value", () => {
    const { codec } = newCodec();
    const content = { kind: "text", body: "hello" };

    const wire = codec.encryptMessageContent(content);
    expect(codec.decodeMessageContent(wire)).toEqual({
      ok: true,
      value: content,
    });
  });

  it("decodeMessageContent returns { ok: false } on garbage", () => {
    const { codec } = newCodec();
    expect(codec.decodeMessageContent("not-real")).toEqual({ ok: false });
  });
});

describe("SessionCryptoCodec — cross-type ciphertext invariance", () => {
  it("a ciphertext produced by encryptMetadata can also be read by decrypt/decodeMessageContent (they share the underlying Cipher)", () => {
    // The intent-typed methods are ergonomic wrappers — the underlying
    // ciphertext format is one. This test pins that decoding via the
    // raw `decrypt` matches decoding via any typed `decodeX`, so
    // a future caller swapping seam method names doesn't change wire
    // bits.
    const { codec } = newCodec();
    const payload = { example: 42 };

    const wire = codec.encryptMetadata(payload as unknown as Metadata);
    expect(codec.decrypt(wire)).toEqual({ ok: true, value: payload });
    expect(codec.decodeMessageContent(wire)).toEqual({
      ok: true,
      value: payload,
    });
  });
});
