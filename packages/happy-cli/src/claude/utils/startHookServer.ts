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
 * Effort level surfaced to hooks. Claude Code 2.1.133+ exposes this both as
 * the `effort.level` JSON field and as the `$CLAUDE_EFFORT` env var; the
 * forwarder folds the env var into `effort.level` so consumers see a single
 * shape regardless of how the runtime delivered it.
 */
export interface HookEffortContext {
    level?: string;
    [key: string]: unknown;
}

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
    /** Current effort level (Claude Code 2.1.133+). May be missing on older CLIs. */
    effort?: HookEffortContext;
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

/**
 * Fired when a working directory is added mid-session via `/add-dir` or the
 * SDK `register_repo_root` control request (Claude Code 2.1.221+). Cannot
 * block — the directory is already added when the hook fires. The
 * `new_directory` field name is verified against the 2.1.232 binary's hook
 * payload table; the index signature keeps us safe if it ever shifts.
 */
export interface DirectoryAddedHookData {
    hook_event_name: 'DirectoryAdded';
    session_id?: string;
    new_directory?: string;
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

// ─── ExitPlanApproval bridge (Happy-specific, plan-mode 429 mitigation) ────
// Not a native Claude Code hook — synthesized by
// `scripts/exit_plan_approval_forwarder.cjs`, which overrides the
// `hook_event_name` field on the PreToolUse payload so the hookServer
// dispatch table routes it here. The forwarder BLOCKS on the HTTP
// response, so this handler is the sole authority on what the TUI does
// with the ExitPlanMode tool call — the response body IS the
// `hookSpecificOutput` Claude reads.

/** Payload the ExitPlanApproval bridge forwards from the PreToolUse hook. */
export interface ExitPlanApprovalHookData {
    hook_event_name: 'ExitPlanApproval';
    session_id?: string;
    tool_name?: string;
    tool_input?: unknown;
    [key: string]: unknown;
}

/**
 * Response the ExitPlanApproval handler returns. Shape mirrors the
 * PreToolUse hook's expected output verbatim: the forwarder writes this
 * body to stdout unchanged, and the TUI reads it. Setting
 * `permissionDecision: "allow"` MUST be paired with `updatedInput` for
 * `requiresUserInteraction` tools like ExitPlanMode; the handler is
 * responsible for including it.
 */
export interface ExitPlanApprovalResponse {
    hookSpecificOutput?: {
        hookEventName?: 'PreToolUse';
        permissionDecision?: 'allow' | 'deny';
        permissionDecisionReason?: string;
        updatedInput?: unknown;
        [key: string]: unknown;
    };
}

/**
 * Optional response body the SessionStart hook may return to Claude Code.
 * Mirrors `hookSpecificOutput` semantics introduced in Claude Code 2.1.152:
 *   - `sessionTitle`: pre-seeds the session title before any model interaction;
 *     surfaces as `system.init.session_title` in the JSONL.
 *   - `reloadSkills`: triggers a skill rescan on the Claude side. Only useful
 *     when something between session-start and the first turn invalidates
 *     the current skill set (e.g. happy installing additional skills on the
 *     fly). Returning `false`/omitting it is a no-op.
 *
 * Other fields are passed through verbatim under `hookSpecificOutput` for
 * forward-compatibility with future Claude Code 2.1.x additions.
 */
export interface SessionStartHookResponse {
    hookSpecificOutput?: {
        sessionTitle?: string;
        reloadSkills?: boolean;
        [key: string]: unknown;
    };
}

export interface HookServerOptions {
    /**
     * Called when a session hook is received with a valid session ID. May
     * return a {@link SessionStartHookResponse} (or a promise to one) to
     * influence Claude's behaviour — `undefined` keeps the old fire-and-forget
     * semantics.
     */
    onSessionHook: (
        sessionId: string,
        data: SessionHookData,
    ) => void | SessionStartHookResponse | Promise<void | SessionStartHookResponse>;
    /** Called when a StopFailure hook is received */
    onStopFailure?: (data: StopFailureHookData) => void;
    /** Called when Claude's cwd changes (Claude Code 2.1.121+, optional). */
    onCwdChanged?: (data: CwdChangedHookData) => void;
    /** Called for each FileChanged event (high-frequency; consumer must
     *  debounce / cap). Claude Code 2.1.121+, optional. */
    onFileChanged?: (data: FileChangedHookData) => void;
    /** Called when a working directory is added via /add-dir (Claude Code 2.1.221+, optional). */
    onDirectoryAdded?: (data: DirectoryAddedHookData) => void;
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
    /**
     * Called when `exit_plan_approval_forwarder.cjs` bridges an
     * ExitPlanMode PreToolUse to us. The handler is expected to BLOCK
     * on user input (via the App picker) and RETURN the
     * `hookSpecificOutput` body — the forwarder writes it to stdout
     * verbatim, which is how the TUI learns whether the tool call is
     * allowed. Returning `undefined` falls back to the TUI's built-in
     * in-terminal picker (same as if the hook produced no output).
     */
    onExitPlanApproval?: (
        data: ExitPlanApprovalHookData,
    ) => ExitPlanApprovalResponse | undefined | Promise<ExitPlanApprovalResponse | undefined>;
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
        onDirectoryAdded,
        onWorktreeCreate,
        onWorktreeRemove,
        onInstructionsLoaded,
        onPermissionDenied,
        onPostToolBatch,
        onExitPlanApproval,
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

