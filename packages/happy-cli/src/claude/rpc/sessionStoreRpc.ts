/**
 * sessionStoreRpc — filesystem-based replacement for the SDK's session-store
 * helpers (`listSessions` / `getSessionInfo` / `deleteSession` /
 * `renameSession` / `getSessionMessages`).
 *
 * Background
 * ----------
 * Pre-PTY-migration we depended on `@anthropic-ai/claude-agent-sdk`'s
 * standalone exports for these five operations. The SDK itself reads
 * `~/.claude/projects/<encoded-cwd>/*.jsonl` (one JSONL per session)
 * — there's no remote API, no DB. So once we stopped spawning Claude via
 * the SDK we still need *this* read/write surface to power the App's
 * session sidebar. Implementing it in-tree is straightforward and
 * removes the last hard runtime dependency on the SDK package for
 * Remote-mode RPC.
 *
 * On-disk format (matches Claude TUI v2.x):
 *   - file path: `${CLAUDE_CONFIG_DIR | ~/.claude}/projects/<cwd-encoded>/<uuid>.jsonl`
 *   - cwd-encoded: `resolve(cwd).replace(/[^a-zA-Z0-9-]/g, '-')` (see utils/path.ts)
 *   - one JSON object per line. Known `type` values:
 *       "user" / "assistant" / "system"  — chat messages
 *       "summary"                        — `{ summary: string }`
 *       "custom-title"                   — `{ customTitle: string }` (rename appends)
 *       "tag"                            — `{ tag: string }`
 *       …other ad-hoc records (queue-operation, attachment, …) are ignored.
 */

import { promises as fs, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getProjectPath } from "@/claude/utils/path";
import { logger } from "@/ui/logger";
import { RawJSONLinesSchema, type RawJSONLines } from "@/claude/types";

/** Claude session-id format: UUID v4 8-4-4-4-12 hex digits. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  fileSize?: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
  tag?: string;
  createdAt?: number;
}

/**
 * Message shape returned to the App. Note `session_id` is snake_case to
 * match the SDK's response shape that `claudeControlHandlers.ts` is
 * already mapping over.
 */
export interface SessionMessage {
  type: "user" | "assistant" | "system";
  uuid: string;
  session_id: string;
  message: unknown;
}

interface JsonlFile {
  path: string;
  sessionId: string;
  mtime: number;
  size: number;
}

// ── path helpers ───────────────────────────────────────────────────────────

function claudeProjectsRoot(): string {
  const base = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return join(base, "projects");
}

