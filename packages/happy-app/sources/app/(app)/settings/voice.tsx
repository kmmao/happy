import React from "react";
import { TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
  const [ttsProvider, setTtsProvider] = useSettingMutable("ttsProvider");
  const [elevenLabsApiKey, setElevenLabsApiKey] =
    useSettingMutable("elevenLabsApiKey");
  const [elevenLabsVoiceId, setElevenLabsVoiceId] =
    useSettingMutable("elevenLabsVoiceId");

  // Find current language or default to first option
  const currentLanguage =
    findLanguageByCode(voiceAssistantLanguage) || LANGUAGES[0];
  const isElevenLabs = ttsProvider === "elevenlabs";

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

      {/* TTS Provider Settings */}
      <ItemGroup
        title={t("settingsVoice.ttsProviderTitle")}
        footer={t("settingsVoice.ttsProviderDescription")}
      >
        <Item
          title={t("settingsVoice.ttsProviderEdge")}
          subtitle={t("settingsVoice.ttsProviderEdgeSubtitle")}
          icon={
            <Ionicons name="volume-medium-outline" size={29} color="#34C759" />
          }
          selected={!isElevenLabs}
          onPress={() => setTtsProvider("edge")}
        />
        <Item
          title={t("settingsVoice.ttsProviderElevenLabs")}
          subtitle={t("settingsVoice.ttsProviderElevenLabsSubtitle")}
          icon={<Ionicons name="diamond-outline" size={29} color="#AF52DE" />}
          selected={isElevenLabs}
          onPress={() => setTtsProvider("elevenlabs")}
        />
      </ItemGroup>

      {/* ElevenLabs Configuration (shown only when ElevenLabs is selected) */}
      {isElevenLabs && (
        <ItemGroup title="ElevenLabs">
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
                marginBottom: 12,
              }}
              placeholder={t("settingsVoice.elevenLabsApiKeyPlaceholder")}
              placeholderTextColor={theme.colors.input.placeholder}
              value={elevenLabsApiKey ?? ""}
              onChangeText={(text) => setElevenLabsApiKey(text || null)}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
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
              placeholder={t("settingsVoice.elevenLabsVoiceIdPlaceholder")}
              placeholderTextColor={theme.colors.input.placeholder}
              value={elevenLabsVoiceId ?? ""}
              onChangeText={(text) => setElevenLabsVoiceId(text || null)}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Item
            title={t("settingsVoice.elevenLabsVoiceId")}
            subtitle={t("settingsVoice.elevenLabsVoiceIdSubtitle")}
            disabled
          />
        </ItemGroup>
      )}
    </ItemList>
  );
}

export default React.memo(VoiceSettingsScreen);
