/**
 * Parse a Workflow tool's `script` input into displayable metadata, without
 * evaluating the (untrusted) script. The workflow runtime requires `meta` to
 * be a pure object literal, so a narrow regex over its string fields is safe
 * and sufficient. Mirrors the CLI's parseWorkflowMeta but also extracts the
 * declared `phases` for a richer UI.
 */

export interface WorkflowScriptMeta {
    name: string;
    description: string;
    phases: { title: string; detail?: string }[];
}

function matchField(src: string, field: string): string | undefined {
    const re = new RegExp(`${field}\\s*:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`);
    const m = re.exec(src);
    return m ? m[2].replace(/\\(["'\\])/g, "$1") : undefined;
}

/** Extract `phases: [ { title: '…', detail: '…' }, … ]` titles/details. */
function matchPhases(src: string): { title: string; detail?: string }[] {
    const phasesIdx = src.indexOf("phases");
    if (phasesIdx < 0) return [];
    // Grab the array literal after `phases:` up to its closing bracket.
    const open = src.indexOf("[", phasesIdx);
    if (open < 0) return [];
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length && i < open + 4000; i++) {
        if (src[i] === "[") depth++;
        else if (src[i] === "]") {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end < 0) return [];
    const arr = src.slice(open, end + 1);
    const phases: { title: string; detail?: string }[] = [];
    // Each `{ … }` object inside.
    const objRe = /\{([^{}]*)\}/g;
    let om: RegExpExecArray | null;
    while ((om = objRe.exec(arr)) !== null) {
        const body = om[1];
        const title = matchField(body, "title");
        if (!title) continue;
        const detail = matchField(body, "detail");
        phases.push(detail ? { title, detail } : { title });
    }
    return phases;
}

const EMPTY: WorkflowScriptMeta = { name: "", description: "", phases: [] };

export function parseWorkflowScriptMeta(input: unknown): WorkflowScriptMeta {
    if (!input || typeof input !== "object") return EMPTY;
    const obj = input as Record<string, unknown>;

    // Predefined / saved workflow invoked by name.
    if (typeof obj.name === "string" && typeof obj.script !== "string") {
        return { name: obj.name, description: "", phases: [] };
    }

    const script = typeof obj.script === "string" ? obj.script : undefined;
    if (!script) return EMPTY;

    const metaStart = script.indexOf("meta");
    const slice =
        metaStart >= 0 ? script.slice(metaStart, metaStart + 6000) : script;

    return {
        name: matchField(slice, "name") ?? "",
        description: matchField(slice, "description") ?? "",
        phases: matchPhases(slice),
    };
}
