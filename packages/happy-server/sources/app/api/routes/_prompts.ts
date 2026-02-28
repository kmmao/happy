/**
 * Prompts used by server-side API routes.
 */

export function sttCorrectionPrompt(text: string, lang?: string): string {
    const langHint = lang ? `Language of the transcript: ${lang}.\n` : "";
    return `${langHint}Fix errors in the following speech recognition transcript (homophones, punctuation, grammar). Return only the corrected text, no explanation. If already correct, return as-is.\n\nSpeech recognition result: ${text}`;
}
