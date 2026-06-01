/**
 * Dedicated HTTP server for receiving Claude session hooks
 * 
 * This server receives notifications from Claude when sessions change
 * (new session, resume, compact, fork, etc.) via the SessionStart hook.
 * 
 * Separate from the MCP server to keep concerns isolated.
 * 
 * ## Control Flow
 * 
 * ### Startup
 * ```
 * runClaude.ts                                  
 *     │                                         
 *     ├─► startHookServer() ──► HTTP server on random port (e.g., 52290)
 *     │                                         
 *     ├─► generateHookSettingsFile(port) ──► ~/.happy/tmp/hooks/session-hook-<pid>.json
 *     │   (contains SessionStart hook pointing to our server)
 *     │                                         
 *     └─► loop() ──► claudeLocal/claudeRemote
 *             │
 *             └─► spawn claude --settings <hook-settings-path>
 * ```
 * 
 * ### Session Notification Flow
 * ```
 * Claude CLI (SessionStart event)
 *     │
 *     ├─► Reads hooks from --settings file
 *     │
 *     └─► Executes hook command (session_hook_forwarder.cjs)
 *             │
 *             ├─► Receives session data on stdin
 *             │
 *             └─► HTTP POST to http://127.0.0.1:<port>/hook/session-start
 *                     │
 *                     └─► startHookServer receives it
 *                             │
 *                             └─► onSessionHook(sessionId, data)
 *                                     │
 *                                     ├─► Updates Session.sessionId
 *                                     ├─► Updates API metadata
 *                                     └─► Notifies SessionScanner
 * ```
 * 
 * ### Triggered By
 * - `happy` (fresh start) - new session created
 * - `happy --continue` - continues last session (may fork)
 * - `happy --resume` - interactive picker, then resume
 * - `happy --resume <id>` - resume specific session
 * - `/compact` command - compacts and forks session
 * - Double-escape fork - user forks conversation in CLI
 * 
 * ### Why Not Use File Watching?
 * File watching has race conditions when multiple Happy processes run.
 * With hooks, Claude directly tells THIS specific process about its session,
 * ensuring 1:1 mapping between Happy process and Claude session.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { logger } from '@/ui/logger';

/**
 * Data received from Claude's SessionStart hook
 */
export interface SessionHookData {
    session_id?: string;
    sessionId?: string;
    transcript_path?: string;
    cwd?: string;
    hook_event_name?: string;
    source?: string;
    [key: string]: unknown;
}

export interface StopFailureHookData {
    hook_event_name: 'StopFailure';
    session_id?: string;
    /** ClaudeJsonlAssistantMessageError string (e.g. 'billing_error', 'rate_limit'). Optional for forward compat. */
    error?: string;
    error_details?: string;
    last_assistant_message?: string;
    [key: string]: unknown;
}

// ─── Session-state hooks (Claude Code 2.1.121+ / 2.1.157+) ─────────────────
// Payload shapes mirror the SDK HookInput types verbatim. Field names use
// snake_case because the CLI's hook protocol writes that way on the wire;
// the SDK's TypeScript types match.

/** Fired when Claude's working directory changes mid-session (Claude Code 2.1.121+). */
export interface CwdChangedHookData {
    hook_event_name: 'CwdChanged';
    session_id?: string;
    old_cwd: string;
    new_cwd: string;
    [key: string]: unknown;
}

/** Fired for each file write/delete that Claude observes (Claude Code 2.1.121+). */
export interface FileChangedHookData {
    hook_event_name: 'FileChanged';
    session_id?: string;
    file_path: string;
    event: 'change' | 'add' | 'unlink';
    [key: string]: unknown;
}

/** Fired when Claude creates a managed worktree (Claude Code 2.1.157+). */
export interface WorktreeCreateHookData {
    hook_event_name: 'WorktreeCreate';
    session_id?: string;
    name: string;
    [key: string]: unknown;
}

