import * as z from "zod";

/**
 * Visual Intent (Phase 4).
 *
 * A "visual intent" is a design prototype the user delivers alongside a voice
 * or text instruction — an HTML mockup (e.g. from Claude Design) or a design
 * image — that the agent reconstructs into component code.
 *
 * Delivery reuses the existing attachment rails: the file is uploaded and made
 * available on the CLI machine's filesystem, and a reference token is appended
 * to the user's message. The CLI system prompt teaches the model to Read the
 * referenced file and treat it as the authoritative visual spec.
 *
 * This module is the single source of truth for the reference token format so
 * the App (writer) and CLI (reader) never drift.
 */

export const VisualIntentKindSchema = z.enum(["html", "image"]);
export type VisualIntentKind = z.infer<typeof VisualIntentKindSchema>;

export const VisualIntentAttachmentSchema = z.object({
  kind: VisualIntentKindSchema,
  /** Absolute path (on the CLI machine) or remote path of the uploaded draft. */
  path: z.string(),
});
export type VisualIntentAttachment = z.infer<typeof VisualIntentAttachmentSchema>;

/**
 * Build the message reference token for a design prototype. HTML drafts use the
 * dedicated `[design: …]` token; images reuse the established `[image: …]`
 * token so existing image handling keeps working unchanged.
 */
export function formatVisualIntentRef(attachment: VisualIntentAttachment): string {
  return attachment.kind === "html"
    ? `[design: ${attachment.path}]`
    : `[image: ${attachment.path}]`;
}

const DESIGN_REF = /\[design:\s*([^\]]+)\]/g;

/** Extract all `[design: …]` prototype paths from a message body. */
export function parseVisualIntentRefs(message: string): string[] {
  const out: string[] = [];
  for (const match of message.matchAll(DESIGN_REF)) {
    const path = match[1]?.trim();
    if (path) out.push(path);
  }
  return out;
}
