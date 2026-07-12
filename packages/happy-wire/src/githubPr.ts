import * as z from "zod";

/**
 * GitHub PR diff review (Phase 2B).
 *
 * Backs the mobile "review-driven" loop: after an agent opens a draft PR, the
 * App pulls the PR's diff through the Server (which holds the user's GitHub
 * token) and renders it for on-device review. The Server never ships the token
 * to the client.
 */

export const PrDiffRequestSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.coerce.number().int().positive(),
});
export type PrDiffRequest = z.infer<typeof PrDiffRequestSchema>;

export const PrDiffFileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type PrDiffFile = z.infer<typeof PrDiffFileSchema>;

export const PrDiffResponseSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.string(),
  /** true when the PR is a draft. */
  draft: z.boolean(),
  url: z.string(),
  /** Unified diff text (may be truncated for very large PRs). */
  diff: z.string(),
  /** Whether `diff` was truncated due to size. */
  truncated: z.boolean(),
  files: z.array(PrDiffFileSchema),
});
export type PrDiffResponse = z.infer<typeof PrDiffResponseSchema>;
