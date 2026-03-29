// ElevenLabs supported language codes
export type ElevenLabsLanguage = "en" | "ja" | "zh" | "de" | "hi" | "fr" | "ko" |
    "pt" | "pt-br" | "it" | "es" | "id" | "nl" | "tr" | "pl" | "sv" | "bg" |
    "ro" | "ar" | "cs" | "el" | "fi" | "ms" | "da" | "ta" | "uk" | "ru" |
    "hu" | "hr" | "sk" | "no" | "vi";

// Language type definition
export interface Language {
    code: string | null; // null for autodetect
    name: string;
    nativeName: string;
    region?: string;
    edgeTtsVoice?: string; // Edge TTS voice name
    elevenLabsCode?: ElevenLabsLanguage; // ElevenLabs language code mapping
}

// Default Edge TTS voice (English)
const DEFAULT_EDGE_TTS_VOICE = 'en-US-JennyNeural';

// Comprehensive language list with locale codes, names, and regions
// First option is autodetect (null value)
export const LANGUAGES: Language[] = [
    { code: null, name: 'Auto-detect', nativeName: 'Auto-detect' },
    { code: 'en-US', name: 'English', nativeName: 'English', region: 'United States', edgeTtsVoice: 'en-US-JennyNeural', elevenLabsCode: 'en' },
    { code: 'en-GB', name: 'English', nativeName: 'English', region: 'United Kingdom', edgeTtsVoice: 'en-GB-SoniaNeural', elevenLabsCode: 'en' },
    { code: 'en-AU', name: 'English', nativeName: 'English', region: 'Australia', edgeTtsVoice: 'en-AU-NatashaNeural', elevenLabsCode: 'en' },
    { code: 'en-CA', name: 'English', nativeName: 'English', region: 'Canada', edgeTtsVoice: 'en-CA-ClaraNeural', elevenLabsCode: 'en' },
    { code: 'es-ES', name: 'Spanish', nativeName: 'Español', region: 'Spain', edgeTtsVoice: 'es-ES-ElviraNeural', elevenLabsCode: 'es' },
    { code: 'es-MX', name: 'Spanish', nativeName: 'Español', region: 'Mexico', edgeTtsVoice: 'es-MX-DaliaNeural', elevenLabsCode: 'es' },
    { code: 'es-AR', name: 'Spanish', nativeName: 'Español', region: 'Argentina', edgeTtsVoice: 'es-AR-ElenaNeural', elevenLabsCode: 'es' },
    { code: 'fr-FR', name: 'French', nativeName: 'Français', region: 'France', edgeTtsVoice: 'fr-FR-DeniseNeural', elevenLabsCode: 'fr' },
    { code: 'fr-CA', name: 'French', nativeName: 'Français', region: 'Canada', edgeTtsVoice: 'fr-CA-SylvieNeural', elevenLabsCode: 'fr' },
    { code: 'de-DE', name: 'German', nativeName: 'Deutsch', region: 'Germany', edgeTtsVoice: 'de-DE-KatjaNeural', elevenLabsCode: 'de' },
    { code: 'de-AT', name: 'German', nativeName: 'Deutsch', region: 'Austria', edgeTtsVoice: 'de-AT-IngridNeural', elevenLabsCode: 'de' },
    { code: 'it-IT', name: 'Italian', nativeName: 'Italiano', edgeTtsVoice: 'it-IT-ElsaNeural', elevenLabsCode: 'it' },
    { code: 'pt-BR', name: 'Portuguese', nativeName: 'Português', region: 'Brazil', edgeTtsVoice: 'pt-BR-FranciscaNeural', elevenLabsCode: 'pt-br' },
    { code: 'pt-PT', name: 'Portuguese', nativeName: 'Português', region: 'Portugal', edgeTtsVoice: 'pt-PT-RaquelNeural', elevenLabsCode: 'pt' },
    { code: 'ru-RU', name: 'Russian', nativeName: 'Русский', edgeTtsVoice: 'ru-RU-SvetlanaNeural', elevenLabsCode: 'ru' },
    { code: 'zh-CN', name: 'Chinese', nativeName: '中文', region: 'Simplified', edgeTtsVoice: 'zh-CN-XiaoxiaoNeural', elevenLabsCode: 'zh' },
    { code: 'zh-TW', name: 'Chinese', nativeName: '中文', region: 'Traditional', edgeTtsVoice: 'zh-TW-HsiaoChenNeural', elevenLabsCode: 'zh' },
    { code: 'ja-JP', name: 'Japanese', nativeName: '日本語', edgeTtsVoice: 'ja-JP-NanamiNeural', elevenLabsCode: 'ja' },
    { code: 'ko-KR', name: 'Korean', nativeName: '한국어', edgeTtsVoice: 'ko-KR-SunHiNeural', elevenLabsCode: 'ko' },
    { code: 'ar-SA', name: 'Arabic', nativeName: 'العربية', edgeTtsVoice: 'ar-SA-ZariyahNeural', elevenLabsCode: 'ar' },
    { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी', edgeTtsVoice: 'hi-IN-SwaraNeural', elevenLabsCode: 'hi' },
    { code: 'nl-NL', name: 'Dutch', nativeName: 'Nederlands', edgeTtsVoice: 'nl-NL-ColetteNeural', elevenLabsCode: 'nl' },
    { code: 'sv-SE', name: 'Swedish', nativeName: 'Svenska', edgeTtsVoice: 'sv-SE-SofieNeural', elevenLabsCode: 'sv' },
    { code: 'no-NO', name: 'Norwegian', nativeName: 'Norsk', edgeTtsVoice: 'nb-NO-PernilleNeural', elevenLabsCode: 'no' },
    { code: 'da-DK', name: 'Danish', nativeName: 'Dansk', edgeTtsVoice: 'da-DK-ChristelNeural', elevenLabsCode: 'da' },
    { code: 'fi-FI', name: 'Finnish', nativeName: 'Suomi', edgeTtsVoice: 'fi-FI-NooraNeural', elevenLabsCode: 'fi' },
    { code: 'pl-PL', name: 'Polish', nativeName: 'Polski', edgeTtsVoice: 'pl-PL-ZofiaNeural', elevenLabsCode: 'pl' },
    { code: 'tr-TR', name: 'Turkish', nativeName: 'Türkçe', edgeTtsVoice: 'tr-TR-EmelNeural', elevenLabsCode: 'tr' },
    { code: 'he-IL', name: 'Hebrew', nativeName: 'עברית', edgeTtsVoice: 'he-IL-HilaNeural' },
    { code: 'th-TH', name: 'Thai', nativeName: 'ไทย', edgeTtsVoice: 'th-TH-PremwadeeNeural' },
    { code: 'vi-VN', name: 'Vietnamese', nativeName: 'Tiếng Việt', edgeTtsVoice: 'vi-VN-HoaiMyNeural', elevenLabsCode: 'vi' },
    { code: 'id-ID', name: 'Indonesian', nativeName: 'Bahasa Indonesia', edgeTtsVoice: 'id-ID-GadisNeural', elevenLabsCode: 'id' },
    { code: 'ms-MY', name: 'Malay', nativeName: 'Bahasa Melayu', edgeTtsVoice: 'ms-MY-YasminNeural', elevenLabsCode: 'ms' },
    { code: 'uk-UA', name: 'Ukrainian', nativeName: 'Українська', edgeTtsVoice: 'uk-UA-PolinaNeural', elevenLabsCode: 'uk' },
    { code: 'cs-CZ', name: 'Czech', nativeName: 'Čeština', edgeTtsVoice: 'cs-CZ-VlastaNeural', elevenLabsCode: 'cs' },
    { code: 'hu-HU', name: 'Hungarian', nativeName: 'Magyar', edgeTtsVoice: 'hu-HU-NoemiNeural', elevenLabsCode: 'hu' },
    { code: 'ro-RO', name: 'Romanian', nativeName: 'Română', edgeTtsVoice: 'ro-RO-AlinaNeural', elevenLabsCode: 'ro' },
    { code: 'bg-BG', name: 'Bulgarian', nativeName: 'Български', edgeTtsVoice: 'bg-BG-KalinaNeural', elevenLabsCode: 'bg' },
    { code: 'el-GR', name: 'Greek', nativeName: 'Ελληνικά', edgeTtsVoice: 'el-GR-AthinaNeural', elevenLabsCode: 'el' },
    { code: 'hr-HR', name: 'Croatian', nativeName: 'Hrvatski', edgeTtsVoice: 'hr-HR-GabrijelaNeural', elevenLabsCode: 'hr' },
    { code: 'sk-SK', name: 'Slovak', nativeName: 'Slovenčina', edgeTtsVoice: 'sk-SK-ViktoriaNeural', elevenLabsCode: 'sk' },
    { code: 'sl-SI', name: 'Slovenian', nativeName: 'Slovenščina', edgeTtsVoice: 'sl-SI-PetraNeural' },
    { code: 'et-EE', name: 'Estonian', nativeName: 'Eesti', edgeTtsVoice: 'et-EE-AnuNeural' },
    { code: 'lv-LV', name: 'Latvian', nativeName: 'Latviešu', edgeTtsVoice: 'lv-LV-EveritaNeural' },
    { code: 'lt-LT', name: 'Lithuanian', nativeName: 'Lietuvių', edgeTtsVoice: 'lt-LT-OnaNeural' },
];

/**
 * Format display name for a language
 */
export const getLanguageDisplayName = (language: Language) => {
    const parts = [];

    if (language.name !== language.nativeName) {
        parts.push(`${language.name} (${language.nativeName})`);
    } else {
        parts.push(language.name);
    }

    if (language.region) {
        parts.push(language.region);
    }

    return parts.join(' - ');
};

/**
 * Find a language by its code (including null for autodetect)
 */
export const findLanguageByCode = (code: string | null): Language | undefined => {
    return LANGUAGES.find(lang => lang.code === code);
};

/**
 * Get Edge TTS voice name from user's language preference.
 * Returns DEFAULT_EDGE_TTS_VOICE for auto-detect or unknown languages.
 */
export const getEdgeTtsVoice = (languageCode: string | null): string => {
    if (!languageCode) return DEFAULT_EDGE_TTS_VOICE;
    const language = findLanguageByCode(languageCode);
    return language?.edgeTtsVoice ?? DEFAULT_EDGE_TTS_VOICE;
};

/**
 * Get all languages that support Edge TTS
 */
export const getTtsSupportedLanguages = (): Language[] => {
    return LANGUAGES.filter(lang => lang.edgeTtsVoice !== undefined);
};

/**
 * Get ElevenLabs code from user's language preference (handles null/autodetect)
 */
export const getElevenLabsCodeFromPreference = (
    languageCode: string | null
): ElevenLabsLanguage | undefined => {
    if (!languageCode) return undefined; // Auto-detect case
    const language = findLanguageByCode(languageCode);
    return language?.elevenLabsCode;
};

/**
 * Get all languages that support ElevenLabs
 */
export const getElevenLabsSupportedLanguages = (): Language[] => {
    return LANGUAGES.filter(lang => lang.elevenLabsCode !== undefined);
};
