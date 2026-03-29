import React from "react";
import { TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { useSettingMutable } from "@/sync/storage";
import { useUnistyles } from "react-native-unistyles";
import {
    findLanguageByCode,
    getLanguageDisplayName,
    LANGUAGES,
} from "@/constants/Languages";
import { t } from "@/text";

function VoiceSettingsScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [voiceAssistantLanguage] = useSettingMutable("voiceAssistantLanguage");
    const [elevenLabsApiKey, setElevenLabsApiKey] =
        useSettingMutable("elevenLabsApiKey");

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

            {/* ElevenLabs API Key */}
            <ItemGroup
                title={t("settingsVoice.elevenLabsConfig")}
                footer={t("settingsVoice.elevenLabsApiKeyDescription")}
            >
                <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                    <TextInput
                        style={{
                            fontSize: 16,
                            color: theme.colors.input.text,
                            borderWidth: 1,
                            borderColor: theme.colors.divider,
                            borderRadius: 8,
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                        }}
                        placeholder={t("settingsVoice.elevenLabsApiKeyPlaceholder")}
                        placeholderTextColor={theme.colors.input.placeholder}
                        value={elevenLabsApiKey ?? ""}
                        onChangeText={(text) => setElevenLabsApiKey(text || null)}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                </View>
            </ItemGroup>
        </ItemList>
    );
}

export default React.memo(VoiceSettingsScreen);
