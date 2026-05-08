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
    /** SDKAssistantMessageError string (e.g. 'billing_error', 'rate_limit'). Optional for forward compat. */
    error?: string;
    error_details?: string;
    last_assistant_message?: string;
    [key: string]: unknown;
}

export interface HookServerOptions {
    /** Called when a session hook is received with a valid session ID */
    onSessionHook: (sessionId: string, data: SessionHookData) => void;
    /** Called when a StopFailure hook is received */
    onStopFailure?: (data: StopFailureHookData) => void;
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
    const { onSessionHook, onStopFailure } = options;

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

                if (eventName === 'StopFailure') {
                    handleStopFailure(data as StopFailureHookData);
                } else {
                    // Default: treat as SessionStart (or any session-related hook)
                    handleSessionStart(data as SessionHookData);
                }

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

