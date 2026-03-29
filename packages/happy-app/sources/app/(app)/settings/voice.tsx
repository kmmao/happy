import React, { useEffect, useState, useCallback } from "react";
import { TextInput, View, Text, ActivityIndicator } from "react-native";
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

interface ElevenLabsSubscription {
    tier: string;
    character_count: number;
    character_limit: number;
    next_character_count_reset_unix: number;
    status: string;
}

function useElevenLabsSubscription(apiKey: string | null) {
    const [data, setData] = useState<ElevenLabsSubscription | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetch_ = useCallback(async (key: string) => {
        setLoading(true);
        setError(null);
        try {
            const resp = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
                headers: { "xi-api-key": key },
            });
            if (!resp.ok) {
                setError(resp.status === 401 ? t("settingsVoice.elevenLabsInvalidKey") : `Error ${resp.status}`);
                setData(null);
                return;
            }
            const json = await resp.json();
            setData(json as ElevenLabsSubscription);
        } catch {
            setError(t("settingsVoice.elevenLabsNetworkError"));
            setData(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (apiKey && apiKey.length > 10) {
            fetch_(apiKey);
        } else {
            setData(null);
            setError(null);
        }
    }, [apiKey, fetch_]);

    return { data, loading, error };
}

function formatResetTime(unix: number): string {
    const now = Date.now() / 1000;
    const diff = unix - now;
    if (diff <= 0) return t("settingsVoice.elevenLabsResetNow");
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    if (hours > 24) {
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function VoiceSettingsScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [voiceAssistantLanguage] = useSettingMutable("voiceAssistantLanguage");
    const [elevenLabsApiKey, setElevenLabsApiKey] =
        useSettingMutable("elevenLabsApiKey");

    const { data: subscription, loading, error: subError } =
        useElevenLabsSubscription(elevenLabsApiKey);

    const currentLanguage =
        findLanguageByCode(voiceAssistantLanguage) || LANGUAGES[0];

    const remaining = subscription
        ? subscription.character_limit - subscription.character_count
        : null;
    const usagePercent = subscription
        ? Math.round((subscription.character_count / subscription.character_limit) * 100)
        : null;

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

                {/* Subscription Status */}
                {loading && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <ActivityIndicator size="small" />
                        <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
                            {t("settingsVoice.elevenLabsChecking")}
                        </Text>
                    </View>
                )}

                {subError && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                        <Text style={{ fontSize: 14, color: theme.colors.textDestructive }}>
                            {subError}
                        </Text>
                    </View>
                )}

                {subscription && !loading && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
                        {/* Plan & Status */}
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                            <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
                                {t("settingsVoice.elevenLabsPlan")}: {subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1)}
                            </Text>
                            <Text style={{ fontSize: 14, color: remaining !== null && remaining < 500 ? theme.colors.textDestructive : theme.colors.textSecondary }}>
                                {t("settingsVoice.elevenLabsRemaining")}: {remaining?.toLocaleString()}
                            </Text>
                        </View>

                        {/* Usage Bar */}
                        <View style={{ height: 6, backgroundColor: theme.colors.divider, borderRadius: 3, overflow: "hidden" }}>
                            <View
                                style={{
                                    height: "100%",
                                    width: `${Math.min(usagePercent ?? 0, 100)}%`,
                                    backgroundColor: (usagePercent ?? 0) > 90 ? theme.colors.textDestructive : "#34C759",
                                    borderRadius: 3,
                                }}
                            />
                        </View>

                        {/* Usage Details */}
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                            <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                                {subscription.character_count.toLocaleString()} / {subscription.character_limit.toLocaleString()} chars ({usagePercent}%)
                            </Text>
                            <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                                {t("settingsVoice.elevenLabsResetIn")} {formatResetTime(subscription.next_character_count_reset_unix)}
                            </Text>
                        </View>
                    </View>
                )}
            </ItemGroup>
        </ItemList>
    );
}

export default React.memo(VoiceSettingsScreen);
