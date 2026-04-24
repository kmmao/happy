import * as React from "react";
import { ActivityIndicator, Pressable, TextInput, View, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { resolveActiveTint } from "@/constants/activeTint";
import { useHappyAction } from "@/hooks/useHappyAction";
import { TokenStorage } from "@/auth/tokenStorage";
import {
    fetchWebhookTriggers,
    updateWebhookTrigger,
    deleteWebhookTrigger,
    regenerateWebhookSecret,
    type ServerWebhookTrigger,
} from "@/sync/apiWebhookTriggers";
import { getServerUrl } from "@/sync/serverConfig";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { Modal } from "@/modal";
import { t } from "@/text";
import { ProfilePicker } from "@/components/ProfilePicker";
import { useSettings } from "@/sync/storage";
import { DEFAULT_PROFILES } from "@/sync/profileUtils";
import { getSupervisorAvailableProfiles } from "@/components/project/supervisorProfileSelection";
import { useRuntimeProfileEffectiveLabel } from "@/hooks/useRuntimeProfilePreview";

const PRIORITIES = ["background", "user", "urgent"] as const;

function priorityLabel(p: string): string {
    if (p === "user") return t("tasks.priorityUser");
    if (p === "urgent") return t("tasks.priorityUrgent");
    if (p === "background") return t("tasks.priorityBackground");
    return p;
}

function EditWebhookTriggerPage() {
    const { id: machineId, triggerId } = useLocalSearchParams<{ id: string; triggerId: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();

    const [trigger, setTrigger] = React.useState<ServerWebhookTrigger | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [name, setName] = React.useState("");
    const [prompt, setPrompt] = React.useState("");
    const [priority, setPriority] = React.useState<string>("background");
    const [enabled, setEnabled] = React.useState(true);
    const [selectedProfileId, setSelectedProfileId] = React.useState<string | null>(null);

    const settings = useSettings();
    const allProfiles = React.useMemo(() => {
        const builtInProfiles = DEFAULT_PROFILES.map((profile) => ({
            id: profile.id,
            name: profile.name,
            isBuiltIn: true as const,
        }));
        const userDefinedProfiles = (settings.profiles ?? []).map((p) => ({ id: p.id, name: p.name }));
        return getSupervisorAvailableProfiles(builtInProfiles, userDefinedProfiles);
    }, [settings.profiles]);

    const effectiveLabel = useRuntimeProfileEffectiveLabel(
        trigger?.projectId ?? null,
        "webhook",
    );

    // Load trigger from list (no single-fetch endpoint yet — list+filter is
    // acceptable since webhook counts are tiny per machine)
    React.useEffect(() => {
        let cancelled = false;
        void (async () => {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials || !machineId || !triggerId) return;
            try {
                const result = await fetchWebhookTriggers(credentials, { machineId });
                if (cancelled) return;
                const found = result.webhookTriggers.find((w) => w.id === triggerId);
                if (!found) {
                    Modal.alert(t("common.error"), "Webhook not found", [{ text: t("common.ok") }]);
                    router.back();
                    return;
                }
                setTrigger(found);
                setName(found.name ?? "");
                setPrompt(found.prompt);
                setPriority(found.priority);
                setEnabled(found.enabled);
                setSelectedProfileId(found.profileId);
            } catch (e) {
                if (cancelled) return;
                Modal.alert(t("common.error"), e instanceof Error ? e.message : String(e), [{ text: t("common.ok") }]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [machineId, triggerId, router]);

    const [saving, doSave] = useHappyAction(
        React.useCallback(async () => {
            if (!trigger) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            await updateWebhookTrigger(credentials, trigger.id, {
                name: name.trim() || null,
                prompt: prompt.trim(),
                priority,
                enabled,
                profileId: selectedProfileId,
            });
            Modal.toast(t("supervisor.settingsSaved"));
            router.back();
        }, [trigger, name, prompt, priority, enabled, selectedProfileId, router]),
    );

    const [regenerating, doRegenerate] = useHappyAction(
        React.useCallback(async () => {
            if (!trigger) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const secret = await regenerateWebhookSecret(credentials, trigger.id);
            Modal.alert(t("triggers.secret"), secret, [{ text: t("common.ok") }]);
        }, [trigger]),
    );

    const handleRegeneratePress = React.useCallback(() => {
        Modal.alert(t("triggers.regenerateSecret"), t("triggers.regenerateConfirm"), [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("triggers.regenerateSecret"), onPress: () => void doRegenerate() },
        ]);
    }, [doRegenerate]);

    const handleDeletePress = React.useCallback(() => {
        if (!trigger) return;
        Modal.alert(t("common.delete"), t("triggers.deleteConfirm"), [
            { text: t("common.cancel"), style: "cancel" },
            {
                text: t("common.delete"),
                style: "destructive",
                onPress: async () => {
                    const credentials = await TokenStorage.getCredentials();
                    if (!credentials) return;
                    await deleteWebhookTrigger(credentials, trigger.id);
                    router.back();
                },
            },
        ]);
    }, [trigger, router]);

    if (loading || !trigger) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator />
            </View>
        );
    }

    const webhookUrl = `${getServerUrl()}/v1/triggers/${trigger.slug}`;
    const canSubmit = prompt.trim().length > 0 && !saving;

    return (
        <ItemList>
            {/* Webhook URL (read-only) */}
            <ItemGroup title={t("triggers.webhookUrl")}>
                <View style={styles.readOnlyBox}>
                    <Text
                        style={[styles.monospace, { color: theme.colors.text }]}
                        selectable
                    >
                        {webhookUrl}
                    </Text>
                </View>
            </ItemGroup>

            {/* Name */}
            <ItemGroup title={t("triggers.name")}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.textInput, { color: theme.colors.text }]}
                        placeholder={t("triggers.namePlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={name}
                        onChangeText={setName}
                    />
                </View>
            </ItemGroup>

            {/* Prompt */}
            <ItemGroup title={t("triggers.prompt")}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.textArea, { color: theme.colors.text }]}
                        value={prompt}
                        onChangeText={setPrompt}
                        multiline
                        numberOfLines={6}
                        textAlignVertical="top"
                    />
                </View>
            </ItemGroup>

            {/* Priority */}
            <ItemGroup title={t("triggers.priority")}>
                <View style={styles.segmentedRow}>
                    {PRIORITIES.map((p) => (
                        <Pressable
                            key={p}
                            style={[
                                styles.segmentedButton,
                                {
                                    backgroundColor: priority === p
                                        ? theme.colors.textLink
                                        : theme.colors.surfaceHigh,
                                    borderColor: theme.colors.divider,
                                    borderWidth: priority === p ? 0 : 1,
                                },
                            ]}
                            onPress={() => setPriority(p)}
                        >
                            <Text
                                style={[
                                    styles.segmentedButtonText,
                                    { color: priority === p ? "#FFF" : theme.colors.text },
                                ]}
                            >
                                {priorityLabel(p)}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </ItemGroup>

            {/* Enabled toggle */}
            <ItemGroup title={enabled ? t("triggers.enabled") : t("triggers.disabled")}>
                <Item
                    title={enabled ? t("triggers.enabled") : t("triggers.disabled")}
                    onPress={() => setEnabled(!enabled)}
                    rightElement={
                        <View style={[styles.badge, { backgroundColor: enabled ? "#34C759" : "#8E8E93" }]}>
                            <Text style={styles.badgeText}>{enabled ? "ON" : "OFF"}</Text>
                        </View>
                    }
                />
            </ItemGroup>

            {/* Profile */}
            <ItemGroup title={t("triggers.profileSection")}>
                <View style={styles.profilePickerContainer}>
                    <ProfilePicker
                        value={selectedProfileId}
                        onChange={setSelectedProfileId}
                        profiles={allProfiles}
                        defaultOptionLabel={t("supervisor.defaultProfileDefault")}
                        description={t("triggers.profileDesc")}
                        effectiveLabel={effectiveLabel}
                    />
                </View>
            </ItemGroup>

            {/* Save */}
            <View style={styles.buttonContainer}>
                <Pressable
                    style={[
                        styles.primaryButton,
                        {
                            backgroundColor: canSubmit
                                ? resolveActiveTint(theme)
                                : theme.colors.textSecondary,
                        },
                    ]}
                    disabled={!canSubmit}
                    onPress={doSave}
                >
                    {saving ? (
                        <ActivityIndicator color="#FFF" />
                    ) : (
                        <Text style={styles.primaryButtonText}>{t("common.save")}</Text>
                    )}
                </Pressable>
            </View>

            {/* Regenerate secret */}
            <View style={styles.buttonContainer}>
                <Pressable
                    style={[styles.secondaryButton, { borderColor: theme.colors.divider }]}
                    disabled={regenerating}
                    onPress={handleRegeneratePress}
                >
                    <Text style={[styles.secondaryButtonText, { color: theme.colors.text }]}>
                        {t("triggers.regenerateSecret")}
                    </Text>
                </Pressable>
            </View>

            {/* Delete */}
            <View style={styles.buttonContainer}>
                <Pressable
                    style={[styles.secondaryButton, { borderColor: "#FF3B30" }]}
                    onPress={handleDeletePress}
                >
                    <Text style={[styles.secondaryButtonText, { color: "#FF3B30" }]}>
                        {t("common.delete")}
                    </Text>
                </Pressable>
            </View>
        </ItemList>
    );
}

export default React.memo(EditWebhookTriggerPage);

const styles = StyleSheet.create({
    loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    readOnlyBox: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    monospace: {
        ...Typography.default(),
        fontFamily: "monospace",
        fontSize: 13,
    },
    inputContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    textInput: {
        ...Typography.default(),
        fontSize: 15,
    },
    textArea: {
        ...Typography.default(),
        fontSize: 15,
        minHeight: 120,
    },
    segmentedRow: {
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    segmentedButton: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 10,
        alignItems: "center",
    },
    segmentedButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
    },
    badge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    badgeText: {
        color: "#FFF",
        fontSize: 11,
        fontWeight: "600",
    },
    profilePickerContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    buttonContainer: {
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    primaryButton: {
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: "center",
    },
    primaryButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: "#FFFFFF",
    },
    secondaryButton: {
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: "center",
        borderWidth: 1,
    },
    secondaryButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
    },
});
