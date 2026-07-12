import { WorkflowRunSchema, type WorkflowRun } from "@kmmao/happy-wire";

/**
 * Parse+validate a `<cwd>/.happy/workflows/<id>.json` run-state file (Phase 5
 * live progress). Returns null on malformed / unexpected content so the viewer
 * can skip a bad file rather than crash.
 */
export function parseWorkflowRunJson(text: string): WorkflowRun | null {
    try {
        const parsed = WorkflowRunSchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}
