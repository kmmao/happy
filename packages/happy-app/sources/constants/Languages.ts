// Language type definition
export interface Language {
    code: string | null; // null for autodetect
    name: string;
    nativeName: string;
    region?: string;
    edgeTtsVoice?: string; // Edge TTS voice name
}

// Default Edge TTS voice (English)
const DEFAULT_EDGE_TTS_VOICE = 'en-US-JennyNeural';

// Comprehensive language list with locale codes, names, and regions
// First option is autodetect (null value)
export const LANGUAGES: Language[] = [
    { code: null, name: 'Auto-detect', nativeName: 'Auto-detect' },
    { code: 'en-US', name: 'English', nativeName: 'English', region: 'United States', edgeTtsVoice: 'en-US-JennyNeural' },
    { code: 'en-GB', name: 'English', nativeName: 'English', region: 'United Kingdom', edgeTtsVoice: 'en-GB-SoniaNeural' },
    { code: 'en-AU', name: 'English', nativeName: 'English', region: 'Australia', edgeTtsVoice: 'en-AU-NatashaNeural' },
    { code: 'en-CA', name: 'English', nativeName: 'English', region: 'Canada', edgeTtsVoice: 'en-CA-ClaraNeural' },
    { code: 'es-ES', name: 'Spanish', nativeName: 'Español', region: 'Spain', edgeTtsVoice: 'es-ES-ElviraNeural' },
    { code: 'es-MX', name: 'Spanish', nativeName: 'Español', region: 'Mexico', edgeTtsVoice: 'es-MX-DaliaNeural' },
    { code: 'es-AR', name: 'Spanish', nativeName: 'Español', region: 'Argentina', edgeTtsVoice: 'es-AR-ElenaNeural' },
    { code: 'fr-FR', name: 'French', nativeName: 'Français', region: 'France', edgeTtsVoice: 'fr-FR-DeniseNeural' },
    { code: 'fr-CA', name: 'French', nativeName: 'Français', region: 'Canada', edgeTtsVoice: 'fr-CA-SylvieNeural' },
    { code: 'de-DE', name: 'German', nativeName: 'Deutsch', region: 'Germany', edgeTtsVoice: 'de-DE-KatjaNeural' },
    { code: 'de-AT', name: 'German', nativeName: 'Deutsch', region: 'Austria', edgeTtsVoice: 'de-AT-IngridNeural' },
    { code: 'it-IT', name: 'Italian', nativeName: 'Italiano', edgeTtsVoice: 'it-IT-ElsaNeural' },
    { code: 'pt-BR', name: 'Portuguese', nativeName: 'Português', region: 'Brazil', edgeTtsVoice: 'pt-BR-FranciscaNeural' },
    { code: 'pt-PT', name: 'Portuguese', nativeName: 'Português', region: 'Portugal', edgeTtsVoice: 'pt-PT-RaquelNeural' },
    { code: 'ru-RU', name: 'Russian', nativeName: 'Русский', edgeTtsVoice: 'ru-RU-SvetlanaNeural' },
    { code: 'zh-CN', name: 'Chinese', nativeName: '中文', region: 'Simplified', edgeTtsVoice: 'zh-CN-XiaoxiaoNeural' },
    { code: 'zh-TW', name: 'Chinese', nativeName: '中文', region: 'Traditional', edgeTtsVoice: 'zh-TW-HsiaoChenNeural' },
    { code: 'ja-JP', name: 'Japanese', nativeName: '日本語', edgeTtsVoice: 'ja-JP-NanamiNeural' },
    { code: 'ko-KR', name: 'Korean', nativeName: '한국어', edgeTtsVoice: 'ko-KR-SunHiNeural' },
    { code: 'ar-SA', name: 'Arabic', nativeName: 'العربية', edgeTtsVoice: 'ar-SA-ZariyahNeural' },
    { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी', edgeTtsVoice: 'hi-IN-SwaraNeural' },
    { code: 'nl-NL', name: 'Dutch', nativeName: 'Nederlands', edgeTtsVoice: 'nl-NL-ColetteNeural' },
    { code: 'sv-SE', name: 'Swedish', nativeName: 'Svenska', edgeTtsVoice: 'sv-SE-SofieNeural' },
    { code: 'no-NO', name: 'Norwegian', nativeName: 'Norsk', edgeTtsVoice: 'nb-NO-PernilleNeural' },
    { code: 'da-DK', name: 'Danish', nativeName: 'Dansk', edgeTtsVoice: 'da-DK-ChristelNeural' },
    { code: 'fi-FI', name: 'Finnish', nativeName: 'Suomi', edgeTtsVoice: 'fi-FI-NooraNeural' },
    { code: 'pl-PL', name: 'Polish', nativeName: 'Polski', edgeTtsVoice: 'pl-PL-ZofiaNeural' },
    { code: 'tr-TR', name: 'Turkish', nativeName: 'Türkçe', edgeTtsVoice: 'tr-TR-EmelNeural' },
    { code: 'he-IL', name: 'Hebrew', nativeName: 'עברית', edgeTtsVoice: 'he-IL-HilaNeural' },
    { code: 'th-TH', name: 'Thai', nativeName: 'ไทย', edgeTtsVoice: 'th-TH-PremwadeeNeural' },
    { code: 'vi-VN', name: 'Vietnamese', nativeName: 'Tiếng Việt', edgeTtsVoice: 'vi-VN-HoaiMyNeural' },
    { code: 'id-ID', name: 'Indonesian', nativeName: 'Bahasa Indonesia', edgeTtsVoice: 'id-ID-GadisNeural' },
    { code: 'ms-MY', name: 'Malay', nativeName: 'Bahasa Melayu', edgeTtsVoice: 'ms-MY-YasminNeural' },
    { code: 'uk-UA', name: 'Ukrainian', nativeName: 'Українська', edgeTtsVoice: 'uk-UA-PolinaNeural' },
    { code: 'cs-CZ', name: 'Czech', nativeName: 'Čeština', edgeTtsVoice: 'cs-CZ-VlastaNeural' },
    { code: 'hu-HU', name: 'Hungarian', nativeName: 'Magyar', edgeTtsVoice: 'hu-HU-NoemiNeural' },
    { code: 'ro-RO', name: 'Romanian', nativeName: 'Română', edgeTtsVoice: 'ro-RO-AlinaNeural' },
    { code: 'bg-BG', name: 'Bulgarian', nativeName: 'Български', edgeTtsVoice: 'bg-BG-KalinaNeural' },
    { code: 'el-GR', name: 'Greek', nativeName: 'Ελληνικά', edgeTtsVoice: 'el-GR-AthinaNeural' },
    { code: 'hr-HR', name: 'Croatian', nativeName: 'Hrvatski', edgeTtsVoice: 'hr-HR-GabrijelaNeural' },
    { code: 'sk-SK', name: 'Slovak', nativeName: 'Slovenčina', edgeTtsVoice: 'sk-SK-ViktoriaNeural' },
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
