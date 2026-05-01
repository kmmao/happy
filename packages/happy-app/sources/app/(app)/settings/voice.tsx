import React, { useEffect, useState, useCallback } from "react";
import { TextInput, View, Text, ActivityIndicator, Pressable, Linking } from "react-native";
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
import { verifyLiveKitCredentials } from "@/sync/apiVoice";
import { VOICE_BACKEND_LIST, type VoiceBackend } from "@/realtime/voiceConfig";

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

function VoiceSettingsScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [voiceAssistantLanguage] = useSettingMutable("voiceAssistantLanguage");
    const [voiceBackend, setVoiceBackend] = useSettingMutable("voiceBackend");
    const [savedApiKey, setSavedApiKey] = useSettingMutable("elevenLabsApiKey");

    // ElevenLabs draft state
    const [draftKey, setDraftKey] = useState(savedApiKey ?? "");
    const [setupStatus, setSetupStatus] = useState<SetupStatus>(savedApiKey ? "success" : "idle");
    const [setupError, setSetupError] = useState<string | null>(null);

    // LiveKit BYOK state
    const [savedLkKey, setSavedLkKey] = useSettingMutable("livekitApiKey");
    const [savedLkSecret, setSavedLkSecret] = useSettingMutable("livekitApiSecret");
    const [savedLkWssUrl, setSavedLkWssUrl] = useSettingMutable("livekitWssUrl");
    const [draftLkKey, setDraftLkKey] = useState(savedLkKey ?? "");
    const [draftLkSecret, setDraftLkSecret] = useState(savedLkSecret ?? "");
    const [draftLkUrl, setDraftLkUrl] = useState(savedLkWssUrl ?? "");
    const [lkVerifyStatus, setLkVerifyStatus] = useState<SetupStatus>(savedLkKey && savedLkSecret ? "success" : "idle");
    const [lkVerifyError, setLkVerifyError] = useState<string | null>(null);
    const [lkActiveRooms, setLkActiveRooms] = useState<number | null>(null);
    const [lkTotalParticipants, setLkTotalParticipants] = useState<number | null>(null);
    const [lkDashboardUrl, setLkDashboardUrl] = useState<string | null>(null);

    useEffect(() => {
        setDraftLkKey(savedLkKey ?? "");
        setDraftLkSecret(savedLkSecret ?? "");
        setDraftLkUrl(savedLkWssUrl ?? "");
        if (savedLkKey && savedLkSecret) {
            setLkVerifyStatus("success");
        } else {
            setLkVerifyStatus("idle");
            setLkVerifyError(null);
        }
    }, [savedLkKey, savedLkSecret, savedLkWssUrl]);

    const isLkDirty = draftLkKey !== (savedLkKey ?? "") || draftLkSecret !== (savedLkSecret ?? "") || draftLkUrl !== (savedLkWssUrl ?? "");
    const hasLkKey = !!savedLkKey && !!savedLkSecret;

    const handleLkSave = useCallback(async () => {
        const key = draftLkKey.trim();
        const secret = draftLkSecret.trim();
        const url = draftLkUrl.trim() || null;
        if (!key || !secret) {
            setSavedLkKey(null);
            setSavedLkSecret(null);
            setSavedLkWssUrl(null);
            setLkVerifyStatus("idle");
            setLkVerifyError(null);
            return;
        }

        setLkVerifyStatus("checking");
        setLkVerifyError(null);

        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) throw new Error("Not authenticated");
            const result = await verifyLiveKitCredentials(credentials, key, secret, url ?? undefined);
            if (result.valid) {
                setSavedLkKey(key);
                setSavedLkSecret(secret);
                setSavedLkWssUrl(url);
                setLkVerifyStatus("success");
                setLkActiveRooms(result.activeRooms ?? null);
                setLkTotalParticipants(result.totalParticipants ?? null);
                setLkDashboardUrl(result.cloudDashboardUrl ?? null);
            } else {
                setLkVerifyStatus("error");
                setLkVerifyError(result.error || t("settingsVoice.livekitInvalidCredentials"));
            }
        } catch (err) {
            setLkVerifyStatus("error");
            setLkVerifyError(err instanceof Error ? err.message : "Verification failed");
        }
    }, [draftLkKey, draftLkSecret, draftLkUrl, setSavedLkKey, setSavedLkSecret, setSavedLkWssUrl]);

    const handleLkClear = useCallback(() => {
        setDraftLkKey("");
        setDraftLkSecret("");
        setDraftLkUrl("");
        setSavedLkKey(null);
        setSavedLkSecret(null);
        setSavedLkWssUrl(null);
        setLkVerifyStatus("idle");
        setLkVerifyError(null);
    }, [setSavedLkKey, setSavedLkSecret, setSavedLkWssUrl]);

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
                    icon={<Ionicons name="language-outline" size={29} color="#007AFF" />}
                    detail={getLanguageDisplayName(currentLanguage)}
                    onPress={() => router.push("/settings/voice/language")}
                />
            </ItemGroup>

            {/* Voice Backend Selector */}
            <ItemGroup
                title={t("settingsVoice.voiceBackendTitle")}
                footer={t("settingsVoice.voiceBackendDescription")}
            >
                {VOICE_BACKEND_LIST.map((backend) => {
                    const isSelected = voiceBackend === backend.id;
                    return (
                        <Pressable
                            key={backend.id}
                            onPress={() => setVoiceBackend(backend.id as VoiceBackend)}
                            style={({ pressed }) => ({
                                flexDirection: "row",
                                alignItems: "center",
                                paddingHorizontal: 16,
                                paddingVertical: 12,
                                backgroundColor: pressed ? theme.colors.divider : "transparent",
                                gap: 12,
                            })}
                        >
                            <View style={{
                                width: 22,
                                height: 22,
                                borderRadius: 11,
                                borderWidth: 2,
                                borderColor: isSelected ? "#007AFF" : theme.colors.divider,
                                alignItems: "center",
                                justifyContent: "center",
                            }}>
                                {isSelected && (
                                    <View style={{
                                        width: 12,
                                        height: 12,
                                        borderRadius: 6,
                                        backgroundColor: "#007AFF",
                                    }} />
                                )}
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={{
                                    fontSize: 16,
                                    fontWeight: "500",
                                    color: theme.colors.text,
                                }}>
                                    {backend.label}
                                </Text>
                                <Text style={{
                                    fontSize: 13,
                                    color: theme.colors.textSecondary,
                                    marginTop: 2,
                                }}>
                                    {backend.description}
                                </Text>
                            </View>
                        </Pressable>
                    );
                })}
            </ItemGroup>

            {/* LiveKit BYOK Config */}
            {voiceBackend === "livekit" && (
                <ItemGroup
                    title={t("settingsVoice.livekitConfig")}
                    footer={t("settingsVoice.livekitConfigDescription")}
                >
                    <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
                        <TextInput
                            style={{
                                fontSize: 16,
                                color: theme.colors.input.text,
                                borderWidth: 1,
                                borderColor: lkVerifyStatus === "success" ? "#34C759"
                                    : lkVerifyStatus === "error" ? theme.colors.textDestructive
                                    : theme.colors.divider,
                                borderRadius: 8,
                                paddingHorizontal: 12,
                                paddingVertical: 10,
                            }}
                            placeholder={t("settingsVoice.livekitApiKeyPlaceholder")}
                            placeholderTextColor={theme.colors.input.placeholder}
                            value={draftLkKey}
                            onChangeText={(text) => {
                                setDraftLkKey(text);
                                if (lkVerifyStatus !== "idle") setLkVerifyStatus("idle");
                                setLkVerifyError(null);
                            }}
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={lkVerifyStatus !== "checking"}
                        />
                        <TextInput
                            style={{
                                fontSize: 16,
                                color: theme.colors.input.text,
                                borderWidth: 1,
                                borderColor: lkVerifyStatus === "success" ? "#34C759"
                                    : lkVerifyStatus === "error" ? theme.colors.textDestructive
                                    : theme.colors.divider,
                                borderRadius: 8,
                                paddingHorizontal: 12,
                                paddingVertical: 10,
                            }}
                            placeholder={t("settingsVoice.livekitApiSecretPlaceholder")}
                            placeholderTextColor={theme.colors.input.placeholder}
                            value={draftLkSecret}
                            onChangeText={(text) => {
                                setDraftLkSecret(text);
                                if (lkVerifyStatus !== "idle") setLkVerifyStatus("idle");
                                setLkVerifyError(null);
                            }}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={lkVerifyStatus !== "checking"}
                        />
                        <TextInput
                            style={{
                                fontSize: 16,
                                color: theme.colors.input.text,
                                borderWidth: 1,
                                borderColor: lkVerifyStatus === "success" ? "#34C759"
                                    : lkVerifyStatus === "error" ? theme.colors.textDestructive
                                    : theme.colors.divider,
                                borderRadius: 8,
                                paddingHorizontal: 12,
                                paddingVertical: 10,
                            }}
                            placeholder={t("settingsVoice.livekitWssUrlPlaceholder")}
                            placeholderTextColor={theme.colors.input.placeholder}
                            value={draftLkUrl}
                            onChangeText={(text) => {
                                setDraftLkUrl(text);
                                if (lkVerifyStatus !== "idle") setLkVerifyStatus("idle");
                                setLkVerifyError(null);
                            }}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="url"
                            editable={lkVerifyStatus !== "checking"}
                        />

                        <View style={{ flexDirection: "row", gap: 8 }}>
                            <Pressable
                                onPress={handleLkSave}
                                disabled={lkVerifyStatus === "checking" || (!isLkDirty && lkVerifyStatus === "success")}
                                style={({ pressed }) => ({
                                    flex: 1,
                                    backgroundColor: lkVerifyStatus === "checking" || (!isLkDirty && lkVerifyStatus === "success")
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
                                {lkVerifyStatus === "checking" ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : lkVerifyStatus === "success" && !isLkDirty ? (
                                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                                ) : (
                                    <Ionicons name="save-outline" size={18} color="#fff" />
                                )}
                                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>
                                    {lkVerifyStatus === "checking" ? t("settingsVoice.livekitVerifying")
                                        : lkVerifyStatus === "success" && !isLkDirty ? t("settingsVoice.livekitVerified")
                                        : t("settingsVoice.livekitSaveVerify")}
                                </Text>
                            </Pressable>

                            {hasLkKey && (
                                <Pressable
                                    onPress={handleLkClear}
                                    disabled={lkVerifyStatus === "checking"}
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

                    {lkVerifyStatus === "error" && lkVerifyError && (
                        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                            <Text style={{ fontSize: 14, color: theme.colors.textDestructive }}>
                                {lkVerifyError}
                            </Text>
                        </View>
                    )}

                    {lkVerifyStatus === "success" && !isLkDirty && (
                        <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <Ionicons name="checkmark-circle" size={16} color="#34C759" />
                                <Text style={{ fontSize: 14, color: "#34C759" }}>
                                    {t("settingsVoice.livekitVerifySuccess")}
                                </Text>
                            </View>
                            <View style={{ gap: 4 }}>
                                {savedLkWssUrl && (
                                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                                        <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                                            {t("settingsVoice.livekitProject")}
                                        </Text>
                                        <Text style={{ fontSize: 13, color: theme.colors.text }}>
                                            {savedLkWssUrl.replace(/^wss?:\/\//, "").replace(/\.livekit\.cloud$/, "")}
                                        </Text>
                                    </View>
                                )}
                                {lkActiveRooms !== null && (
                                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                                        <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                                            {t("settingsVoice.livekitActiveRooms")}
                                        </Text>
                                        <Text style={{ fontSize: 13, color: theme.colors.text }}>
                                            {lkActiveRooms} {lkTotalParticipants !== null ? `(${lkTotalParticipants} ${t("settingsVoice.livekitParticipants")})` : ""}
                                        </Text>
                                    </View>
                                )}
                                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                                        {t("settingsVoice.livekitMode")}
                                    </Text>
                                    <Text style={{ fontSize: 13, color: "#007AFF" }}>
                                        BYOK
                                    </Text>
                                </View>
                                {lkDashboardUrl && (
                                    <Pressable onPress={() => Linking.openURL(lkDashboardUrl)}>
                                        <Text style={{ fontSize: 13, color: "#007AFF", marginTop: 4 }}>
                                            {t("settingsVoice.livekitViewUsage")} →
                                        </Text>
                                    </Pressable>
                                )}
                            </View>
                        </View>
                    )}

                    {lkVerifyStatus === "idle" && !hasLkKey && (
                        <View style={{ paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                            <Ionicons name="information-circle-outline" size={16} color={theme.colors.textSecondary} style={{ marginTop: 1 }} />
                            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, flex: 1 }}>
                                {t("settingsVoice.livekitServerManagedNote")}
                            </Text>
                        </View>
                    )}
                </ItemGroup>
            )}

            {/* ElevenLabs API Key — shown when elevenlabs backend is selected */}
            {voiceBackend === "elevenlabs" && <ItemGroup
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
            </ItemGroup>}
        </ItemList>
    );
}

export default React.memo(VoiceSettingsScreen);
