import { parseSkillFrontmatter } from "@kmmao/happy-wire";

/**
 * Summarize a skill's front-matter routing (Phase 3) for display — the model it
 * runs on and whether it's user-only (the model may not auto-invoke it). Parsed
 * client-side from the skill content so the list/editor can surface routing
 * without extra server fields. Returns null when the skill declares neither.
 */
export interface SkillRoutingInfo {
    model?: string;
    userOnly: boolean;
}

export function describeSkillRouting(content: string): SkillRoutingInfo | null {
    const { frontmatter } = parseSkillFrontmatter(content);
    const userOnly =
        frontmatter.userInvocable === false || frontmatter.disableModelInvocation === true;
    if (!frontmatter.model && !userOnly) return null;
    return { model: frontmatter.model, userOnly };
}
