import type { WorkflowDefinition } from "@kmmao/happy-wire";

/**
 * Extract the WorkflowDefinition embedded in a persisted `.happy/workflows/*.js`
 * replay script (Phase 5). The CLI serializer writes the definition as a
 * `const WORKFLOW = <json>;` literal, so the mobile app can recover the
 * structured workflow (roles / prompts / models / order) for visualization
 * without executing the script.
 *
 * Returns null when the source isn't a recognizable workflow file.
 */
export function parseWorkflowJs(source: string): WorkflowDefinition | null {
    const m = source.match(/const WORKFLOW = (\{[\s\S]*?\n\});/);
    if (!m) return null;
    try {
        const parsed = JSON.parse(m[1]);
        if (
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.id === "string" &&
            Array.isArray(parsed.steps)
        ) {
            return parsed as WorkflowDefinition;
        }
        return null;
    } catch {
        return null;
    }
}
