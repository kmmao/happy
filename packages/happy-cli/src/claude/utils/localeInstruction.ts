/**
 * Maps locale codes to human-readable language names for system prompt injection.
 * Only non-English locales need an explicit instruction.
 */
const LOCALE_NAMES: Record<string, string> = {
  "zh-Hans": "Chinese (Simplified) / 简体中文",
  "zh-Hant": "Chinese (Traditional) / 繁體中文",
  ja: "Japanese / 日本語",
  ru: "Russian / Русский",
  es: "Spanish / Español",
  pl: "Polish / Polski",
  it: "Italian / Italiano",
  pt: "Portuguese / Português",
  ca: "Catalan / Català",
};

/**
 * Build a locale instruction to append to the system prompt.
 * Returns null for English (default) or unknown locales.
 */
export function buildLocaleInstruction(
  locale: string | undefined,
): string | null {
  if (!locale || locale === "en") {
    return null;
  }

  const languageName = LOCALE_NAMES[locale];
  if (!languageName) {
    return null;
  }

  return `# Language Preference\nThe user's preferred language is ${languageName}. Use this language for session titles, responses, and all generated content unless the context specifically requires another language.`;
}
