import { describe, it, expect } from "vitest";
import { readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { writePromptFile } from "./promptFileWriter";

describe("writePromptFile", () => {
  it("creates the directory (recursively) and writes the content, returning the path", async () => {
    const dir = join(tmpdir(), "happy-test", `pfw-${process.pid}`, "nested");
    const filename = "prompt.md";
    try {
      const filepath = await writePromptFile(dir, filename, "hello body");
      expect(filepath).toBe(join(dir, filename));
      expect(await readFile(filepath, "utf-8")).toBe("hello body");
    } finally {
      await rm(join(tmpdir(), "happy-test", `pfw-${process.pid}`), {
        recursive: true,
        force: true,
      });
    }
  });
});