    async function handleSessionStart(
        data: SessionHookData,
    ): Promise<SessionStartHookResponse | undefined> {
        const sessionId = data.session_id || data.sessionId;
        if (!sessionId) {
            logger.debug('[hookServer] Session hook received but no session_id found in data');
            return undefined;
        }
        logger.debug(`[hookServer] Session hook received session ID: ${sessionId}`);
        const maybeResponse = onSessionHook(sessionId, data);
        if (!maybeResponse) return undefined;
        // Accept both sync return and async — return undefined to skip the
        // hookSpecificOutput envelope entirely (preserves the legacy
        // fire-and-forget behavior).
        return (await maybeResponse) ?? undefined;
    }

    function handleStopFailure(data: StopFailureHookData) {
        logger.debug(`[hookServer] StopFailure hook: ${data.error_details ?? data.last_assistant_message ?? data.error ?? 'unknown'}`);
        onStopFailure?.(data);
    }

    async function handleExitPlanApproval(
        data: ExitPlanApprovalHookData,
    ): Promise<ExitPlanApprovalResponse | undefined> {
        if (!onExitPlanApproval) {
            // No handler configured — let the TUI fall back to its own
            // picker by returning nothing (the forwarder treats a
            // non-JSON response as "silent exit").
            return undefined;
        }
        logger.debug(
            `[hookServer] ExitPlanApproval hook received (tool=${data.tool_name ?? '?'})`,
        );
        try {
            const maybe = onExitPlanApproval(data);
            return (await maybe) ?? undefined;
        } catch (err) {
            logger.debug(`[hookServer] ExitPlanApproval handler threw: ${err}`);
            return undefined;
        }
    }