/** Fired when Claude removes a managed worktree (Claude Code 2.1.157+). */
export interface WorktreeRemoveHookData {
    hook_event_name: 'WorktreeRemove';
    session_id?: string;
    worktree_path: string;
    [key: string]: unknown;
}

// ─── Observability hooks (verified present in @anthropic-ai/claude-code ────
// 2.1.157's HookEvent union). Field shapes mirror the SDK *HookInput types
// verbatim — snake_case on the wire. We receive them out of band like the
// session-state hooks above; the dispatch table routes each by name.

/**
 * Fired when a memory / instructions file (CLAUDE.md, .claude/rules/*.md, an
 * `@`-include, etc.) is loaded into context. `load_reason` says why.
 */
export interface InstructionsLoadedHookData {
    hook_event_name: 'InstructionsLoaded';
    session_id?: string;
    file_path: string;
    memory_type: 'User' | 'Project' | 'Local' | 'Managed';
    load_reason: 'session_start' | 'nested_traversal' | 'path_glob_match' | 'include' | 'compact';
    globs?: string[];
    trigger_file_path?: string;
    parent_file_path?: string;
    [key: string]: unknown;
}

/** Fired when a tool call is denied by the permission system. */
export interface PermissionDeniedHookData {
    hook_event_name: 'PermissionDenied';
    session_id?: string;
    tool_name: string;
    tool_input: unknown;
    tool_use_id: string;
    reason: string;
    [key: string]: unknown;
}

/** A single resolved tool call inside a PostToolBatch payload. */
export interface PostToolBatchToolCall {
    tool_name: string;
    tool_input: unknown;
    tool_use_id: string;
    tool_response?: unknown;
}

/**
 * Fired exactly once after every tool call in a batch has resolved, before
 * the next model request. (PostToolUse fires per-tool and may run
 * concurrently for parallel calls; PostToolBatch fires once with the lot.)
 */
export interface PostToolBatchHookData {
    hook_event_name: 'PostToolBatch';
    session_id?: string;
    tool_calls: PostToolBatchToolCall[];
    [key: string]: unknown;
}

export interface HookServerOptions {
    /** Called when a session hook is received with a valid session ID */
    onSessionHook: (sessionId: string, data: SessionHookData) => void;
    /** Called when a StopFailure hook is received */
    onStopFailure?: (data: StopFailureHookData) => void;
    /** Called when Claude's cwd changes (Claude Code 2.1.121+, optional). */
    onCwdChanged?: (data: CwdChangedHookData) => void;
    /** Called for each FileChanged event (high-frequency; consumer must
     *  debounce / cap). Claude Code 2.1.121+, optional. */
    onFileChanged?: (data: FileChangedHookData) => void;
    /** Called when Claude creates a managed worktree (Claude Code 2.1.157+, optional). */
    onWorktreeCreate?: (data: WorktreeCreateHookData) => void;
    /** Called when Claude removes a managed worktree (Claude Code 2.1.157+, optional). */
    onWorktreeRemove?: (data: WorktreeRemoveHookData) => void;
    /** Called when an instructions / memory file is loaded (Claude Code 2.1.157+, optional). */
    onInstructionsLoaded?: (data: InstructionsLoadedHookData) => void;
    /** Called when a tool call is denied by the permission system (Claude Code 2.1.157+, optional). */
    onPermissionDenied?: (data: PermissionDeniedHookData) => void;
    /** Called once after a batch of tool calls resolves (Claude Code 2.1.157+, optional). */
    onPostToolBatch?: (data: PostToolBatchHookData) => void;
}

export interface HookServer {
    /** The port the server is listening on */
    port: number;
    /** Stop the server */
    stop: () => void;
}

/**
 * Start a dedicated HTTP server for receiving Claude session hooks
 * 
 * @param options - Server options including the session hook callback
 * @returns Promise resolving to the server instance with port info
 */