function listProjectDirs(): string[] {
  try {
    const root = claudeProjectsRoot();
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(root, e.name));
  } catch (e) {
    logger.debug(
      `[sessionStoreRpc] cannot read projects root: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return [];
  }
}

function jsonlFilesIn(projectDir: string): JsonlFile[] {
  let entries: string[];
  try {
    entries = readdirSync(projectDir);
  } catch {
    return [];
  }

  const out: JsonlFile[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const sessionId = name.slice(0, -".jsonl".length);
    // Claude TUI v2.0.65+ rejects non-UUID session ids for --resume; also
    // filters out agent-* sidechain logs we shouldn't surface as sessions.
    if (!UUID_RE.test(sessionId)) continue;
    const full = join(projectDir, name);
    try {
      const st = statSync(full);
      out.push({ path: full, sessionId, mtime: st.mtimeMs, size: st.size });
    } catch {
      /* removed mid-scan — skip */
    }
  }
  return out;
}

/** Locate the JSONL for a given sessionId. Scans `dir` if given, else all. */
function findSessionFile(sessionId: string, dir?: string): JsonlFile | null {
  const projectDirs = dir ? [getProjectPath(dir)] : listProjectDirs();
  for (const pd of projectDirs) {
    const candidate = join(pd, sessionId + ".jsonl");
    if (!existsSync(candidate)) continue;
    try {
      const st = statSync(candidate);
      return { path: candidate, sessionId, mtime: st.mtimeMs, size: st.size };
    } catch {
      /* race: removed between exists and stat */
    }
  }
  return null;
}

// ── JSONL parsing ──────────────────────────────────────────────────────────

async function readJsonlRecords(filePath: string): Promise<unknown[]> {
  const text = await fs.readFile(filePath, "utf8");
  const out: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* malformed line — skip, do not crash the whole listing */
    }
  }
  return out;
}

function extractTextFromUserContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return undefined;
}

/** Distill SessionInfo from on-disk records + file stat. */
function buildSessionInfo(
  sessionId: string,
  mtime: number,
  size: number,
  records: unknown[],
): SessionInfo {
  let summary = "";
  let customTitle: string | undefined;
  let firstPrompt: string | undefined;
  let gitBranch: string | undefined;
  let cwd: string | undefined;
  let tag: string | undefined;
  let createdAt: number | undefined;

  // Fallback title surfaced on the init system message via SessionStart hook
  // (Claude Code 2.1.152+ writes hookSpecificOutput.sessionTitle here). Only
  // used when no explicit `custom-title` record exists.
  let initSessionTitle: string | undefined;

  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;

    if (r.type === "custom-title" && typeof r.customTitle === "string") {
      // Latest custom-title record wins (rename appends a new one each time).
      customTitle = r.customTitle;
      continue;
    }
    if (r.type === "summary" && typeof r.summary === "string") {
      summary = r.summary;
      continue;
    }
    if (r.type === "tag" && typeof r.tag === "string") {
      tag = r.tag;
      continue;
    }
    if (
      initSessionTitle === undefined &&
      r.type === "system" &&
      r.subtype === "init" &&
      typeof r.session_title === "string" &&
      r.session_title.length > 0
    ) {
      initSessionTitle = r.session_title;
    }

    if (gitBranch === undefined && typeof r.gitBranch === "string") {
      gitBranch = r.gitBranch;
    }
    if (cwd === undefined && typeof r.cwd === "string") {
      cwd = r.cwd;
    }
    if (createdAt === undefined && typeof r.timestamp === "string") {
      const t = Date.parse(r.timestamp);
      if (Number.isFinite(t)) createdAt = t;
    }
    if (
      firstPrompt === undefined &&
      r.type === "user" &&
      r.message &&
      typeof r.message === "object"
    ) {
      const text = extractTextFromUserContent(
        (r.message as { content?: unknown }).content,
      );
      if (text !== undefined) firstPrompt = text;
    }
  }

  if (!summary && firstPrompt) summary = firstPrompt;

  return {
    sessionId,
    summary,
    lastModified: Math.floor(mtime),
    fileSize: size,
    // Prefer an explicit `custom-title` record (manual rename), fall back to
    // the SessionStart-hook-provided init title when present.
    customTitle: customTitle ?? initSessionTitle,
    firstPrompt,
    gitBranch,
    cwd,
    tag,
    createdAt,
  };
}

// ── public API (SDK signature parity) ──────────────────────────────────────

export interface ListSessionsOptions {
  /** Working directory to scope results to. Omit to scan all projects. */
  dir?: string;
  limit?: number;
  offset?: number;
}

export async function listSessions(
  opts: ListSessionsOptions = {},
): Promise<SessionInfo[]> {
  const projectDirs = opts.dir ? [getProjectPath(opts.dir)] : listProjectDirs();
  const files: JsonlFile[] = [];
  for (const pd of projectDirs) files.push(...jsonlFilesIn(pd));
  files.sort((a, b) => b.mtime - a.mtime);

  const offset = opts.offset ?? 0;
  const slice =
    opts.limit !== undefined
      ? files.slice(offset, offset + opts.limit)
      : files.slice(offset);

  const out: SessionInfo[] = [];
  for (const f of slice) {
    try {
      const records = await readJsonlRecords(f.path);
      out.push(buildSessionInfo(f.sessionId, f.mtime, f.size, records));
    } catch (e) {
      logger.debug(
        `[sessionStoreRpc] skip ${f.path}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  return out;
}

export interface GetSessionInfoOptions {
  dir?: string;
}

export async function getSessionInfo(
  sessionId: string,
  opts: GetSessionInfoOptions = {},
): Promise<SessionInfo | null> {
  const f = findSessionFile(sessionId, opts.dir);
  if (!f) return null;
  const records = await readJsonlRecords(f.path);
  return buildSessionInfo(f.sessionId, f.mtime, f.size, records);
}

export interface DeleteSessionOptions {
  dir?: string;
}

export async function deleteSession(
  sessionId: string,
  opts: DeleteSessionOptions = {},
): Promise<void> {
  const f = findSessionFile(sessionId, opts.dir);
  if (!f) return; // idempotent: nothing to do
  await fs.unlink(f.path);
}

export interface RenameSessionOptions {
  dir?: string;
}

export async function renameSession(
  sessionId: string,
  title: string,
  opts: RenameSessionOptions = {},
): Promise<void> {
  const f = findSessionFile(sessionId, opts.dir);
  if (!f) throw new Error(`Session not found: ${sessionId}`);
  const record = { type: "custom-title", customTitle: title, sessionId };
  await fs.appendFile(f.path, JSON.stringify(record) + "\n", "utf8");
}

export interface GetSessionMessagesOptions {
  dir?: string;
  limit?: number;
  offset?: number;
  includeSystemMessages?: boolean;
}

export interface ReadRawSessionRecordsOptions {
  dir?: string;
}

export interface ForkSessionOptions {
  dir?: string;
  upToMessageId?: string;
  title?: string;
}

export interface ForkSessionResult {
  sessionId: string;
}

/**
 * Local replacement for SDK's forkSession. Copies a session's JSONL file to a
 * new UUID, optionally truncating at `upToMessageId` (inclusive), then appends
 * a `custom-title` record if `title` is provided. Returns the new sessionId.
 *
 * Mirrors SDK 0.3.145 `forkSession` semantics:
 *   - Forks do not copy undo history (we don't have that anyway in PTY mode).
 *   - When upToMessageId is omitted, the entire transcript is copied.
 *   - Title defaults to `<original> (fork)` if the source has a custom title.
 */
export async function forkSession(
  sourceSessionId: string,
  opts: ForkSessionOptions = {},
): Promise<ForkSessionResult> {
  const src = findSessionFile(sourceSessionId, opts.dir);
  if (!src) {
    throw new Error(`Source session not found: ${sourceSessionId}`);
  }

  const newSessionId = randomUUID();
  const text = await fs.readFile(src.path, "utf8");
  const lines = text.split(/\r?\n/);

  // Slice transcript up to and including the upToMessageId, if specified.
  let cutoff = lines.length;
  if (opts.upToMessageId) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r && typeof r === "object" && r.uuid === opts.upToMessageId) {
          cutoff = i + 1;
          break;
        }
      } catch {
        /* skip */
      }
    }
  }

  // Rewrite every record's sessionId so the fork is self-consistent.
  const out: string[] = [];
  let sourceTitle: string | undefined;
  for (let i = 0; i < cutoff; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === "object") {
        if (r.type === "custom-title" && typeof r.customTitle === "string") {
          sourceTitle = r.customTitle;
        }
        if (r.sessionId !== undefined) r.sessionId = newSessionId;
      }
      out.push(JSON.stringify(r));
    } catch {
      out.push(line); // preserve malformed lines verbatim
    }
  }

  const projectDir = getProjectPath(opts.dir ?? src.path);
  const dstPath = join(projectDir, `${newSessionId}.jsonl`);
  await fs.writeFile(dstPath, out.join("\n") + "\n", "utf8");

  const forkTitle =
    opts.title ?? (sourceTitle ? `${sourceTitle} (fork)` : undefined);
  if (forkTitle) {
    const record = {
      type: "custom-title",
      customTitle: forkTitle,
      sessionId: newSessionId,
    };
    await fs.appendFile(dstPath, JSON.stringify(record) + "\n", "utf8");
  }

  logger.debug(
    `[sessionStoreRpc] forkSession ${sourceSessionId} → ${newSessionId} (${out.length} records)`,
  );
  return { sessionId: newSessionId };
}

