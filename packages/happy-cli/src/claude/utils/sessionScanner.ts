import { InvalidateSync } from "@/utils/sync";
import { RawJSONLines, RawJSONLinesSchema } from "../types";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { logger } from "@/ui/logger";
import { startFileWatcher } from "@/modules/watcher/startFileWatcher";
import { getProjectPath } from "./path";
import { readAssociatedSubagent, SubagentInput } from "./subagentJsonlReader";
import { createIncrementalJsonlReader, type IncrementalJsonlReader } from "./incrementalJsonlReader";

/**
 * Known internal Claude Code event types that should be silently skipped.
 * These are written to session JSONL files by Claude Code but are not 
 * actual conversation messages - they're internal state/tracking events.
 */
const INTERNAL_CLAUDE_EVENT_TYPES = new Set([
    'file-history-snapshot',
    'change',
    'queue-operation',
]);

export async function createSessionScanner(opts: {
    sessionId: string | null,
    workingDirectory: string
    onMessage: (message: RawJSONLines) => void
}) {

    // Resolve project directory
    const projectDir = getProjectPath(opts.workingDirectory);

    // Finished, pending finishing and current session
    let finishedSessions = new Set<string>();
    let pendingSessions = new Set<string>();
    let currentSessionId: string | null = null;
    let watchers = new Map<string, (() => void)>();
    let processedMessageKeys = new Set<string>();
    // Tool_use.id → agentId binding. Persisted across polls so the same
    // tool_use always re-reads its associated agent-XXX.jsonl from disk
    // (Claude writes that file INCREMENTALLY: initial prompt first, then
    // tool_use/tool_result blocks, then the final assistant reply seconds
    // later). Using a Set<consumedAgentIds> here would freeze the subagent
    // file at its first-seen state and miss every incremental update.
    let toolUseToAgentBinding = new Map<string, string>();

    // P2: per-session incremental reader. The byte-level tailing strategy
    // (consume only appended bytes, buffer a trailing half-written line as raw
    // bytes across reads, reset on truncation) lives behind
    // createIncrementalJsonlReader; here we just keep one reader per session,
    // created lazily on first read. parseJsonlText is the claude-specific
    // parseChunk it calls on each newly-completed block of lines.
    let mainReaders = new Map<string, IncrementalJsonlReader<RawJSONLines>>();

    // P1: per-session watcher on the `subagents/` directory. Subagent JSONL
    // writes don't touch the main session file, so without this a late
    // tool_result only surfaced on the next periodic poll (up to 15 s).
    let subagentWatchers = new Map<string, () => void>();

    // Read a session's main JSONL, returning the FULL parsed message list
    // (cached prefix + freshly appended lines). Returning the whole list — not
    // just the new tail — keeps interleaveSubagentMessages able to re-read every
    // bound subagent file on each sync, which is how late subagent tool_results
    // get picked up (see P1 watcher above).
    const readMainMessages = (sessionId: string): Promise<RawJSONLines[]> => {
        let reader = mainReaders.get(sessionId);
        if (!reader) {
            reader = createIncrementalJsonlReader(
                join(projectDir, `${sessionId}.jsonl`),
                parseJsonlText,
            );
            mainReaders.set(sessionId, reader);
        }
        return reader.read();
    };

    // Mark existing messages as processed and start watching the initial session
    if (opts.sessionId) {
        let messages = await readMainMessages(opts.sessionId);
        logger.debug(`[SESSION_SCANNER] Marking ${messages.length} existing messages as processed from session ${opts.sessionId}`);
        for (let m of messages) {
            processedMessageKeys.add(messageKey(m));
        }
        // IMPORTANT: Also start watching the initial session file because Claude Code
        // may continue writing to it even after creating a new session with --resume
        // (agent tasks and other updates can still write to the original session file)
        currentSessionId = opts.sessionId;
    }

    // Main sync function
    const sync = new InvalidateSync(async () => {
        // logger.debug(`[SESSION_SCANNER] Syncing...`);

        // Collect session ids - include ALL sessions that have watchers
        // This ensures we continue processing sessions that Claude Code may still write to
        let sessions: string[] = [];
        for (let p of pendingSessions) {
            sessions.push(p);
        }
        if (currentSessionId && !pendingSessions.has(currentSessionId)) {
            sessions.push(currentSessionId);
        }
        // Also process sessions that have active watchers (they may still receive updates)
        for (let [sessionId] of watchers) {
            if (!sessions.includes(sessionId)) {
                sessions.push(sessionId);
            }
        }

        // Process sessions
        for (let session of sessions) {
            const rawMessages = await readMainMessages(session);
            const sessionMessages = await interleaveSubagentMessages(
                projectDir,
                session,
                rawMessages,
                toolUseToAgentBinding,
            );
            let skipped = 0;
            let sent = 0;
            for (let file of sessionMessages) {
                let key = messageKey(file);
                if (processedMessageKeys.has(key)) {
                    skipped++;
                    continue;
                }
                processedMessageKeys.add(key);
                logger.debug(`[SESSION_SCANNER] Sending new message: type=${file.type}, uuid=${file.type === 'summary' ? file.leafUuid : file.uuid}`);
                opts.onMessage(file);
                sent++;
            }
            if (sessionMessages.length > 0) {
                logger.debug(`[SESSION_SCANNER] Session ${session}: found=${sessionMessages.length}, skipped=${skipped}, sent=${sent}`);
            }
        }

        // Move pending sessions to finished sessions (but keep processing them via watchers)
        for (let p of sessions) {
            if (pendingSessions.has(p)) {
                pendingSessions.delete(p);
                finishedSessions.add(p);
            }
        }

        // Update watchers for all sessions
        for (let p of sessions) {
            if (!watchers.has(p)) {
                logger.debug(`[SESSION_SCANNER] Starting watcher for session: ${p}`);
                watchers.set(p, startFileWatcher(join(projectDir, `${p}.jsonl`), () => { sync.invalidate(); }));
            }
        }

        // P1: once a session's subagents/ directory exists (created on the
        // first Task/Agent tool_use) watch it, so incremental subagent JSONL
        // appends invalidate immediately instead of waiting for the poll.
        // Lazy + existence-gated to avoid per-second ENOENT watcher retries on
        // sessions that never spawn a subagent.
        for (let p of sessions) {
            if (subagentWatchers.has(p)) continue;
            const subagentsDir = join(projectDir, p, "subagents");
            if (existsSync(subagentsDir)) {
                logger.debug(`[SESSION_SCANNER] Starting subagents watcher for session: ${p}`);
                subagentWatchers.set(p, startFileWatcher(subagentsDir, () => { sync.invalidate(); }));
            }
        }
    });
    await sync.invalidateAndAwait();

    // Periodic sync — defense-in-depth for events the per-file `fs.watch`
    // watcher misses. The watcher is the primary signal for the main session
    // JSONL: every Claude write triggers `sync.invalidate()` within tens of
    // milliseconds on macOS (fsevents) / Linux (inotify) / Windows
    // (ReadDirectoryChangesW), so the poll never wins that race.
    //
    // What the poll actually covers (it is now a pure backstop — the main
    // JSONL watcher and the per-session subagents/ watcher are the primary
    // signals):
    //   1. **Subagent JSONL appends** — `interleaveSubagentMessages` re-reads
    //      `subagents/agent-XXX.jsonl` on every sync cycle. The per-session
    //      subagents/ watcher (created lazily once that dir first appears)
    //      now fires `sync.invalidate()` on those appends, so a late
    //      `tool_result` surfaces within tens of ms instead of waiting for
    //      this poll. The poll only backstops the gap before that watcher
    //      attaches and the network-fs case below.
    //   2. **Network filesystems** — fsevents/inotify do not propagate over
    //      NFS/SMB, so on remote mounts the poll is the only signal.
    //   3. **Watcher restart gaps** — `startFileWatcher` reconnects with a 1 s
    //      backoff after `EBADF`/`ENOENT` (file rotated, dir replaced); events
    //      during that window land on the next poll.
    //
    // 3 s was the pre-PTY default, picked when MCP sub-agent traces churned
    // every couple of turns. Reads are now incremental (`readMainMessages`
    // only parses bytes appended past the last offset), so a poll on a stable
    // session is a cheap `stat` + no-op rather than a full readFile + Zod
    // reparse. 15 s bounds the worst-case latency for the gaps above without
    // burning CPU on stable sessions.
    //
    // Override with `HAPPY_SESSION_SCAN_INTERVAL_MS` for users who hit the
    // edge cases above (e.g. NFS-hosted projects need a smaller value).
    const intervalMs = Math.max(
        1000,
        Number(process.env.HAPPY_SESSION_SCAN_INTERVAL_MS) || 15_000,
    );
    const intervalId = setInterval(() => { sync.invalidate(); }, intervalMs);

    // Public interface
    return {
        cleanup: async () => {
            clearInterval(intervalId);
            for (let w of watchers.values()) {
                w();
            }
            watchers.clear();
            for (let w of subagentWatchers.values()) {
                w();
            }
            subagentWatchers.clear();
            await sync.invalidateAndAwait();
            sync.stop();
            mainReaders.clear();
        },
        onNewSession: async (sessionId: string, options?: { treatExistingAsProcessed?: boolean }) => {
            if (currentSessionId === sessionId) {
                logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is the same as the current session, skipping`);
                return;
            }
            if (finishedSessions.has(sessionId)) {
                logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is already finished, skipping`);
                return;
            }
            if (pendingSessions.has(sessionId)) {
                logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is already pending, skipping`);
                return;
            }
            // When the caller already has these messages (typical for
            // happy-reconnect — the server holds the history from prior
            // turns and metadata.claudeSessionId simply hadn't propagated
            // by the time we built the scanner), pre-mark whatever is on
            // disk so the first invalidate() does not replay the entire
            // file as fresh user prompts. Without this, every previous
            // user message re-appears in the chat after reconnect.
            if (options?.treatExistingAsProcessed) {
                const existing = await readMainMessages(sessionId);
                logger.debug(`[SESSION_SCANNER] Pre-marking ${existing.length} existing messages as processed for new session ${sessionId}`);
                for (const m of existing) {
                    processedMessageKeys.add(messageKey(m));
                }
            }
            if (currentSessionId) {
                pendingSessions.add(currentSessionId);
            }
            logger.debug(`[SESSION_SCANNER] New session: ${sessionId}`)
            currentSessionId = sessionId;
            sync.invalidate();
        },
    }
}

export type SessionScanner = ReturnType<typeof createSessionScanner>;


//
// Helpers
//

function messageKey(message: RawJSONLines): string {
    if (message.type === 'user') {
        return message.uuid;
    } else if (message.type === 'assistant') {
        return message.uuid;
    } else if (message.type === 'summary') {
        return 'summary: ' + message.leafUuid + ': ' + message.summary;
    } else if (message.type === 'system') {
        return message.uuid;
    } else if (message.type === 'result') {
        return 'result: ' + message.uuid;
    } else {
        throw Error() // Impossible
    }
}

/**
 * Walk the parsed main-jsonl messages, find Task/Agent tool_use blocks, and
 * splice in the corresponding subagents/agent-XXX.jsonl messages immediately
 * after each tool_use. Each spliced message receives a `parent_tool_use_id`
 * pointing at the tool_use.id, which `sessionProtocolMapper` already uses to
 * route messages into a sidechain session envelope.
 *
 * Non-Task/Agent tool_use blocks are ignored. Missing subagents/ directory or
 * unmatched tool_use blocks fall through without touching the message stream.
 */
async function interleaveSubagentMessages(
    projectDir: string,
    sessionId: string,
    mainMessages: RawJSONLines[],
    binding: Map<string, string>,
): Promise<RawJSONLines[]> {
    const subagentsDir = join(projectDir, sessionId, 'subagents');
    const out: RawJSONLines[] = [];

    for (const msg of mainMessages) {
        out.push(msg);
        if (msg.type !== 'assistant') continue;
        const content = (msg as any).message?.content;
        if (!Array.isArray(content)) continue;

        for (const block of content) {
            if (block?.type !== 'tool_use') continue;
            if (block.name !== 'Task' && block.name !== 'Agent') continue;

            const associated = await readAssociatedSubagent(
                subagentsDir,
                block.id,
                block.input as SubagentInput,
                binding,
            );
            if (!associated) {
                logger.debug(
                    `[SESSION_SCANNER] No subagent match for tool_use ${block.id} (${block.name})`,
                );
                continue;
            }

            for (const subMsg of associated.messages) {
                // Inject the parent pointer; sessionProtocolMapper.pickProviderSubagent
                // reads parent_tool_use_id to attach the message to the right
                // sidechain envelope. Use a spread to avoid mutating the
                // parsed value (which lives in the agent-XXX.jsonl cache).
                out.push({ ...subMsg, parent_tool_use_id: block.id } as RawJSONLines);
            }
        }
    }

    return out;
}

/**
 * Parse a chunk of JSONL text into valid conversation messages. Skips blank
 * lines, known-internal Claude events, and anything that fails the schema —
 * the same per-line semantics the old full-file reader used, factored out so
 * the incremental reader (readMainMessages) can reuse them on appended text.
 */
function parseJsonlText(text: string): RawJSONLines[] {
    const messages: RawJSONLines[] = [];
    for (const l of text.split('\n')) {
        if (l.trim() === '') {
            continue;
        }
        let message: any;
        try {
            message = JSON.parse(l);
        } catch (e) {
            logger.debug(`[SESSION_SCANNER] Error processing message: ${e}`);
            continue;
        }
        // Silently skip known internal Claude Code events — state/tracking
        // events, not conversation messages.
        if (message.type && INTERNAL_CLAUDE_EVENT_TYPES.has(message.type)) {
            continue;
        }
        const parsed = RawJSONLinesSchema.safeParse(message);
        if (!parsed.success) {
            // Unknown message types are silently skipped; processedMessageKeys
            // still tracks them so they aren't reprocessed.
            continue;
        }
        messages.push(parsed.data);
    }
    return messages;
}
