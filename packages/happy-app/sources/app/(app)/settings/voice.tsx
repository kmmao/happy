import React from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { useSettingMutable } from "@/sync/storage";
import {
    findLanguageByCode,
    getLanguageDisplayName,
    LANGUAGES,
} from "@/constants/Languages";
import { t } from "@/text";

function VoiceSettingsScreen() {
    const router = useRouter();
    const [voiceAssistantLanguage] = useSettingMutable("voiceAssistantLanguage");

    // Find current language or default to first option
    const currentLanguage =
        findLanguageByCode(voiceAssistantLanguage) || LANGUAGES[0];

    return (
        <ItemList style={{ paddingTop: 0 }}>
            {/* Language Settings */}
            <ItemGroup
                title={t("settingsVoice.languageTitle")}
                footer={t("settingsVoice.languageDescription")}
            >
                <Item
                    title={t("settingsVoice.preferredLanguage")}
                    subtitle={t("settingsVoice.preferredLanguageSubtitle")}
                    icon={<Ionicons name="language-outline" size={29} color="#007AFF" />}
                    detail={getLanguageDisplayName(currentLanguage)}
                    onPress={() => router.push("/settings/voice/language")}
                />
            </ItemGroup>
        </ItemList>
    );
}

export default React.memo(VoiceSettingsScreen);