    // Typed dispatch keyed on `hook_event_name`. Unlisted events fall through
    // to `handleSessionStart` for backwards compatibility — the old behaviour
    // was "anything other than StopFailure is SessionStart" and some
    // session-lifecycle hooks Claude might add later are best served by that
    // generic path until they get a dedicated handler. SessionStart is the
    // only entry that may produce a response body (see SessionStartHookResponse).
    // Handler return values are unioned across the two response-producing
    // events (SessionStart → SessionStartHookResponse, ExitPlanApproval →
    // ExitPlanApprovalResponse) plus void for the fire-and-forget rest.
    // The request loop below just tests `typeof result === 'object'` to
    // decide whether to echo JSON, so the exact union is not load-bearing.
    const dispatch: Record<
        string,
        (
            data: Record<string, unknown>,
        ) =>
            | void
            | Promise<
                  | SessionStartHookResponse
                  | ExitPlanApprovalResponse
                  | undefined
              >
    > = {
        SessionStart: (data) => handleSessionStart(data as SessionHookData),
        StopFailure: (data) => handleStopFailure(data as StopFailureHookData),
        CwdChanged: (data) => onCwdChanged?.(data as CwdChangedHookData),
        FileChanged: (data) => onFileChanged?.(data as FileChangedHookData),
        DirectoryAdded: (data) => onDirectoryAdded?.(data as DirectoryAddedHookData),
        WorktreeCreate: (data) => onWorktreeCreate?.(data as WorktreeCreateHookData),
        WorktreeRemove: (data) => onWorktreeRemove?.(data as WorktreeRemoveHookData),
        InstructionsLoaded: (data) => onInstructionsLoaded?.(data as InstructionsLoadedHookData),
        PermissionDenied: (data) => onPermissionDenied?.(data as PermissionDeniedHookData),
        PostToolBatch: (data) => onPostToolBatch?.(data as PostToolBatchHookData),
        ExitPlanApproval: (data) =>
            handleExitPlanApproval(data as ExitPlanApprovalHookData),
    };

    return new Promise((resolve, reject) => {
        const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            // Wrap the whole request body in a try/catch so a thrown handler
            // (e.g. JSON.stringify on a circular response, or a downstream
            // callback that rejects) always yields a definite HTTP response
            // rather than a dangling socket. The forwarder scripts read the
            // response body as their hook decision; leaking a socket wedge
            // there means the TUI hook never resolves and the whole session
            // hangs. Cheaper defensive layering than per-branch try/catches.
            try {
                // Handle POST /hook (generic) and POST /hook/session-start (backwards compat)
                if (req.method === 'POST' && (req.url === '/hook' || req.url === '/hook/session-start')) {
                    const data = await parseBody(req);
                    if (data === null) {
                        res.writeHead(408).end('timeout');
                        return;
                    }

                    const eventName = (data as SessionHookData).hook_event_name;
                    const handler = (eventName && dispatch[eventName]) || dispatch.SessionStart;
                    const maybeResponse = await handler(data);

                    // SessionStart may return a JSON body that Claude reads as
                    // hookSpecificOutput (Claude Code 2.1.152+ — sessionTitle,
                    // reloadSkills, etc.). Other events keep the legacy plain-text
                    // 'ok' response.
                    if (maybeResponse && typeof maybeResponse === 'object') {
                        res.writeHead(200, { 'Content-Type': 'application/json' })
                           .end(JSON.stringify(maybeResponse));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
                    }
                    return;
                }

                // 404 for anything else
                res.writeHead(404).end('not found');
            } catch (err) {
                logger.debug(`[hookServer] Request handler threw: ${err}`);
                // Best-effort 500 — headers may already be written if the
                // throw happened during response streaming, in which case
                // writeHead throws again and we swallow it silently.
                try {
                    if (!res.headersSent) {
                        res.writeHead(500, { 'Content-Type': 'text/plain' }).end('internal error');
                    } else {
                        res.end();
                    }
                } catch { /* nothing else we can do */ }
            }
        });

        // Disable Node's per-request timeout — Node 18+ defaults to
        // 300 000 ms (5 min), but the ExitPlanApproval bridge can legitimately
        // block for HAPPY_EXIT_PLAN_APPROVAL_TIMEOUT_MS (default 10 min, max
        // 1 h) waiting on the App user's picker click. Every handler enforces
        // its own timeout at the app layer, so the transport shouldn't cut
        // requests off. Fast handlers (SessionStart / StopFailure) return
        // within milliseconds regardless, so removing the ceiling is safe.
        server.requestTimeout = 0;

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

