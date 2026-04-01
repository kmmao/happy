import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const remoteCache = new Map<string, string | null>();

export function normalizeRemoteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`.replace(/\/+$/, "");
  }
  const sshUrlMatch = trimmed.match(/^ssh:\/\/[^@]+@([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshUrlMatch) {
    return `https://${sshUrlMatch[1]}/${sshUrlMatch[2]}`.replace(/\/+$/, "");
  }
  return trimmed.replace(/\.git$/, "").replace(/\/+$/, "");
}

export async function getGitRemoteUrl(directory: string): Promise<string | undefined> {
  if (remoteCache.has(directory)) {
    return remoteCache.get(directory) ?? undefined;
  }
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd: directory,
      timeout: 3_000,
    });
    const normalized = normalizeRemoteUrl(stdout);
    remoteCache.set(directory, normalized ?? null);
    return normalized;
  } catch {
    remoteCache.set(directory, null);
    return undefined;
  }
}
