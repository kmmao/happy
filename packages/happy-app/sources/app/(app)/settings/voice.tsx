import React, { useEffect, useState, useCallback } from "react";
import { TextInput, View, Text, ActivityIndicator, Pressable } from "react-native";
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
import { TokenStorage } from "@/auth/tokenStorage";
import { getServerUrl } from "@/sync/serverConfig";
import { config } from "@/config";

interface ElevenLabsSubscription {
    tier: string;
    character_count: number;
    character_limit: number;
    next_character_count_reset_unix: number;
    status: string;
}

type SetupStatus = "idle" | "checking" | "success" | "error";

function useElevenLabsSubscription(apiKey: string | null) {
    const [data, setData] = useState<ElevenLabsSubscription | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchSub = useCallback(async (key: string) => {
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
            fetchSub(apiKey);
        } else {
            setData(null);
            setError(null);
        }
    }, [apiKey, fetchSub]);

    return { data, loading, error };
}

async function verifyAndSetupAgent(apiKey: string): Promise<string> {
    const credentials = await TokenStorage.getCredentials();
    if (!credentials) throw new Error("Not authenticated");

    const agentId = config.elevenLabsAgentId;
    if (!agentId) throw new Error("Agent ID not configured");

    const serverUrl = getServerUrl();
    const resp = await fetch(`${serverUrl}/v1/voice/token`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${credentials.token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ agentId, userApiKey: apiKey }),
    });

    if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error || `Server error: ${resp.status}`);
    }

    const data = await resp.json();
    if (!data.allowed) {
        throw new Error(data.reason || "Not allowed");
    }

    return data.agentId;
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

/** Show that an env default exists without printing the whole secret. */
function maskSecret(secret: string): string {
    return secret.length <= 6 ? "••••••" : `${secret.slice(0, 6)}••••••`;
}

function GatewayField(props: {
    label: string;
    placeholder: string;
    value: string;
    onChangeText: (text: string) => void;
    secure?: boolean;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>{props.label}</Text>
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
                placeholder={props.placeholder}
                placeholderTextColor={theme.colors.input.placeholder}
                value={props.value}
                onChangeText={props.onChangeText}
                secureTextEntry={props.secure}
                autoCapitalize="none"
                autoCorrect={false}
            />
        </View>
    );
}

function VoiceSettingsScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [voiceAssistantLanguage] = useSettingMutable("voiceAssistantLanguage");
    const [savedApiKey, setSavedApiKey] = useSettingMutable("elevenLabsApiKey");

    // Voice provider selection
    const [voiceProvider, setVoiceProvider] = useSettingMutable("voiceProvider");
    const activeProvider = voiceProvider ?? "elevenlabs";

    // Realtime gateway configuration
    const [gatewayUrl, setGatewayUrl] = useSettingMutable("realtimeGatewayUrl");
    const [gatewayKey, setGatewayKey] = useSettingMutable("realtimeGatewayApiKey");
    const [realtimeVoice, setRealtimeVoice] = useSettingMutable("realtimeVoice");

    // Drafts so every keystroke does not trigger a settings sync
    const [gatewayDraft, setGatewayDraft] = useState({
        url: gatewayUrl ?? "",
        key: gatewayKey ?? "",
        voice: realtimeVoice ?? "",
    });

    useEffect(() => {
        setGatewayDraft({
            url: gatewayUrl ?? "",
            key: gatewayKey ?? "",
            voice: realtimeVoice ?? "",
        });
    }, [gatewayUrl, gatewayKey, realtimeVoice]);

    const gatewayDirty =
        gatewayDraft.url !== (gatewayUrl ?? "") ||
        gatewayDraft.key !== (gatewayKey ?? "") ||
        gatewayDraft.voice !== (realtimeVoice ?? "");

    const handleGatewaySave = useCallback(() => {
        setGatewayUrl(gatewayDraft.url.trim() || null);
        setGatewayKey(gatewayDraft.key.trim() || null);
        setRealtimeVoice(gatewayDraft.voice.trim() || null);
    }, [gatewayDraft, setGatewayUrl, setGatewayKey, setRealtimeVoice]);

    // ElevenLabs draft state
    const [draftKey, setDraftKey] = useState(savedApiKey ?? "");
    const [setupStatus, setSetupStatus] = useState<SetupStatus>(savedApiKey ? "success" : "idle");
    const [setupError, setSetupError] = useState<string | null>(null);

    // Sync ElevenLabs draft when saved key changes externally
    useEffect(() => {
        setDraftKey(savedApiKey ?? "");
        if (savedApiKey) setSetupStatus("success");
    }, [savedApiKey]);

    const isDirty = draftKey !== (savedApiKey ?? "");
    const hasKey = !!savedApiKey && savedApiKey.length > 10;

    const { data: subscription, loading: subLoading, error: subError } =
        useElevenLabsSubscription(savedApiKey);

    const currentLanguage =
        findLanguageByCode(voiceAssistantLanguage) || LANGUAGES[0];

    const remaining = subscription
        ? subscription.character_limit - subscription.character_count
        : null;
    const usagePercent = subscription
        ? Math.round((subscription.character_count / subscription.character_limit) * 100)
        : null;

    const handleSave = useCallback(async () => {
        const key = draftKey.trim();
        if (!key) {
            setSavedApiKey(null);
            setSetupStatus("idle");
            setSetupError(null);
            return;
        }

        setSetupStatus("checking");
        setSetupError(null);

        try {
            await verifyAndSetupAgent(key);
            setSavedApiKey(key);
            setSetupStatus("success");
        } catch (err) {
            setSetupStatus("error");
            setSetupError(err instanceof Error ? err.message : "Setup failed");
        }
    }, [draftKey, setSavedApiKey]);

    const handleClear = useCallback(() => {
        setDraftKey("");
        setSavedApiKey(null);
        setSetupStatus("idle");
        setSetupError(null);
    }, [setSavedApiKey]);

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
                    icon={<Ionicons name="language-outline" size={29} color={theme.colors.accentBlue} />}
                    detail={getLanguageDisplayName(currentLanguage)}
                    onPress={() => router.push("/settings/voice/language")}
                />
            </ItemGroup>

            {/* Voice provider */}
            <ItemGroup
                title={t("settingsVoice.providerTitle")}
                footer={t("settingsVoice.providerDescription")}
            >
                <Item
                    title={t("settingsVoice.providerElevenLabs")}
                    subtitle={t("settingsVoice.providerElevenLabsSubtitle")}
                    icon={<Ionicons name="mic-outline" size={29} color={theme.colors.accentBlue} />}
                    selected={activeProvider === "elevenlabs"}
                    onPress={() => setVoiceProvider("elevenlabs")}
                />
                <Item
                    title={t("settingsVoice.providerRealtime")}
                    subtitle={t("settingsVoice.providerRealtimeSubtitle")}
                    icon={<Ionicons name="flash-outline" size={29} color={theme.colors.accentBlue} />}
                    selected={activeProvider === "openai-realtime"}
                    onPress={() => setVoiceProvider("openai-realtime")}
                />
            </ItemGroup>

            {/* Realtime gateway configuration */}
            {activeProvider === "openai-realtime" && (
                <ItemGroup
                    title={t("settingsVoice.realtimeGatewayConfig")}
                    footer={t("settingsVoice.realtimeGatewayDescription")}
                >
                    <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
                        <GatewayField
                            label={t("settingsVoice.realtimeGatewayUrl")}
                            placeholder={
                                config.realtimeGatewayUrl ||
                                t("settingsVoice.realtimeGatewayUrlPlaceholder")
                            }
                            value={gatewayDraft.url}
                            onChangeText={(url) => setGatewayDraft((draft) => ({ ...draft, url }))}
                        />
                        <GatewayField
                            label={t("settingsVoice.realtimeGatewayApiKey")}
                            placeholder={
                                config.realtimeGatewayApiKey
                                    ? maskSecret(config.realtimeGatewayApiKey)
                                    : t("settingsVoice.realtimeGatewayApiKeyPlaceholder")
                            }
                            value={gatewayDraft.key}
                            onChangeText={(key) => setGatewayDraft((draft) => ({ ...draft, key }))}
                            secure
                        />
                        <GatewayField
                            label={t("settingsVoice.realtimeVoice")}
                            placeholder={
                                config.realtimeVoice || t("settingsVoice.realtimeVoicePlaceholder")
                            }
                            value={gatewayDraft.voice}
                            onChangeText={(voice) => setGatewayDraft((draft) => ({ ...draft, voice }))}
                        />

                        <Pressable
                            onPress={handleGatewaySave}
                            disabled={!gatewayDirty}
                            style={({ pressed }) => ({
                                backgroundColor: !gatewayDirty
                                    ? theme.colors.divider
                                    : pressed ? "#0066CC" : "#007AFF",
                                borderRadius: 8,
                                paddingVertical: 10,
                                alignItems: "center",
                                flexDirection: "row",
                                justifyContent: "center",
                                gap: 6,
                            })}
                        >
                            <Ionicons name="save-outline" size={18} color="#fff" />
                            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>
                                {t("common.save")}
                            </Text>
                        </Pressable>
                    </View>
                </ItemGroup>
            )}

            {/* ElevenLabs API Key */}
            {activeProvider === "elevenlabs" && (
            <ItemGroup
                title={t("settingsVoice.elevenLabsConfig")}
                footer={t("settingsVoice.elevenLabsApiKeyDescription")}
            >
                <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
                    <TextInput
                        style={{
                            fontSize: 16,
                            color: theme.colors.input.text,
                            borderWidth: 1,
                            borderColor: setupStatus === "success" ? "#34C759"
                                : setupStatus === "error" ? theme.colors.textDestructive
                                : theme.colors.divider,
                            borderRadius: 8,
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                        }}
                        placeholder={t("settingsVoice.elevenLabsApiKeyPlaceholder")}
                        placeholderTextColor={theme.colors.input.placeholder}
                        value={draftKey}
                        onChangeText={(text) => {
                            setDraftKey(text);
                            if (setupStatus !== "idle") setSetupStatus("idle");
                            setSetupError(null);
                        }}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={setupStatus !== "checking"}
                    />

                    <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable
                            onPress={handleSave}
                            disabled={setupStatus === "checking" || (!isDirty && setupStatus === "success")}
                            style={({ pressed }) => ({
                                flex: 1,
                                backgroundColor: setupStatus === "checking" || (!isDirty && setupStatus === "success")
                                    ? theme.colors.divider
                                    : pressed ? "#0066CC" : "#007AFF",
                                borderRadius: 8,
                                paddingVertical: 10,
                                alignItems: "center",
                                flexDirection: "row",
                                justifyContent: "center",
                                gap: 6,
                            })}
                        >
                            {setupStatus === "checking" ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : setupStatus === "success" && !isDirty ? (
                                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                            ) : (
                                <Ionicons name="save-outline" size={18} color="#fff" />
                            )}
                            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>
                                {setupStatus === "checking" ? t("settingsVoice.elevenLabsSetupChecking")
                                    : setupStatus === "success" && !isDirty ? t("settingsVoice.elevenLabsSetupReady")
                                    : t("settingsVoice.elevenLabsSave")}
                            </Text>
                        </Pressable>

                        {hasKey && (
                            <Pressable
                                onPress={handleClear}
                                disabled={setupStatus === "checking"}
                                style={({ pressed }) => ({
                                    backgroundColor: pressed ? theme.colors.divider : "transparent",
                                    borderRadius: 8,
                                    borderWidth: 1,
                                    borderColor: theme.colors.divider,
                                    paddingVertical: 10,
                                    paddingHorizontal: 16,
                                    alignItems: "center",
                                })}
                            >
                                <Ionicons name="trash-outline" size={18} color={theme.colors.textDestructive} />
                            </Pressable>
                        )}
                    </View>
                </View>

                {setupStatus === "error" && setupError && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                        <Text style={{ fontSize: 14, color: theme.colors.textDestructive }}>
                            {setupError}
                        </Text>
                    </View>
                )}

                {setupStatus === "success" && !isDirty && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Ionicons name="checkmark-circle" size={16} color="#34C759" />
                        <Text style={{ fontSize: 14, color: "#34C759" }}>
                            {t("settingsVoice.elevenLabsSetupSuccess")}
                        </Text>
                    </View>
                )}

                {subLoading && hasKey && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <ActivityIndicator size="small" />
                        <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
                            {t("settingsVoice.elevenLabsChecking")}
                        </Text>
                    </View>
                )}

                {subError && hasKey && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                        <Text style={{ fontSize: 14, color: theme.colors.textDestructive }}>
                            {subError}
                        </Text>
                    </View>
                )}

                {subscription && !subLoading && hasKey && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                            <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
                                {t("settingsVoice.elevenLabsPlan")}: {subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1)}
                            </Text>
                            <Text style={{ fontSize: 14, color: remaining !== null && remaining < 500 ? theme.colors.textDestructive : theme.colors.textSecondary }}>
                                {t("settingsVoice.elevenLabsRemaining")}: {remaining?.toLocaleString()}
                            </Text>
                        </View>

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
            )}
        </ItemList>
    );
}

export default React.memo(VoiceSettingsScreen);
