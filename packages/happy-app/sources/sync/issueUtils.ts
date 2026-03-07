/**
 * Utility functions for parsing git remote URLs into RepoInfo
 */

import type { RepoInfo, RepoProvider, GitHostMapping } from "./issueTypes";

// SSH format: git@github.com:owner/repo.git
const SSH_REGEX = /^git@([^:]+):([^/]+)\/([^/.]+?)(?:\.git)?$/;

// SSH URL format: ssh://git@host:port/owner/repo.git
const SSH_URL_REGEX = /^ssh:\/\/[^@]+@([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/;

// HTTPS format: https://github.com/owner/repo.git or https://github.com/owner/repo
const HTTPS_REGEX = /^https?:\/\/([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/;

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

// Whitelist for owner/repo slugs — prevents command injection in shell commands
const SAFE_SLUG = /^[a-zA-Z0-9._-]+$/;

/**
 * Strip protocol prefix from a host string if present.
 * "http://10.10.10.234:8418" → { bare: "10.10.10.234:8418", protocol: "http" }
 * "10.10.10.234:8418" → { bare: "10.10.10.234:8418", protocol: null }
 */
function parseHostEntry(host: string): {
  bare: string;
  protocol: string | null;
} {
  const m = host.match(/^(https?):\/\/(.+)/);
  if (m) return { bare: m[2].replace(/\/$/, ""), protocol: m[1] };
  return { bare: host, protocol: null };
}

/**
 * Strip port from a host string.
 * "10.10.10.234:8418" → "10.10.10.234"
 * "10.10.10.234" → "10.10.10.234"
 * "[::1]:8418" → "[::1]" (IPv6)
 */
function stripPort(host: string): string {
  // IPv6 in brackets: [::1]:port
  if (host.startsWith("[")) {
    const bracketEnd = host.indexOf("]");
    if (bracketEnd >= 0) return host.slice(0, bracketEnd + 1);
    return host;
  }
  // hostname:port or ip:port
  const colonIdx = host.lastIndexOf(":");
  if (colonIdx < 0) return host;
  // Only strip if what follows the colon is a number (port)
  const maybePort = host.slice(colonIdx + 1);
  if (/^\d+$/.test(maybePort)) return host.slice(0, colonIdx);
  return host;
}

/**
 * Find a gitHosts mapping that matches a given host.
 * Tries exact match first, then hostname-only match (ignoring port differences).
 * This handles the case where SSH remotes have no port (e.g. "10.10.10.234")
 * but the gitHosts config has a port (e.g. "http://10.10.10.234:8418").
 */
export function findGitHostMapping(
  host: string,
  gitHosts: readonly GitHostMapping[],
): GitHostMapping | undefined {
  const hostLower = host.toLowerCase();
  // 1. Exact bare match (e.g. "10.10.10.234:8418" === "10.10.10.234:8418")
  const exact = gitHosts.find(
    (m) => parseHostEntry(m.host).bare.toLowerCase() === hostLower,
  );
  if (exact) return exact;
  // 2. Hostname-only match (e.g. "10.10.10.234" matches "10.10.10.234:8418")
  const hostOnly = stripPort(hostLower);
  return gitHosts.find(
    (m) => stripPort(parseHostEntry(m.host).bare.toLowerCase()) === hostOnly,
  );
}

function detectProvider(
  host: string,
  gitHosts?: readonly GitHostMapping[],
): RepoProvider {
  // 1. User-configured host mappings take highest priority
  if (gitHosts && gitHosts.length > 0) {
    const mapping = findGitHostMapping(host, gitHosts);
    if (mapping) return mapping.provider;
  }

  // 2. Built-in GitHub host detection
  if (GITHUB_HOSTS.has(host.toLowerCase())) {
    return "github";
  }

  // 3. Non-GitHub hosts default to Gitea (covers Gitea, Forgejo, Gogs — same API)
  return "gitea";
}

/**
 * Build API base URL for Gitea-compatible hosts.
 * Priority for protocol detection:
 * 1. User-configured host entry with protocol (e.g. "http://10.10.10.234:8418")
 * 2. Remote URL protocol (for HTTPS remotes)
 * 3. Fallback to "https"
 */
function buildApiBase(
  host: string,
  remoteUrl: string,
  gitHosts?: readonly GitHostMapping[],
): string {
  // Check if user specified protocol/port in gitHosts config
  if (gitHosts && gitHosts.length > 0) {
    const mapping = findGitHostMapping(host, gitHosts);
    if (mapping) {
      const { bare, protocol } = parseHostEntry(mapping.host);
      // Use the full bare from config (includes port if specified)
      // e.g. config "http://10.10.10.234:8418" → bare "10.10.10.234:8418"
      const apiHost = bare;
      const apiProtocol = protocol ?? "https";
      return `${apiProtocol}://${apiHost}/api/v1`;
    }
  }

  // Fall back to remote URL protocol
  const match = remoteUrl.match(/^(https?):\/\//);
  const protocol = match ? match[1] : "https";
  return `${protocol}://${host}/api/v1`;
}

/**
 * Find API token from gitHosts config for a given host.
 */
function findApiToken(
  host: string,
  gitHosts?: readonly GitHostMapping[],
): string | undefined {
  if (!gitHosts || gitHosts.length === 0) return undefined;
  const mapping = findGitHostMapping(host, gitHosts);
  return mapping?.apiToken || undefined;
}

/**
 * Parse a git remote URL into structured RepoInfo.
 * Returns null if the URL cannot be parsed.
 *
 * @param url - Git remote URL (SSH or HTTPS format)
 * @param gitHosts - Optional user-configured host→provider mappings
 */
export function parseRemoteUrl(
  url: string,
  gitHosts?: readonly GitHostMapping[],
): RepoInfo | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Try SSH format (git@host:owner/repo.git)
  const sshMatch = trimmed.match(SSH_REGEX);
  if (sshMatch) {
    const [, host, owner, repo] = sshMatch;
    if (!SAFE_SLUG.test(owner) || !SAFE_SLUG.test(repo)) return null;
    const provider = detectProvider(host, gitHosts);
    return {
      provider,
      owner,
      repo,
      remoteUrl: trimmed,
      apiBase:
        provider === "gitea"
          ? buildApiBase(host, trimmed, gitHosts)
          : undefined,
      apiToken: findApiToken(host, gitHosts),
    };
  }

  // Try SSH URL format (ssh://git@host:port/owner/repo.git)
  const sshUrlMatch = trimmed.match(SSH_URL_REGEX);
  if (sshUrlMatch) {
    const [, host, owner, repo] = sshUrlMatch;
    if (!SAFE_SLUG.test(owner) || !SAFE_SLUG.test(repo)) return null;
    const provider = detectProvider(host, gitHosts);
    return {
      provider,
      owner,
      repo,
      remoteUrl: trimmed,
      apiBase:
        provider === "gitea"
          ? buildApiBase(host, trimmed, gitHosts)
          : undefined,
      apiToken: findApiToken(host, gitHosts),
    };
  }

  // Try HTTPS format (https://host/owner/repo.git)
  const httpsMatch = trimmed.match(HTTPS_REGEX);
  if (httpsMatch) {
    const [, host, owner, repo] = httpsMatch;
    if (!SAFE_SLUG.test(owner) || !SAFE_SLUG.test(repo)) return null;
    const provider = detectProvider(host, gitHosts);
    return {
      provider,
      owner,
      repo,
      remoteUrl: trimmed,
      apiBase:
        provider === "gitea"
          ? buildApiBase(host, trimmed, gitHosts)
          : undefined,
      apiToken: findApiToken(host, gitHosts),
    };
  }

  return null;
}
