/**
 * Preview-related Zod schemas shared across CLI, Server, and App.
 *
 * Covers: preview candidates (reported dev servers), tunnel connections,
 * proxy protocol messages, visual annotations, and ephemeral events.
 */

import * as z from "zod";

// ── Preview Candidate ────────────────────────────────────────────────────────

export const PreviewCandidateStateSchema = z.enum([
  "reported",
  "validating",
  "available",
  "invalid",
]);
export type PreviewCandidateState = z.infer<typeof PreviewCandidateStateSchema>;

export const PreviewCandidateSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  state: PreviewCandidateStateSchema,
  protocol: z.enum(["http", "https"]).default("http"),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  path: z.string().optional(),
  devServerType: z.string().optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  pid: z.number().int().positive().optional(),
  reportedAt: z.number(),
  validatedAt: z.number().optional(),
  error: z.string().optional(),
});
export type PreviewCandidate = z.infer<typeof PreviewCandidateSchema>;

/** CLI/Agent → Server: report a preview candidate. */
export const PreviewCandidateReportSchema = z.object({
  sessionId: z.string(),
  protocol: z.enum(["http", "https"]).default("http"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  path: z.string().optional(),
  devServerType: z.string().optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  pid: z.number().int().positive().optional(),
});
export type PreviewCandidateReport = z.infer<typeof PreviewCandidateReportSchema>;

// ── Preview Tunnel Connection ────────────────────────────────────────────────

export const PreviewConnectionStatusSchema = z.enum([
  "creating",
  "active",
  "idle",
  "failed",
  "expired",
]);
export type PreviewConnectionStatus = z.infer<typeof PreviewConnectionStatusSchema>;

export const PreviewConnectionSchema = z.object({
  tunnelId: z.string(),
  candidateId: z.string(),
  sessionId: z.string(),
  publicUrl: z.string(),
  status: PreviewConnectionStatusSchema,
  createdAt: z.number(),
  leaseExpiresAt: z.number(),
  idleTimeoutMs: z.number(),
  lastActiveAt: z.number(),
  error: z.string().optional(),
});
export type PreviewConnection = z.infer<typeof PreviewConnectionSchema>;

// ── Resource Limits ──────────────────────────────────────────────────────────

export const PreviewResourceLimitsSchema = z.object({
  maxRequestBodyBytes: z.number().default(10 * 1024 * 1024),       // 10 MB
  maxResponseBodyBytes: z.number().default(100 * 1024 * 1024),     // 100 MB
  maxRequestDurationMs: z.number().default(5 * 60 * 1000),         // 5 min
});
export type PreviewResourceLimits = z.infer<typeof PreviewResourceLimitsSchema>;

export const DEFAULT_PREVIEW_RESOURCE_LIMITS: PreviewResourceLimits = {
  maxRequestBodyBytes: 10 * 1024 * 1024,
  maxResponseBodyBytes: 100 * 1024 * 1024,
  maxRequestDurationMs: 5 * 60 * 1000,
};

export const DEFAULT_PREVIEW_LEASE_MS = 8 * 60 * 60 * 1000;            // 8 hours
export const DEFAULT_PREVIEW_IDLE_TIMEOUT_MS = 45 * 60 * 1000;         // 45 minutes
export const PREVIEW_CREATE_RATE_LIMIT_WINDOW_MS = 60_000;             // 1 minute
export const PREVIEW_CREATE_RATE_LIMIT_MAX = 5;                        // 5 per window
export const PREVIEW_SESSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000;     // 5 minutes
export const PREVIEW_PROXY_CHUNK_SIZE = 32 * 1024;                     // 32 KB

// ── Tunnel Proxy Protocol (Server ↔ CLI over Socket.IO) ─────────────────────

/** Server → CLI: proxy an incoming HTTP request to the local dev server. */
export const PreviewProxyRequestSchema = z.object({
  tunnelId: z.string(),
  requestId: z.string(),
  method: z.string(),
  path: z.string(),
  headers: z.record(z.string(), z.string()),
  /** Base64-encoded body chunks; empty array for bodiless requests. */
  bodyChunks: z.array(z.string()).default([]),
});
export type PreviewProxyRequest = z.infer<typeof PreviewProxyRequestSchema>;

/** CLI → Server: response from the local dev server. */
export const PreviewProxyResponseStartSchema = z.object({
  tunnelId: z.string(),
  requestId: z.string(),
  status: z.number(),
  statusText: z.string(),
  headers: z.record(z.string(), z.string()),
  /** When true, body chunks will follow in separate messages. */
  hasBody: z.boolean(),
});
export type PreviewProxyResponseStart = z.infer<typeof PreviewProxyResponseStartSchema>;

/** CLI → Server: a chunk of the response body (base64 encoded). */
export const PreviewProxyResponseBodySchema = z.object({
  tunnelId: z.string(),
  requestId: z.string(),
  chunk: z.string(), // base64
});
export type PreviewProxyResponseBody = z.infer<typeof PreviewProxyResponseBodySchema>;

/** CLI → Server: signals the end of the response body. */
export const PreviewProxyResponseEndSchema = z.object({
  tunnelId: z.string(),
  requestId: z.string(),
});
export type PreviewProxyResponseEnd = z.infer<typeof PreviewProxyResponseEndSchema>;

/** CLI → Server: the local request failed. */
export const PreviewProxyResponseErrorSchema = z.object({
  tunnelId: z.string(),
  requestId: z.string(),
  message: z.string(),
});
export type PreviewProxyResponseError = z.infer<typeof PreviewProxyResponseErrorSchema>;

// ── WebSocket Proxy (for HMR) ────────────────────────────────────────────────

/** Server → CLI: upgrade request for a WebSocket connection. */
export const PreviewWsConnectSchema = z.object({
  tunnelId: z.string(),
  requestId: z.string(),
  path: z.string(),
  headers: z.record(z.string(), z.string()),
  subprotocol: z.string().optional(),
});
export type PreviewWsConnect = z.infer<typeof PreviewWsConnectSchema>;

/**
 * Bidirectional: a WebSocket frame.
 *
 * `data` is:
 *   - `string` for text frames (isBinary: false)
 *   - `Uint8Array` / `Buffer` for binary frames (isBinary: true) — Socket.IO
 *     encodes these natively as binary on the wire, avoiding base64 overhead.
 *     For backward compatibility, base64 strings are still accepted on read.
 */
export const PreviewWsFrameSchema = z.object({
  tunnelId: z.string(),
  requestId: z.string(),
  data: z.union([z.string(), z.instanceof(Uint8Array)]),
  isBinary: z.boolean().default(false),
});
export type PreviewWsFrame = z.infer<typeof PreviewWsFrameSchema>;

/** Bidirectional: close the proxied WebSocket. */
export const PreviewWsCloseSchema = z.object({
  tunnelId: z.string(),
  requestId: z.string(),
  code: z.number().default(1000),
  reason: z.string().optional(),
});
export type PreviewWsClose = z.infer<typeof PreviewWsCloseSchema>;

// ── Visual Annotation ────────────────────────────────────────────────────────

export const AnnotationViewportSchema = z.object({
  width: z.number(),
  height: z.number(),
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
  devicePixelRatio: z.number().optional(),
});
export type AnnotationViewport = z.infer<typeof AnnotationViewportSchema>;

export const AnnotationRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type AnnotationRect = z.infer<typeof AnnotationRectSchema>;

export const AnnotationTargetSchema = z.object({
  tag: z.string(),
  id: z.string().optional(),
  className: z.string().optional(),
  role: z.string().optional(),
  text: z.string().optional(),
  rect: AnnotationRectSchema,
  rectRatio: AnnotationRectSchema.optional(),
  selector: z.string(),
  xpath: z.string().optional(),
  outerHTMLPreview: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
});
export type AnnotationTarget = z.infer<typeof AnnotationTargetSchema>;

export const AnnotationAncestorSchema = z.object({
  tag: z.string(),
  id: z.string().optional(),
  role: z.string().optional(),
  selector: z.string(),
  text: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
});
export type AnnotationAncestor = z.infer<typeof AnnotationAncestorSchema>;

export const AnnotationStyleSchema = z.object({
  display: z.string().optional(),
  position: z.string().optional(),
  width: z.string().optional(),
  height: z.string().optional(),
  margin: z.string().optional(),
  padding: z.string().optional(),
  gap: z.string().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  fontSize: z.string().optional(),
  fontWeight: z.string().optional(),
  lineHeight: z.string().optional(),
  border: z.string().optional(),
  borderRadius: z.string().optional(),
  opacity: z.string().optional(),
  visibility: z.string().optional(),
  overflow: z.string().optional(),
  zIndex: z.string().optional(),
});
export type AnnotationStyle = z.infer<typeof AnnotationStyleSchema>;

export const VisualAnnotationAnchorSchema = z.object({
  version: z.literal(1),
  page: z.object({
    url: z.string(),
    pathname: z.string(),
    title: z.string().optional(),
    viewport: AnnotationViewportSchema,
  }),
  click: z.object({
    clientX: z.number(),
    clientY: z.number(),
    pageX: z.number().optional(),
    pageY: z.number().optional(),
    viewportXRatio: z.number().optional(),
    viewportYRatio: z.number().optional(),
  }),
  target: AnnotationTargetSchema,
  ancestors: z.array(AnnotationAncestorSchema),
  nearbyText: z.object({
    self: z.string().optional(),
    parentSummary: z.string().optional(),
    siblingTexts: z.array(z.string()).optional(),
  }).optional(),
  style: AnnotationStyleSchema.optional(),
});
export type VisualAnnotationAnchor = z.infer<typeof VisualAnnotationAnchorSchema>;

/** App → Server → Agent: a visual annotation from the user. */
export const VisualAnnotationReportSchema = z.object({
  sessionId: z.string(),
  commentId: z.string(),
  body: z.string(),
  anchor: VisualAnnotationAnchorSchema,
});
export type VisualAnnotationReport = z.infer<typeof VisualAnnotationReportSchema>;

// ── Ephemeral Events ─────────────────────────────────────────────────────────

export const PreviewCandidateReportedEphemeralSchema = z.object({
  type: z.literal("preview-candidate-reported"),
  sessionId: z.string(),
  candidate: PreviewCandidateSchema,
});
export type PreviewCandidateReportedEphemeral = z.infer<
  typeof PreviewCandidateReportedEphemeralSchema
>;

export const PreviewConnectionUpdatedEphemeralSchema = z.object({
  type: z.literal("preview-connection-updated"),
  sessionId: z.string(),
  connection: PreviewConnectionSchema.nullable(),
});
export type PreviewConnectionUpdatedEphemeral = z.infer<
  typeof PreviewConnectionUpdatedEphemeralSchema
>;

export const PreviewAnnotationReceivedEphemeralSchema = z.object({
  type: z.literal("preview-annotation-received"),
  sessionId: z.string(),
  annotation: VisualAnnotationReportSchema,
});
export type PreviewAnnotationReceivedEphemeral = z.infer<
  typeof PreviewAnnotationReceivedEphemeralSchema
>;
