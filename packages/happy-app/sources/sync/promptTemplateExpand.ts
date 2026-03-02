/**
 * Prompt Template Variable Expansion
 *
 * Replaces {{variable}} placeholders in template content with task context.
 */

export interface TemplateVariables {
    readonly title: string;
    readonly description: string;
    readonly directory: string | null;
    readonly tags: readonly string[];
}

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Expand template variables in content string.
 *
 * Supported variables:
 * - {{title}} — Task title
 * - {{description}} — Task description (or empty string)
 * - {{directory}} — Working directory (or "not specified")
 * - {{tags}} — Comma-separated tags (or "none")
 * - {{datetime}} — Current date/time ISO string
 *
 * Unknown variables are left as-is.
 */
export function expandTemplate(
    content: string,
    vars: TemplateVariables,
): string {
    return content.replace(VARIABLE_PATTERN, (_match, varName: string) => {
        switch (varName) {
            case "title":
                return vars.title;
            case "description":
                return vars.description || "";
            case "directory":
                return vars.directory || "not specified";
            case "tags":
                return vars.tags.length > 0 ? vars.tags.join(", ") : "none";
            case "datetime":
                return new Date().toISOString();
            default:
                return `{{${varName}}}`;
        }
    });
}