export async function readRawSessionRecords(
  sessionId: string,
  opts: ReadRawSessionRecordsOptions = {},
): Promise<RawJSONLines[]> {
  const f = findSessionFile(sessionId, opts.dir);
  if (!f) return [];
  const records = await readJsonlRecords(f.path);
  const parsed: RawJSONLines[] = [];
  for (const raw of records) {
    const result = RawJSONLinesSchema.safeParse(raw);
    if (result.success) {
      parsed.push(result.data);
    }
  }
  return parsed;
}

export async function getSessionMessages(
  sessionId: string,
  opts: GetSessionMessagesOptions = {},
): Promise<SessionMessage[]> {
  const f = findSessionFile(sessionId, opts.dir);
  if (!f) return [];
  const records = await readJsonlRecords(f.path);

  const filtered: SessionMessage[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const t = r.type;
    if (t !== "user" && t !== "assistant" && t !== "system") continue;
    if (t === "system" && !opts.includeSystemMessages) continue;
    filtered.push({
      type: t,
      uuid: typeof r.uuid === "string" ? r.uuid : "",
      session_id: typeof r.sessionId === "string" ? r.sessionId : sessionId,
      message: r.message,
    });
  }

  const offset = opts.offset ?? 0;
  return opts.limit !== undefined
    ? filtered.slice(offset, offset + opts.limit)
    : filtered.slice(offset);
}
