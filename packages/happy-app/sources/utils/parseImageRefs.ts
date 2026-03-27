/**
 * Extracts [image: /path/...] references from message text.
 *
 * Supports optional display name: [image: /path | displayName.pdf]
 *
 * Returns the cleaned text (without image refs), an array of image paths,
 * and a map from path to display name (for non-image file attachments).
 * Used to separate user message content from inline image attachments so each
 * can be rendered with its own component.
 */

const IMAGE_REF_PATTERN = /\[image:\s*([^\]]+)\]/g;

export interface ParsedImageRefs {
    /** Message text with all [image: ...] references removed and trimmed. */
    readonly text: string;
    /** Ordered list of file paths extracted from the references. */
    readonly imagePaths: readonly string[];
    /** Map from remote path to original display name (if provided via | separator). */
    readonly displayNames: ReadonlyMap<string, string>;
}

export function parseImageRefs(raw: string): ParsedImageRefs {
    const imagePaths: string[] = [];
    const displayNames = new Map<string, string>();
    let match: RegExpExecArray | null;

    // Reset lastIndex for safety since the regex is global
    IMAGE_REF_PATTERN.lastIndex = 0;

    while ((match = IMAGE_REF_PATTERN.exec(raw)) !== null) {
        const content = match[1].trim();
        if (content.length === 0) continue;

        const pipeIdx = content.indexOf(' | ');
        if (pipeIdx >= 0) {
            const path = content.slice(0, pipeIdx).trim();
            const name = content.slice(pipeIdx + 3).trim();
            if (path.length > 0) {
                imagePaths.push(path);
                if (name.length > 0) {
                    displayNames.set(path, name);
                }
            }
        } else {
            imagePaths.push(content);
        }
    }

    // Remove all image refs and collapse resulting blank lines
    const text = raw
        .replace(IMAGE_REF_PATTERN, '')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .join('\n')
        .trim();

    return { text, imagePaths, displayNames };
}
