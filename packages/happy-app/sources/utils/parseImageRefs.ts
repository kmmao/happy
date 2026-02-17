/**
 * Extracts [image: /path/...] references from message text.
 *
 * Returns the cleaned text (without image refs) and an array of image paths.
 * Used to separate user message content from inline image attachments so each
 * can be rendered with its own component.
 */

const IMAGE_REF_PATTERN = /\[image:\s*([^\]]+)\]/g;

export interface ParsedImageRefs {
    /** Message text with all [image: ...] references removed and trimmed. */
    readonly text: string;
    /** Ordered list of file paths extracted from the references. */
    readonly imagePaths: readonly string[];
}

export function parseImageRefs(raw: string): ParsedImageRefs {
    const imagePaths: string[] = [];
    let match: RegExpExecArray | null;

    // Reset lastIndex for safety since the regex is global
    IMAGE_REF_PATTERN.lastIndex = 0;

    while ((match = IMAGE_REF_PATTERN.exec(raw)) !== null) {
        const path = match[1].trim();
        if (path.length > 0) {
            imagePaths.push(path);
        }
    }

    // Remove all image refs and collapse resulting blank lines
    const text = raw
        .replace(IMAGE_REF_PATTERN, '')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .join('\n')
        .trim();

    return { text, imagePaths };
}
