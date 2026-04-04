import * as z from "zod";

// ===== Inbox Category =====
export const InboxCategorySchema = z.enum([
  "task",         // Task queue events (completed, failed, cancelled)
  "trigger",      // Cron/webhook trigger fired
  "supervisor",   // Supervisor run results
  "session",      // Session lifecycle events
  "knowledge",    // Knowledge base changes
  "system",       // System notifications
]);
export type InboxCategory = z.infer<typeof InboxCategorySchema>;

// ===== Inbox Severity =====
export const InboxSeveritySchema = z.enum([
  "info",
  "warning",
  "error",
]);
export type InboxSeverity = z.infer<typeof InboxSeveritySchema>;

// ===== Inbox Item Summary (Server → App) =====
export const InboxItemSummarySchema = z.object({
  id: z.string(),
  category: InboxCategorySchema,
  eventType: z.string(),            // e.g. "task.completed", "trigger.cron.fired"
  severity: InboxSeveritySchema,
  title: z.string(),
  body: z.string().optional(),
  read: z.boolean(),
  referenceUrl: z.string().optional(),  // Deep link, e.g. "/machine/xxx/tasks"
  refType: z.string().optional(),       // Polymorphic ref: "task" | "trigger" | "session" | ...
  refId: z.string().optional(),         // ID of referenced entity
  groupKey: z.string().optional(),      // Dedup key (same source within 1h → skip)
  createdAt: z.number(),
});
export type InboxItemSummary = z.infer<typeof InboxItemSummarySchema>;

// ===== Inbox New Item Ephemeral (Server → App) =====
export const InboxNewItemSchema = z.object({
  type: z.literal("inbox-new-item"),
  item: InboxItemSummarySchema,
});
export type InboxNewItem = z.infer<typeof InboxNewItemSchema>;

// ===== Inbox Unread Count Ephemeral (Server → App) =====
export const InboxUnreadCountSchema = z.object({
  type: z.literal("inbox-unread-count"),
  count: z.number(),
});
export type InboxUnreadCount = z.infer<typeof InboxUnreadCountSchema>;
