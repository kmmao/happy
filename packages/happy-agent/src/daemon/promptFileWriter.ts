import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

/**
 * Ensure `dir` exists and write `content` to `dir/filename`, returning the full
 * path. The trigger handlers and the loop coordinator both stage an agent's
 * initial prompt as a temp `.md` file this way; they differ only in the target
 * directory, the filename pattern, and the content wrapping, so those stay with
 * each caller while the mkdir-recursive + utf-8 write mechanic lives here once.
 */
export async function writePromptFile(
  dir: string,
  filename: string,
  content: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filepath = join(dir, filename);
  await writeFile(filepath, content, "utf-8");
  return filepath;
}
