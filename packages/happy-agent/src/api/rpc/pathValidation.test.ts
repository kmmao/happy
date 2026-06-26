import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { validatePath } from "./pathValidation";

describe("validatePath", () => {
    let root: string; // realpath'd working directory
    let outside: string; // a sibling directory outside the allowlist

    beforeAll(() => {
        // realpath the temp base to dodge /var → /private/var symlinking on macOS.
        outside = realpathSync(mkdtempSync(join(tmpdir(), "happy-pathval-")));
        const work = join(outside, "work");
        mkdirSync(work, { recursive: true });
        root = realpathSync(work);
        writeFileSync(join(root, "inside.txt"), "ok");
        writeFileSync(join(outside, "secret.txt"), "secret");
    });

    afterAll(() => {
        rmSync(outside, { recursive: true, force: true });
    });

    it("accepts the working directory itself and files inside it", () => {
        expect(validatePath(".", root).valid).toBe(true);
        expect(validatePath("inside.txt", root).valid).toBe(true);
    });

    it("rejects a parent-relative traversal that escapes the working directory", () => {
        const result = validatePath("../secret.txt", root);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("outside the allowed directories");
    });

    it("rejects an absolute path outside the working directory", () => {
        expect(validatePath(join(outside, "secret.txt"), root).valid).toBe(false);
    });

    it("rejects a symlink whose real target escapes the allowlist", () => {
        const link = join(root, "escape-link");
        symlinkSync(join(outside, "secret.txt"), link);
        // The link path is inside root, but its realpath is outside → rejected.
        expect(validatePath("escape-link", root).valid).toBe(false);
    });

    it("accepts a path inside an explicitly allowed extra directory", () => {
        expect(validatePath(join(outside, "secret.txt"), root, [outside]).valid).toBe(true);
    });

    it("rejects a non-existent file whose real parent is outside the allowlist", () => {
        expect(validatePath(join(outside, "new-file.txt"), root).valid).toBe(false);
    });

    it("accepts creating a new (non-existent) file inside the working directory", () => {
        expect(validatePath("new-inside.txt", root).valid).toBe(true);
    });
});
