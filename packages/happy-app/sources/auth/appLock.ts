/**
 * App Lock — PIN storage
 *
 * Threat model: this is a *privacy deterrent gate*. It controls access to the
 * app UI on this device only. It does NOT protect the end-to-end encryption
 * keys (those live separately and are never touched here) and is not meant to
 * withstand a forensic attack on a compromised device.
 *
 * What we store: only a random salt + a salted SHA-256 hash of the PIN, kept in
 * the OS keychain via expo-secure-store. The plaintext PIN is never persisted.
 * A 6-digit PIN is inherently low-entropy, so the real defenses are (1) the
 * hardware-backed keychain, which requires device compromise to read, and
 * (2) the UI-level retry limit / cooldown in the lock screen. Heavy key
 * stretching of a 6-digit space would add little and hurt unlock latency, so we
 * deliberately keep a single salted hash.
 *
 * This module is mobile-only by intent — callers guard `Platform.OS !== 'web'`
 * before invoking it, so it does not import react-native.
 */

import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

const PIN_KEY = "happy_app_lock_pin_v1";

/** Required PIN length (decision: 6-digit numeric). */
export const PIN_LENGTH = 6;

interface StoredPin {
  version: 1;
  salt: string; // hex-encoded random salt
  hash: string; // hex-encoded salted SHA-256 of the PIN
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    buffer,
  );
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Derive the stored hash for a PIN given a salt. Pure given its inputs — exposed
 * for testing. The salt is mixed in as a hex prefix so two devices with the same
 * PIN produce different hashes.
 */
export async function derivePinHash(pin: string, saltHex: string): Promise<string> {
  return sha256Hex(`${saltHex}:${pin}`);
}

/** True when `pin` is exactly PIN_LENGTH ASCII digits. */
export function isValidPinFormat(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/** Store a new PIN (overwrites any existing one). */
export async function setPin(pin: string): Promise<void> {
  if (!isValidPinFormat(pin)) {
    throw new Error(`PIN must be exactly ${PIN_LENGTH} digits`);
  }
  const saltBytes = await Crypto.getRandomBytesAsync(16);
  const saltHex = bytesToHex(saltBytes);
  const hash = await derivePinHash(pin, saltHex);
  const payload: StoredPin = { version: 1, salt: saltHex, hash };
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(payload));
}

/** Returns true if a PIN is currently configured on this device. */
export async function hasPin(): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(PIN_KEY);
  return !!stored;
}

/** Verify a candidate PIN against the stored hash. */
export async function verifyPin(candidate: string): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(PIN_KEY);
  if (!stored) return false;
  let parsed: StoredPin;
  try {
    parsed = JSON.parse(stored) as StoredPin;
  } catch {
    return false;
  }
  if (parsed?.version !== 1 || typeof parsed.salt !== "string") return false;
  const candidateHash = await derivePinHash(candidate, parsed.salt);
  return candidateHash === parsed.hash;
}

/** Remove the stored PIN (used when disabling the lock or on forgot-PIN logout). */
export async function clearPin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY);
}
