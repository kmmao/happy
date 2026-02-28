/**
 * Prompts used by server-side API routes.
 */

export function sttCorrectionPrompt(text: string, lang?: string): string {
  const langCode = lang?.split("-")[0]?.toLowerCase();

  if (langCode === "zh") {
    return [
      "你是语音转文字后处理器。",
      "",
      "你的任务：",
      "- 修正语音识别中的同音字/近音字错误",
      "- 添加正确的标点符号（逗号、句号、问号等）",
      "- 保留技术术语原样（如 Claude Code、Git、API、Docker 等）",
      "",
      "规则：",
      "- 只纠错，不改写、不添加、不删减内容",
      "- 如果原文已正确，原样返回",
      "- 只返回纠正后的文本，不要任何解释",
      "",
      `语音识别结果：${text}`,
    ].join("\n");
  }

  const langHint = lang ? `Language: ${lang}\n` : "";
  return [
    "You are a speech-to-text post-processor.",
    "",
    "Your task:",
    "- Fix misheard words and homophones based on context",
    "- Add proper punctuation",
    "- Preserve technical terms exactly (API names, code identifiers)",
    "",
    "Rules:",
    "- Only correct errors — do not rephrase, add, or remove content",
    "- If already correct, return as-is",
    "- Return only the corrected text, no explanation",
    "",
    `${langHint}Transcript: ${text}`,
  ].join("\n");
}
