import { describe, it, expect } from "vitest";
import { validatePath } from "./pathSecurity";
import { mkdirSync, symlinkSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("validatePath", () => {
  const workingDir = "/home/user/project";

  it("should allow paths within working directory", () => {
    expect(validatePath("/home/user/project/file.txt", workingDir).valid).toBe(
      true,
    );
    expect(validatePath("file.txt", workingDir).valid).toBe(true);
    expect(validatePath("./src/file.txt", workingDir).valid).toBe(true);
  });

  it("should reject paths outside working directory", () => {
    const result = validatePath("/etc/passwd", workingDir);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("outside the allowed directories");
  });

  it("should prevent path traversal attacks", () => {
    const result = validatePath("../../.ssh/id_rsa", workingDir);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("outside the allowed directories");
  });

  it("should allow the working directory itself", () => {
    expect(validatePath(".", workingDir).valid).toBe(true);
    expect(validatePath(workingDir, workingDir).valid).toBe(true);
  });

  it("should allow paths in additional allowed directories", () => {
    // Create real temp dirs so realpathSync resolves symlinks consistently
    const { mkdtempSync, mkdirSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const base = mkdtempSync(join(tmpdir(), "happy-test-"));
    const uploadsDir = join(base, "uploads");
    const sessionDir = join(uploadsDir, "session");
    mkdirSync(sessionDir, { recursive: true });
    try {
      expect(
        validatePath(join(sessionDir, "file.jpg"), workingDir, [uploadsDir])
          .valid,
      ).toBe(true);
      expect(
        validatePath(join(uploadsDir, "img.png"), workingDir, [uploadsDir])
          .valid,
      ).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("should reject paths outside all allowed directories", () => {
    const { mkdtempSync, mkdirSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const base = mkdtempSync(join(tmpdir(), "happy-test-"));
    const uploadsDir = join(base, "uploads");
    const evilDir = join(base, "evil");
    mkdirSync(uploadsDir, { recursive: true });
    mkdirSync(evilDir, { recursive: true });
    try {
      const result = validatePath(join(evilDir, "file.txt"), workingDir, [uploadsDir]);
      expect(result.valid).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("should prevent traversal out of additional allowed directory", () => {
    const tmpDir = "/tmp/happy/uploads";
    const result = validatePath(
      "/tmp/happy/uploads/../../etc/passwd",
      workingDir,
      [tmpDir],
    );
    expect(result.valid).toBe(false);
  });

  it("should prevent symlink traversal out of allowed directory", () => {
    // Create a real temp dir structure with a symlink pointing outside
    const testBase = join(tmpdir(), "happy-test-symlink-" + Date.now());
    const allowedDir = join(testBase, "uploads");
    // outsideDir is placed OUTSIDE testBase so it's not under the working directory
    const outsideDir = join(tmpdir(), "happy-test-outside-" + Date.now());
    const symlinkPath = join(allowedDir, "evil-link");

    try {
      mkdirSync(allowedDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
      symlinkSync(outsideDir, symlinkPath);

      // The symlink resolves to outsideDir, which is NOT under allowedDir or testBase
      const result = validatePath(join(symlinkPath, "secret.txt"), testBase, [
        allowedDir,
      ]);
      expect(result.valid).toBe(false);
    } finally {
      if (existsSync(testBase)) {
        rmSync(testBase, { recursive: true, force: true });
      }
      if (existsSync(outsideDir)) {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    }
  });
});
