import * as z from "zod";

/**
 * Skill front-matter parsing & model routing.
 *
 * Skills are Markdown documents that may open with a YAML-ish front-matter
 * block fenced by `---`:
 *
 *   ---
 *   model: haiku
 *   user_invocable: false
 *   disable_model_invocation: true
 *   ---
 *   <skill body…>
 *
 * The front-matter gives per-skill control over the model that runs the skill
 * and whether the model may invoke it autonomously. Parsing lives in wire (the
 * single source of truth) so CLI, Server, and App all agree on the shape and
 * the short-name → model-id routing.
 */

// ===== Parsed front-matter =====
export const SkillFrontmatterSchema = z.object({
  /** Short model alias (haiku/sonnet/opus/fable) or a raw model id. */
  model: z.string().optional(),
  /**
   * When false, the skill may only be triggered manually from the UI — the
   * model must never invoke it. Defaults to true.
   */
  userInvocable: z.boolean().optional(),
  /**
   * When true, the model must never auto-invoke the skill (Auto Mode included);
   * only an explicit user action may run it. Defaults to false.
   */
  disableModelInvocation: z.boolean().optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  /** Skill body with the front-matter block removed. */
  body: string;
}

const FRONTMATTER_FENCE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Map camelCase / snake_case / kebab-case keys onto our canonical camelCase. */
const KEY_ALIASES: Record<string, keyof SkillFrontmatter> = {
  model: "model",
  user_invocable: "userInvocable",
  "user-invocable": "userInvocable",
  userinvocable: "userInvocable",
  disable_model_invocation: "disableModelInvocation",
  "disable-model-invocation": "disableModelInvocation",
  disablemodelinvocation: "disableModelInvocation",
};

function coerceScalar(raw: string): string | boolean {
  const v = raw.trim().replace(/^["']|["']$/g, "");
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

/**
 * Parse a skill document, extracting a leading front-matter block (if any) and
 * returning the remaining body. Unknown keys are ignored. Never throws — a
 * malformed block simply yields empty front-matter and the original content as
 * the body.
 */
export function parseSkillFrontmatter(content: string): ParsedSkill {
  const match = content.match(FRONTMATTER_FENCE);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const raw: Record<string, string | boolean> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf(":");
    if (sep === -1) continue;
    const key = trimmed.slice(0, sep).trim().toLowerCase();
    const canonical = KEY_ALIASES[key];
    if (!canonical) continue;
    raw[canonical] = coerceScalar(trimmed.slice(sep + 1));
  }

  const parsed = SkillFrontmatterSchema.safeParse(raw);
  const frontmatter = parsed.success ? parsed.data : {};
  const body = content.slice(match[0].length);
  return { frontmatter, body };
}

/** Short model aliases → concrete model ids used by the runtime. */
const MODEL_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-4-8",
  fable: "claude-fable-5",
};

/**
 * Resolve a front-matter `model` value to a concrete model id. Short aliases
 * (haiku/sonnet/opus/fable) map to their current ids; anything else is assumed
 * to already be a full model id and passed through. Returns undefined for an
 * empty/undefined input.
 */
export function resolveSkillModelId(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const key = model.trim().toLowerCase();
  return MODEL_ALIASES[key] ?? model.trim();
}