export async function startHookServer(options: HookServerOptions): Promise<HookServer> {
    const {
        onSessionHook,
        onStopFailure,
        onCwdChanged,
        onFileChanged,
        onWorktreeCreate,
        onWorktreeRemove,
        onInstructionsLoaded,
        onPermissionDenied,
        onPostToolBatch,
    } = options;

    async function parseBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 5000);

        try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
                if (ac.signal.aborted) break;
                chunks.push(chunk as Buffer);
            }
            clearTimeout(timer);

            if (ac.signal.aborted) {
                logger.debug('[hookServer] Request timeout');
                return null;
            }

            const body = Buffer.concat(chunks).toString('utf-8');
            logger.debug('[hookServer] Received hook:', body);

            try {
                return JSON.parse(body);
            } catch (parseError) {
                logger.debug('[hookServer] Failed to parse hook data as JSON:', parseError);
                return {};
            }
        } catch (error) {
            clearTimeout(timer);
            logger.debug('[hookServer] Error reading body:', error);
            return null;
        }
    }

    function handleSessionStart(data: SessionHookData) {
        const sessionId = data.session_id || data.sessionId;
        if (sessionId) {
            logger.debug(`[hookServer] Session hook received session ID: ${sessionId}`);
            onSessionHook(sessionId, data);
        } else {
            logger.debug('[hookServer] Session hook received but no session_id found in data');
        }
    }

    function handleStopFailure(data: StopFailureHookData) {
        logger.debug(`[hookServer] StopFailure hook: ${data.error_details ?? data.last_assistant_message ?? data.error ?? 'unknown'}`);
        onStopFailure?.(data);
    }

    // Typed dispatch keyed on `hook_event_name`. Unlisted events fall through
    // to `handleSessionStart` for backwards compatibility — the old behaviour
    // was "anything other than StopFailure is SessionStart" and some
    // session-lifecycle hooks Claude might add later are best served by that
    // generic path until they get a dedicated handler.
    const dispatch: Record<string, (data: Record<string, unknown>) => void> = {
        SessionStart: (data) => handleSessionStart(data as SessionHookData),
        StopFailure: (data) => handleStopFailure(data as StopFailureHookData),
        CwdChanged: (data) => onCwdChanged?.(data as CwdChangedHookData),
        FileChanged: (data) => onFileChanged?.(data as FileChangedHookData),
        WorktreeCreate: (data) => onWorktreeCreate?.(data as WorktreeCreateHookData),
        WorktreeRemove: (data) => onWorktreeRemove?.(data as WorktreeRemoveHookData),
        InstructionsLoaded: (data) => onInstructionsLoaded?.(data as InstructionsLoadedHookData),
        PermissionDenied: (data) => onPermissionDenied?.(data as PermissionDeniedHookData),
        PostToolBatch: (data) => onPostToolBatch?.(data as PostToolBatchHookData),
    };

    return new Promise((resolve, reject) => {
        const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            // Handle POST /hook (generic) and POST /hook/session-start (backwards compat)
            if (req.method === 'POST' && (req.url === '/hook' || req.url === '/hook/session-start')) {
                const data = await parseBody(req);
                if (data === null) {
                    res.writeHead(408).end('timeout');
                    return;
                }

                const eventName = (data as SessionHookData).hook_event_name;
                const handler = (eventName && dispatch[eventName]) || dispatch.SessionStart;
                handler(data);

                res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
                return;
            }

            // 404 for anything else
            res.writeHead(404).end('not found');
        });

        // Listen on random available port
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Failed to get server address'));
                return;
            }

            const port = address.port;
            logger.debug(`[hookServer] Started on port ${port}`);

            resolve({
                port,
                stop: () => {
                    server.close();
                    logger.debug('[hookServer] Stopped');
                }
            });
        });

        server.on('error', (err) => {
            logger.debug('[hookServer] Server error:', err);
            reject(err);
        });
    });
}

