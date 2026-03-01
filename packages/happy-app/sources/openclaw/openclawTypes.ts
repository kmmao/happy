/**
 * OpenClaw Gateway Protocol Types
 *
 * These types match the OpenClaw gateway WebSocket protocol.
 * Reference: clawdbot/src/gateway/protocol/schema.ts
 */

export interface OpenClawGatewayConfig {
    url: string;              // e.g., "ws://192.168.1.100:18789" or Tailscale URL
    token?: string;           // Auth token (for remote access)
    password?: string;        // Auth password (alternative)
}

// Frame types matching OpenClaw protocol
export interface OpenClawRequestFrame {
    type: 'req';
    id: string;
    method: string;
    params?: unknown;
}

export interface OpenClawResponseFrame {
    type: 'res';
    id: string;
    ok: boolean;
    payload?: unknown;
    error?: { code: string; message: string };
}

export interface OpenClawEventFrame {
    type: 'event';
    event: string;
    payload?: unknown;
    payloadJSON?: string;
    seq?: number;
}

export type OpenClawFrame = OpenClawRequestFrame | OpenClawResponseFrame | OpenClawEventFrame;

// Valid client IDs accepted by the gateway protocol
// NOTE: These are protocol constants — do NOT rename
export type OpenClawClientId =
    | 'webchat-ui'
    | 'clawdbot-control-ui'
    | 'webchat'
    | 'cli'
    | 'gateway-client'
    | 'clawdbot-macos'
    | 'clawdbot-ios'
    | 'clawdbot-android'
    | 'node-host'
    | 'test'
    | 'fingerprint'
    | 'clawdbot-probe';

// Valid client modes accepted by the gateway protocol
export type OpenClawClientMode =
    | 'webchat'
    | 'cli'
    | 'ui'
    | 'backend'
    | 'node'
    | 'probe'
    | 'test';

// Device identity for secure authentication
export interface OpenClawDeviceIdentity {
    id: string;           // Device ID (SHA256 hash of public key)
    publicKey: string;    // Base64URL encoded Ed25519 public key
    signature: string;    // Base64URL encoded signature of auth payload
    signedAt: number;     // Timestamp when payload was signed
    nonce?: string;       // Nonce for remote connections
}

// Connect params (simplified - full spec in clawdbot/src/gateway/protocol/schema.ts)
export interface OpenClawConnectParams {
    minProtocol: number;
    maxProtocol: number;
    client: {
        id: OpenClawClientId;
        displayName?: string;
        version: string;
        platform: string;
        mode: OpenClawClientMode;
    };
    role: string;
    scopes: string[];
    device?: OpenClawDeviceIdentity;
    auth?: { token?: string; password?: string };
}

export interface OpenClawHelloOk {
    server?: { host?: string };
    snapshot?: {
        sessionDefaults?: { mainSessionKey?: string };
    };
    auth?: {
        deviceToken?: string;  // Token issued after successful pairing
        role?: string;
        scopes?: string[];
    };
}

// Session types (matches GatewaySessionRow)
export interface OpenClawSession {
    key: string;
    kind: 'direct' | 'group' | 'global' | 'unknown';
    label?: string;
    displayName?: string;
    surface?: string;
    subject?: string;
    room?: string;
    space?: string;
    updatedAt: number | null;
    sessionId?: string;
    systemSent?: boolean;
    abortedLastRun?: boolean;
    thinkingLevel?: string;
    verboseLevel?: string;
    reasoningLevel?: string;
    elevatedLevel?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
    modelProvider?: string;
    contextTokens?: number;
}

export interface OpenClawSessionsListResult {
    ts: number;
    path: string;
    count: number;
    defaults: { model: string | null; contextTokens: number | null };
    sessions: OpenClawSession[];
}

// Chat message types
export interface OpenClawChatMessage {
    role: 'user' | 'assistant';
    content: Array<{ type: string; text?: string }> | string;
    timestamp?: number;
    stopReason?: string;
}

export interface OpenClawChatHistoryResult {
    sessionKey: string;
    sessionId?: string;
    messages: OpenClawChatMessage[];
    thinkingLevel?: string;
}

// Chat events (streamed from gateway)
export interface OpenClawChatEvent {
    runId: string;
    sessionKey: string;
    seq: number;
    state: 'started' | 'thinking' | 'delta' | 'tool' | 'final' | 'error';
    message?: OpenClawChatMessage;
    delta?: string;
    errorMessage?: string;
}

export interface OpenClawChatSendResult {
    runId: string;
    status: 'started' | 'ok' | 'error' | 'in_flight';
    summary?: string;
}
