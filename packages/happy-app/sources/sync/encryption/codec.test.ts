import { describe, it, expect } from "vitest";
import { encryptValue, decryptValue, decryptValueSafe } from "./codec";
import type { Decryptor, Encryptor } from "./encryptor";
import { encodeBase64 } from "@/encryption/base64";

// A fake adapter that JSON-encodes values to bytes instead of doing real
// crypto. This exercises the codec's encode/decode/null-handling — the actual
// AES/NaCl adapters are covered by encryptor.appspec.ts.
const jsonAdapter: Encryptor & Decryptor = {
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

describe("encryption codec", () => {
    it("round-trips a value through encryptValue/decryptValue", async () => {
        const enc = await encryptValue(jsonAdapter, { hello: "world", n: 1 });
        expect(typeof enc).toBe("string");
        const dec = await decryptValue(jsonAdapter, enc);
        expect(dec).toEqual({ hello: "world", n: 1 });
    });

    it("decryptValue returns null when the adapter yields a falsy item", async () => {
        const nullAdapter: Decryptor = {
            async decrypt() {
                return [null];
            },
        };
        const result = await decryptValue(nullAdapter, encodeBase64(new Uint8Array([1, 2, 3])));
        expect(result).toBeNull();
    });

    it("decryptValue propagates adapter errors", async () => {
        const throwing: Decryptor = {
            async decrypt() {
                throw new Error("boom");
            },
        };
        await expect(decryptValue(throwing, "AAAA")).rejects.toThrow("boom");
    });

    it("decryptValueSafe swallows adapter errors to null", async () => {
        const throwing: Decryptor = {
            async decrypt() {
                throw new Error("boom");
            },
        };
        expect(await decryptValueSafe(throwing, "AAAA")).toBeNull();
    });
});
