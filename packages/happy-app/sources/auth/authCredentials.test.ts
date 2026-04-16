import { describe, expect, it } from "vitest";
import { encodeBase64 } from "@/encryption/base64";
import {
  getCredentialContentDataKey,
  hasCredentialSecret,
} from "./authCredentials";

describe("hasCredentialSecret", () => {
  it("accepts secret-backed credentials", () => {
    expect(hasCredentialSecret({
      token: "token-1",
      secret: "secret-1",
    })).toBe(true);
  });

  it("rejects credentials without a usable secret", () => {
    expect(hasCredentialSecret({
      token: "token-1",
    })).toBe(false);
    expect(hasCredentialSecret({
      token: "token-1",
      secret: "",
    })).toBe(false);
  });
});

describe("getCredentialContentDataKey", () => {
  it("reads a base64url-encoded public key", () => {
    const bytes = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));
    const encoded = encodeBase64(bytes, "base64url");

    expect(getCredentialContentDataKey({
      token: "token-1",
      encryption: {
        publicKey: encoded,
      },
    })).toEqual(bytes);
  });

  it("returns null for missing or malformed public keys", () => {
    expect(getCredentialContentDataKey({
      token: "token-1",
    })).toBeNull();
    expect(getCredentialContentDataKey({
      token: "token-1",
      encryption: {
        publicKey: "not-a-real-key",
      },
    })).toBeNull();
  });
});
