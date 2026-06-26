/**
 * Git URL parsing — turns the many shapes a repo/host can arrive in into
 * structured coordinates and a canonical clone URL.
 *
 * Extracted from `registerGitHandlers.ts` (~755 lines), where these pure
 * functions were private and exercised only by the live `cloneGitRepo` /
 * git-host RPC handlers. The regexes are the brittle part — SSH scp-style,
 * `ssh://` scheme, and HTTPS each make assumptions (single owner/repo segment,
 * `.git` suffix handling, host without explicit port) that a direct test should
 * pin. No behavior change: bodies moved verbatim.
 */

export interface ParsedHostEntry {
  bare: string;
  protocol: string | null;
}

export interface CloneCoordinates {
  host: string;
  owner: string;
  repo: string;
}

/** Split a configured host string into its bare host and optional protocol. */
export function parseHostEntry(host: string): ParsedHostEntry {
  const match = host.match(/^(https?):\/\/(.+)/);
  if (match) {
    return { bare: match[2].replace(/\/$/, ""), protocol: match[1] };
  }
  return { bare: host.replace(/\/$/, ""), protocol: null };
}

/**
 * Parse a repo URL (scp-style SSH, `ssh://`, or HTTPS) into host/owner/repo.
 * Returns null when no known shape matches.
 */
export function parseCloneCoordinates(repoUrl: string): CloneCoordinates | null {
  const trimmed = repoUrl.trim();
  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { host: sshMatch[1], owner: sshMatch[2], repo: sshMatch[3] };
  }

  const sshUrlMatch = trimmed.match(/^ssh:\/\/[^@]+@([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshUrlMatch) {
    return { host: sshUrlMatch[1], owner: sshUrlMatch[2], repo: sshUrlMatch[3] };
  }

  const httpsMatch = trimmed.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { host: httpsMatch[1], owner: httpsMatch[2], repo: httpsMatch[3] };
  }

  return null;
}

/**
 * Canonicalize a repo URL for cloning. HTTPS URLs pass through unchanged; other
 * shapes are reparsed and rebuilt against the configured host's protocol (or
 * https) so a clone always uses an HTTPS-style URL. Unparseable input is
 * returned as-is.
 */
export function resolveCloneUrl(repoUrl: string, configuredHost?: string): string {
  if (/^https?:\/\//.test(repoUrl)) {
    return repoUrl;
  }

  const coords = parseCloneCoordinates(repoUrl);
  if (!coords) return repoUrl;

  const hostEntry = configuredHost ? parseHostEntry(configuredHost) : null;
  const protocol = hostEntry?.protocol ?? "https";
  const bareHost = hostEntry?.bare ?? coords.host;
  return `${protocol}://${bareHost}/${coords.owner}/${coords.repo}.git`;
}
