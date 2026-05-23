import { InvalidateSync } from "@/utils/sync";
import { RawJSONLines, RawJSONLinesSchema } from "../types";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { logger } from "@/ui/logger";
import { startFileWatcher } from "@/modules/watcher/startFileWatcher";
import { getProjectPath } from "./path";
import { readAssociatedSubagent, SubagentInput } from "./subagentJsonlReader";

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

    // Mark existing messages as processed and start watching the initial session
    if (opts.sessionId) {
        let messages = await readSessionLog(projectDir, opts.sessionId);
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
            const rawMessages = await readSessionLog(projectDir, session);
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
    });
    await sync.invalidateAndAwait();

    // Periodic sync
    const intervalId = setInterval(() => { sync.invalidate(); }, 3000);

    // Public interface
    return {
        cleanup: async () => {
            clearInterval(intervalId);
            for (let w of watchers.values()) {
                w();
            }
            watchers.clear();
            await sync.invalidateAndAwait();
            sync.stop();
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
                const existing = await readSessionLog(projectDir, sessionId);
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
 * Read and parse session log file
 * Returns only valid conversation messages, silently skipping internal events
 */
async function readSessionLog(projectDir: string, sessionId: string): Promise<RawJSONLines[]> {
    const expectedSessionFile = join(projectDir, `${sessionId}.jsonl`);
    logger.debug(`[SESSION_SCANNER] Reading session file: ${expectedSessionFile}`);
    let file: string;
    try {
        file = await readFile(expectedSessionFile, 'utf-8');
    } catch (error) {
        logger.debug(`[SESSION_SCANNER] Session file not found: ${expectedSessionFile}`);
        return [];
    }
    let lines = file.split('\n');
    let messages: RawJSONLines[] = [];
    for (let l of lines) {
        try {
            if (l.trim() === '') {
                continue;
            }
            let message = JSON.parse(l);
            
            // Silently skip known internal Claude Code events
            // These are state/tracking events, not conversation messages
            if (message.type && INTERNAL_CLAUDE_EVENT_TYPES.has(message.type)) {
                continue;
            }
            
            let parsed = RawJSONLinesSchema.safeParse(message);
            if (!parsed.success) {
                // Unknown message types are silently skipped
                // They will be tracked by processedMessageKeys to avoid reprocessing
                continue;
            }
            messages.push(parsed.data);
        } catch (e) {
            logger.debug(`[SESSION_SCANNER] Error processing message: ${e}`);
            continue;
        }
    }
    return messages;
}
