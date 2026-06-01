/**
 * Extract a Workflow run's display metadata (name + description) from the
 * `Workflow` tool's input.
 *
 * A direct Workflow tool call carries `{ script: "export const meta = {...}\n..." }`
 * (or, for saved/predefined workflows, `{ name: "...", args?: ... }`). The
 * runtime requires `meta` to be a PURE object literal — no variables, calls,
 * or interpolation — so a narrow regex over the `meta.name` / `meta.description`
 * string fields is sufficient and avoids evaluating untrusted script text.
 *
 * Falls back to empty strings; the wire schema accepts them and the App
 * renders an "Untitled workflow" card. Never throws.
 */

export interface WorkflowMeta {
  name: string;
  description: string;
}

const EMPTY: WorkflowMeta = { name: "", description: "" };

/** Match `name: 'value'` / `name: "value"` inside a meta literal. */
function matchField(script: string, field: string): string | undefined {
  // Single- or double-quoted, allowing escaped quotes inside.
  const re = new RegExp(
    `${field}\\s*:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`,
  );
  const m = re.exec(script);
  return m ? m[2].replace(/\\(["'\\])/g, "$1") : undefined;
}

export function parseWorkflowMeta(input: unknown): WorkflowMeta {
  if (!input || typeof input !== "object") return EMPTY;
  const obj = input as Record<string, unknown>;

  // Predefined / saved workflow invoked by name.
  if (typeof obj.name === "string" && typeof obj.script !== "string") {
    return { name: obj.name, description: "" };
  }

  const script = typeof obj.script === "string" ? obj.script : undefined;
  if (!script) return EMPTY;

  // Only look inside the meta literal to avoid matching name/description
  // fields that appear elsewhere in the script body.
  const metaStart = script.indexOf("meta");
  const slice = metaStart >= 0 ? script.slice(metaStart, metaStart + 4000) : script;

  return {
    name: matchField(slice, "name") ?? "",
    description: matchField(slice, "description") ?? "",
  };
}
