/**
 * Split text into TTS-friendly segments at sentence boundaries.
 * Each segment should be long enough for natural prosody (>20 chars)
 * but short enough to start playing quickly (<200 chars).
 *
 * Supports English punctuation (.!?) and CJK punctuation (。！？).
 */
export function splitIntoSentences(text: string): string[] {
    // Split on sentence-ending punctuation followed by whitespace or end
    const segments = text.split(/(?<=[.!?。！？])\s+/);

    // Merge very short segments with the next one for natural prosody
    const merged: string[] = [];
    let buffer = "";

    for (const seg of segments) {
        buffer = buffer ? `${buffer} ${seg}` : seg;
        if (buffer.length >= 40) {
            merged.push(buffer);
            buffer = "";
        }
    }

    if (buffer) {
        if (merged.length > 0 && buffer.length < 20) {
            // Append very short trailing segment to the last one
            merged[merged.length - 1] = `${merged[merged.length - 1]} ${buffer}`;
        } else {
            merged.push(buffer);
        }
    }

    return merged;
}
