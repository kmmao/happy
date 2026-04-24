import * as React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { layout } from "@/components/layout";
import { Modal } from "@/modal";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import {
    fetchTriggerSchedules,
    toggleTriggerSchedule,
    deleteTriggerSchedule,
    type ServerTriggerSchedule,
} from "@/sync/apiTriggerSchedules";
import {
    fetchWebhookTriggers,
    deleteWebhookTrigger,
    updateWebhookTrigger,
    regenerateWebhookSecret,
    type ServerWebhookTrigger,
} from "@/sync/apiWebhookTriggers";
import { getServerUrl } from "@/sync/serverConfig";

async function safeAction(fn: () => Promise<void>) {
    try {
        await fn();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Modal.alert(t("common.error"), msg, [{ text: t("common.ok") }]);
    }
}

function formatDate(ts: number | null): string {
    if (!ts) return t("triggers.never");
    return new Date(ts).toLocaleString();
}

function TriggersPage() {
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();

    const [schedules, setSchedules] = React.useState<ServerTriggerSchedule[]>([]);
    const [webhooks, setWebhooks] = React.useState<ServerWebhookTrigger[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);

    const load = React.useCallback(async (mode: "initial" | "refresh" = "initial") => {
        if (mode === "refresh") setRefreshing(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials || !machineId) return;

            const [sResult, wResult] = await Promise.all([
                fetchTriggerSchedules(credentials, { machineId }),
                fetchWebhookTriggers(credentials, { machineId }),
            ]);
            setSchedules(sResult.triggerSchedules);
            setWebhooks(wResult.webhookTriggers);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            Modal.alert(t("common.error"), msg, [{ text: t("common.ok") }]);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [machineId]);

    React.useEffect(() => { void load("initial"); }, [load]);

    // Schedule actions
    const doToggleSchedule = React.useCallback((id: string) => {
        void safeAction(async () => {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const updated = await toggleTriggerSchedule(credentials, id);
            setSchedules((prev) => prev.map((s) => s.id === id ? updated : s));
        });
    }, []);

    const doDeleteSchedule = React.useCallback((id: string) => {
        void safeAction(async () => {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            await deleteTriggerSchedule(credentials, id);
            setSchedules((prev) => prev.filter((s) => s.id !== id));
        });
    }, []);

    // Webhook actions
    const doToggleWebhook = React.useCallback((id: string, currentEnabled: boolean) => {
        void safeAction(async () => {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const updated = await updateWebhookTrigger(credentials, id, { enabled: !currentEnabled });
            setWebhooks((prev) => prev.map((w) => w.id === id ? updated : w));
        });
    }, []);

    const doDeleteWebhook = React.useCallback((id: string) => {
        void safeAction(async () => {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            await deleteWebhookTrigger(credentials, id);
            setWebhooks((prev) => prev.filter((w) => w.id !== id));
        });
    }, []);

    const doRegenerateSecret = React.useCallback((id: string) => {
        void safeAction(async () => {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const secret = await regenerateWebhookSecret(credentials, id);
            Modal.alert(t("triggers.secret"), secret, [
                { text: t("common.ok") },
            ]);
        });
    }, []);

    const handleSchedulePress = React.useCallback((schedule: ServerTriggerSchedule) => {
        const buttons: Array<{ text: string; style?: "cancel" | "destructive"; onPress?: () => void }> = [
            {
                text: t("triggers.editSchedule"),
                onPress: () => router.push(`/machine/${machineId}/trigger-schedule/${schedule.id}` as any),
            },
            {
                text: schedule.enabled ? t("triggers.disabled") : t("triggers.enabled"),
                onPress: () => doToggleSchedule(schedule.id),
            },
            {
                text: t("common.delete"),
                style: "destructive",
                onPress: () => {
                    Modal.alert(t("common.delete"), t("triggers.deleteConfirm"), [
                        { text: t("common.cancel"), style: "cancel" },
                        { text: t("common.delete"), style: "destructive", onPress: () => doDeleteSchedule(schedule.id) },
                    ]);
                },
            },
            { text: t("common.cancel"), style: "cancel" },
        ];
        Modal.alert(
            schedule.name ?? schedule.cronExpression,
            `${t("triggers.nextRunAt")}: ${formatDate(schedule.nextRunAt)}\n${t("triggers.runCount", { count: schedule.runCount })}`,
            buttons,
        );
    }, [doToggleSchedule, doDeleteSchedule]);

    const handleWebhookPress = React.useCallback((webhook: ServerWebhookTrigger) => {
        const webhookUrl = `${getServerUrl()}/v1/triggers/${webhook.slug}`;
        const buttons: Array<{ text: string; style?: "cancel" | "destructive"; onPress?: () => void }> = [
            {
                text: t("triggers.editWebhook"),
                onPress: () => router.push(`/machine/${machineId}/webhook-trigger/${webhook.id}` as any),
            },
            {
                text: t("triggers.copyUrl"),
                onPress: () => {
                    void import("expo-clipboard").then(({ setStringAsync }) => setStringAsync(webhookUrl));
                },
            },
            {
                text: webhook.enabled ? t("triggers.disabled") : t("triggers.enabled"),
                onPress: () => doToggleWebhook(webhook.id, webhook.enabled),
            },
            {
                text: t("triggers.regenerateSecret"),
                onPress: () => {
                    Modal.alert(t("triggers.regenerateSecret"), t("triggers.regenerateConfirm"), [
                        { text: t("common.cancel"), style: "cancel" },
                        { text: t("triggers.regenerateSecret"), onPress: () => doRegenerateSecret(webhook.id) },
                    ]);
                },
            },
            {
                text: t("common.delete"),
                style: "destructive",
                onPress: () => {
                    Modal.alert(t("common.delete"), t("triggers.deleteConfirm"), [
                        { text: t("common.cancel"), style: "cancel" },
                        { text: t("common.delete"), style: "destructive", onPress: () => doDeleteWebhook(webhook.id) },
                    ]);
                },
            },
            { text: t("common.cancel"), style: "cancel" },
        ];
        Modal.alert(
            webhook.name ?? webhook.slug,
            `${t("triggers.webhookUrl")}: ${webhookUrl}\n${t("triggers.triggerCount", { count: webhook.triggerCount })}`,
            buttons,
        );
    }, [doToggleWebhook, doDeleteWebhook, doRegenerateSecret]);

    const handleCreate = React.useCallback(() => {
        Modal.alert(t("triggers.title"), "", [
            {
                text: t("triggers.createSchedule"),
                onPress: () => router.push(`/machine/${machineId}/trigger-schedule/new`),
            },
            {
                text: t("triggers.createWebhook"),
                onPress: () => router.push(`/machine/${machineId}/webhook-trigger/new`),
            },
            { text: t("common.cancel"), style: "cancel" },
        ]);
    }, [router, machineId]);

    if (loading) {
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: theme.colors.surface }}
            contentContainerStyle={{ maxWidth: layout.maxWidth, width: "100%", alignSelf: "center" as const, paddingBottom: 80 }}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => void load("refresh")}
                />
            }
        >
            {/* Cron Schedules */}
            <ItemGroup title={t("triggers.cronSchedules")}>
                {schedules.length === 0 ? (
                    <Item title={t("triggers.noCronSchedules")} />
                ) : (
                    schedules.map((s) => (
                        <Item
                            key={s.id}
                            title={s.name ?? s.cronExpression}
                            subtitle={`${s.cronExpression} \u00b7 ${t("triggers.runCount", { count: s.runCount })}`}
                            onPress={() => handleSchedulePress(s)}
                            rightElement={
                                <View style={[styles.badge, { backgroundColor: s.enabled ? "#34C759" : "#8E8E93" }]}>
                                    <Text style={styles.badgeText}>
                                        {s.enabled ? t("triggers.enabled") : t("triggers.disabled")}
                                    </Text>
                                </View>
                            }
                            showChevron
                        />
                    ))
                )}
            </ItemGroup>

            {/* Webhook Triggers */}
            <ItemGroup title={t("triggers.webhookTriggers")}>
                {webhooks.length === 0 ? (
                    <Item title={t("triggers.noWebhookTriggers")} />
                ) : (
                    webhooks.map((w) => (
                        <Item
                            key={w.id}
                            title={w.name ?? w.slug}
                            subtitle={`/${w.slug} \u00b7 ${t("triggers.triggerCount", { count: w.triggerCount })}`}
                            onPress={() => handleWebhookPress(w)}
                            rightElement={
                                <View style={[styles.badge, { backgroundColor: w.enabled ? "#34C759" : "#8E8E93" }]}>
                                    <Text style={styles.badgeText}>
                                        {w.enabled ? t("triggers.enabled") : t("triggers.disabled")}
                                    </Text>
                                </View>
                            }
                            showChevron
                        />
                    ))
                )}
            </ItemGroup>

            {/* FAB */}
            <Pressable
                style={[styles.fab, { backgroundColor: theme.colors.textLink }]}
                onPress={handleCreate}
            >
                <Ionicons name="add" size={28} color="#FFF" />
            </Pressable>
        </ScrollView>
    );
}

export default React.memo(TriggersPage);

const styles = StyleSheet.create({
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
    fab: {
        position: "absolute",
        right: 20,
        bottom: 24,
        width: 56,
        height: 56,
        borderRadius: 28,
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
});
