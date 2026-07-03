/**
 * MachineMetadataSchema drift regression — the App schema is the wire base
 * plus explicit App extensions. Pins the two bugs the hand-copied mirror
 * had: silently stripping `happyLibDir` (Zod drops unknown keys), and
 * rejecting nothing the CLI actually sends.
 */

import { describe, expect, it } from "vitest";
import { MachineMetadataSchema } from "./storageTypes";

// Exactly what a current CLI daemon publishes (initialMachineMetadata).
const CLI_PAYLOAD = {
    host: "mbp.local",
    platform: "darwin",
    happyCliVersion: "0.102.9",
    homeDir: "/Users/dev",
    happyHomeDir: "/Users/dev/.happy",
    happyLibDir: "/usr/local/lib/happy",
};

describe("MachineMetadataSchema (wire base + App extensions)", () => {
    it("keeps happyLibDir from a current CLI payload instead of stripping it", () => {
        const parsed = MachineMetadataSchema.parse(CLI_PAYLOAD);
        expect(parsed.happyLibDir).toBe("/usr/local/lib/happy");
    });

    it("still decrypts pre-happyLibDir ciphertexts (field relaxed to optional)", () => {
        const { happyLibDir: _omitted, ...legacy } = CLI_PAYLOAD;
        const parsed = MachineMetadataSchema.parse(legacy);
        expect(parsed.happyLibDir).toBeUndefined();
        expect(parsed.host).toBe("mbp.local");
    });

    it("round-trips the App-side displayName extension", () => {
        const parsed = MachineMetadataSchema.parse({
            ...CLI_PAYLOAD,
            displayName: "工作机",
        });
        expect(parsed.displayName).toBe("工作机");
    });

    it("accepts legacy optional writer fields without requiring them", () => {
        const parsed = MachineMetadataSchema.parse({
            ...CLI_PAYLOAD,
            username: "dev",
            arch: "arm64",
            daemonStatus: "running",
        });
        expect(parsed.username).toBe("dev");
        expect(parsed.daemonStatus).toBe("running");
    });

    it("rejects a payload missing the wire-required base fields", () => {
        expect(MachineMetadataSchema.safeParse({ host: "x" }).success).toBe(false);
    });
});
