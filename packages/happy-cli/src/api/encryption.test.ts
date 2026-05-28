import { describe, it, expect } from 'vitest';
import {
  createCipher,
  getRandomBytes,
  encodeBase64,
  type Cipher,
} from './encryption';

/**
 * Real-crypto tests for the Cipher adapter (no mocks, per CLI rules).
 *
 * The adapter is the single seam every transport client encrypts/decrypts
 * through, so these tests pin the two properties the rest of the code relies
 * on: round-trip fidelity across both variants, and a `decrypt` that is TOTAL
 * (never throws) and discriminates a real failure from a legitimately-falsy
 * recovered value.
 */
describe('Cipher adapter', () => {
  const variants: Array<'legacy' | 'dataKey'> = ['legacy', 'dataKey'];

  for (const variant of variants) {
    describe(`variant=${variant}`, () => {
      const newCipher = (): Cipher => createCipher(getRandomBytes(32), variant);

      it('round-trips a structured value', () => {
        const cipher = newCipher();
        const value = { a: 1, b: 'two', c: [3, { d: true }], e: null };
        const result = cipher.decrypt(cipher.encrypt(value));
        expect(result).toEqual({ ok: true, value });
      });

      it('discriminates legitimately-falsy values from failure (false / 0 / "")', () => {
        const cipher = newCipher();
        for (const value of [false, 0, '']) {
          expect(cipher.decrypt(cipher.encrypt(value))).toEqual({ ok: true, value });
        }
      });

      it('returns { ok: false } on garbage input instead of throwing', () => {
        const cipher = newCipher();
        expect(cipher.decrypt('!!!not base64!!!')).toEqual({ ok: false });
        expect(cipher.decrypt('')).toEqual({ ok: false });
        expect(cipher.decrypt(encodeBase64(getRandomBytes(64)))).toEqual({ ok: false });
      });

      it('returns { ok: false } when decrypting with a different key', () => {
        const sender = newCipher();
        const wrong = newCipher();
        expect(wrong.decrypt(sender.encrypt({ secret: 42 }))).toEqual({ ok: false });
      });
    });
  }

  it('does not cross-decrypt between variants (wrong variant => { ok: false })', () => {
    const key = getRandomBytes(32);
    const legacy = createCipher(key, 'legacy');
    const dataKey = createCipher(key, 'dataKey');
    // Same key, different wire format: each must reject the other's ciphertext.
    expect(dataKey.decrypt(legacy.encrypt({ hi: 1 }))).toEqual({ ok: false });
    expect(legacy.decrypt(dataKey.encrypt({ hi: 1 }))).toEqual({ ok: false });
  });
});
