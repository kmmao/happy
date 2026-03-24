/**
 * Shared API types for happy-agent.
 *
 * Re-exports wire types and defines Agent-specific types for
 * sessions, machines, socket events, and metadata.
 */

import { z } from "zod";

// Re-export wire types used across the agent
export type {
  SessionMessage,
  SessionMessageContent,
  Update,
  UpdateBody,
  UpdateMachineBody,
  UpdateSessionBody,
} from "@kmmao/happy-wire";

export {
  SessionMessageContentSchema,
  SessionMessageSchema,
  UpdateBodySchema,
  UpdateMachineBodySchema,
  UpdateSchema,
  UpdateSessionBodySchema,
} from "@kmmao/happy-wire";

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

export type EncryptionVariant = "legacy" | "dataKey";

export type SessionEncryption = {
  readonly key: Uint8Array;
  readonly variant: EncryptionVariant;
};

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type RawSession = {
  readonly id: string;
  readonly seq: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly active: boolean;
  readonly activeAt: number;
  readonly metadata: string;
  readonly metadataVersion: number;
  readonly agentState: string | null;
  readonly agentStateVersion: number;
  readonly dataEncryptionKey: string | null;
};

export type DecryptedSession = {
  id: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
  active: boolean;
  activeAt: number;
  metadata: unknown;
  agentState: unknown | null;
  dataEncryptionKey: string | null;
  encryption: SessionEncryption;
};

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

// Machine types — shared via @kmmao/happy-wire
import {
  MachineMetadataSchema as _MachineMetadataSchema,
  DaemonStateSchema as _DaemonStateSchema,
} from "@kmmao/happy-wire";
import type { MachineMetadata, DaemonState } from "@kmmao/happy-wire";

export const MachineMetadataSchema = _MachineMetadataSchema;
export const DaemonStateSchema = _DaemonStateSchema;
export type { MachineMetadata, DaemonState };

export type Machine = {
  readonly id: string;
  readonly encryptionKey: Uint8Array;
  readonly encryptionVariant: EncryptionVariant;
  readonly metadata: MachineMetadata;
  readonly metadataVersion: number;
  readonly daemonState: DaemonState | null;
  readonly daemonStateVersion: number;
};

// ---------------------------------------------------------------------------
// Permission mode (matches CLI)
// ---------------------------------------------------------------------------

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"
  | "read-only"
  | "safe-yolo"
  | "yolo";

// ---------------------------------------------------------------------------
// Socket events
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  update: (data: import("@kmmao/happy-wire").Update) => void;
  "rpc-request": (
    data: { method: string; params: string },
    callback: (response: string) => void,
  ) => void;
  "rpc-registered": (data: { method: string }) => void;
  "rpc-unregistered": (data: { method: string }) => void;
  "rpc-error": (data: { type: string; error: string }) => void;
  ephemeral: (data: { type: string; [key: string]: unknown }) => void;
  auth: (data: { success: boolean; user: string }) => void;
  error: (data: { message: string }) => void;
}

export interface ClientToServerEvents {
  message: (data: { sid: string; message: unknown }) => void;
  "session-alive": (data: {
    sid: string;
    time: number;
    thinking: boolean;
    mode?: "local" | "remote";
  }) => void;
  "session-end": (data: { sid: string; time: number }) => void;
  "update-metadata": (
    data: { sid: string; expectedVersion: number; metadata: string },
    cb: (answer: { result: string; version?: number; metadata?: string }) => void,
  ) => void;
  "update-state": (
    data: { sid: string; expectedVersion: number; agentState: string | null },
    cb: (answer: { result: string; version?: number; agentState?: string | null }) => void,
  ) => void;
  ping: (callback: () => void) => void;
  "rpc-register": (
    data: { method: string },
    callback?: (response: { ok: boolean; error?: string }) => void,
  ) => void;
  "rpc-unregister": (data: { method: string }) => void;
  "rpc-call": (
    data: { method: string; params: string },
    callback: (response: { ok: boolean; result?: string; error?: string }) => void,
  ) => void;
  "usage-report": (data: {
    key: string;
    sessionId: string;
    tokens: { total: number; [key: string]: number };
    cost: { total: number; [key: string]: number };
  }) => void;
}

// ---------------------------------------------------------------------------
// Message metadata (matches CLI MessageMetaSchema)
// ---------------------------------------------------------------------------

export const MessageMetaSchema = z.object({
  sentFrom: z.string().optional(),
  permissionMode: z
    .enum([
      "default", "acceptEdits", "bypassPermissions", "plan", "dontAsk",
      "read-only", "safe-yolo", "yolo",
    ])
    .optional(),
  model: z.string().nullable().optional(),
  fallbackModel: z.string().nullable().optional(),
  customSystemPrompt: z.string().nullable().optional(),
  appendSystemPrompt: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  disallowedTools: z.array(z.string()).nullable().optional(),
  maxBudgetUsd: z.number().nullable().optional(),
  thinking: z
    .object({
      type: z.enum(["adaptive", "enabled", "disabled"]),
      budgetTokens: z.number().optional(),
    })
    .nullable()
    .optional(),
  effort: z.enum(["low", "medium", "high", "max"]).nullable().optional(),
  continue: z.boolean().optional(),
  locale: z.string().optional(),
});

export type MessageMeta = z.infer<typeof MessageMetaSchema>;
