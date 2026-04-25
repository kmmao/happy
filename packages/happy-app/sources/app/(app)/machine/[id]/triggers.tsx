import * as React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
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

function formatNextRun(ts: number | null): string {
    if (!ts) return t("triggers.never");
    const diff = ts - Date.now();
    if (diff <= 0) return t("triggers.never");
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `in ${hrs}h`;
    return `in ${Math.floor(hrs / 24)}d`;
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
    return (
        <View
            style={{
                backgroundColor: enabled ? "#34C75922" : "#8E8E9322",
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 3,
            }}
        >
            <Text style={{ fontSize: 11, fontWeight: "700", color: enabled ? "#34C759" : "#8E8E93" }}>
                {enabled ? t("triggers.enabled") : t("triggers.disabled")}
            </Text>
        </View>
    );
}

function ScheduleCard({ schedule, onPress }: { schedule: ServerTriggerSchedule; onPress: () => void }) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            style={({ pressed }) => ({
                flexDirection: "row",
                backgroundColor: theme.colors.surface,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: schedule.enabled ? "#34C75930" : theme.colors.divider,
                overflow: "hidden",
                opacity: pressed ? 0.75 : 1,
            })}
            onPress={onPress}
        >
            <View style={{ width: 4, backgroundColor: schedule.enabled ? "#34C759" : "#8E8E93" }} />
            <View style={{ flex: 1, paddingVertical: 11, paddingLeft: 12, gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 12 }}>
                    <Text
                        style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text, flex: 1, marginRight: 8 }}
                        numberOfLines={1}
                    >
                        {schedule.name ?? schedule.cronExpression}
                    </Text>
                    <EnabledBadge enabled={schedule.enabled} />
                </View>
                {schedule.name && (
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                        {schedule.cronExpression}
                    </Text>
                )}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="play-circle-outline" size={12} color={theme.colors.textSecondary} />
                        <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>
                            {t("triggers.runCount", { count: schedule.runCount })}
                        </Text>
                    </View>
                    {schedule.enabled && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Ionicons name="time-outline" size={12} color={theme.colors.textSecondary} />
                            <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>
                                {formatNextRun(schedule.nextRunAt)}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
            <View style={{ justifyContent: "center", paddingHorizontal: 12 }}>
                <Ionicons name="chevron-forward" size={15} color={theme.colors.textSecondary} />
            </View>
        </Pressable>
    );
}

function WebhookCard({ webhook, onPress }: { webhook: ServerWebhookTrigger; onPress: () => void }) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            style={({ pressed }) => ({
                flexDirection: "row",
                backgroundColor: theme.colors.surface,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: webhook.enabled ? "#0A84FF30" : theme.colors.divider,
                overflow: "hidden",
                opacity: pressed ? 0.75 : 1,
            })}
            onPress={onPress}
        >
            <View style={{ width: 4, backgroundColor: webhook.enabled ? "#0A84FF" : "#8E8E93" }} />
            <View style={{ flex: 1, paddingVertical: 11, paddingLeft: 12, gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 12 }}>
                    <Text
                        style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text, flex: 1, marginRight: 8 }}
                        numberOfLines={1}
                    >
                        {webhook.name ?? webhook.slug}
                    </Text>
                    <EnabledBadge enabled={webhook.enabled} />
                </View>
                <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                    /{webhook.slug}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="flash-outline" size={12} color={theme.colors.textSecondary} />
                    <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>
                        {t("triggers.triggerCount", { count: webhook.triggerCount })}
                    </Text>
                </View>
            </View>
            <View style={{ justifyContent: "center", paddingHorizontal: 12 }}>
                <Ionicons name="chevron-forward" size={15} color={theme.colors.textSecondary} />
            </View>
        </Pressable>
    );
}

function EmptySection({ message, iconName }: { message: string; iconName: React.ComponentProps<typeof Ionicons>["name"] }) {
    const { theme } = useUnistyles();
    return (
        <View style={{ alignItems: "center", paddingVertical: 28, gap: 8 }}>
            <Ionicons name={iconName} size={32} color={theme.colors.textSecondary} style={{ opacity: 0.4 }} />
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>{message}</Text>
        </View>
    );
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
            Modal.alert(t("triggers.secret"), secret, [{ text: t("common.ok") }]);
        });
    }, []);

    const handleSchedulePress = React.useCallback((schedule: ServerTriggerSchedule) => {
        Modal.alert(
            schedule.name ?? schedule.cronExpression,
            `${t("triggers.nextRunAt")}: ${schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : t("triggers.never")}\n${t("triggers.runCount", { count: schedule.runCount })}`,
            [
                { text: t("triggers.editSchedule"), onPress: () => router.push(`/machine/${machineId}/trigger-schedule/${schedule.id}` as any) },
                { text: schedule.enabled ? t("triggers.disabled") : t("triggers.enabled"), onPress: () => doToggleSchedule(schedule.id) },
                {
                    text: t("common.delete"), style: "destructive",
                    onPress: () => Modal.alert(t("common.delete"), t("triggers.deleteConfirm"), [
                        { text: t("common.cancel"), style: "cancel" },
                        { text: t("common.delete"), style: "destructive", onPress: () => doDeleteSchedule(schedule.id) },
                    ]),
                },
                { text: t("common.cancel"), style: "cancel" },
            ],
        );
    }, [doToggleSchedule, doDeleteSchedule, router, machineId]);

    const handleWebhookPress = React.useCallback((webhook: ServerWebhookTrigger) => {
        const webhookUrl = `${getServerUrl()}/v1/triggers/${webhook.slug}`;
        Modal.alert(
            webhook.name ?? webhook.slug,
            `${t("triggers.webhookUrl")}: ${webhookUrl}\n${t("triggers.triggerCount", { count: webhook.triggerCount })}`,
            [
                { text: t("triggers.editWebhook"), onPress: () => router.push(`/machine/${machineId}/webhook-trigger/${webhook.id}` as any) },
                { text: t("triggers.copyUrl"), onPress: () => { void import("expo-clipboard").then(({ setStringAsync }) => setStringAsync(webhookUrl)); } },
                { text: webhook.enabled ? t("triggers.disabled") : t("triggers.enabled"), onPress: () => doToggleWebhook(webhook.id, webhook.enabled) },
                {
                    text: t("triggers.regenerateSecret"),
                    onPress: () => Modal.alert(t("triggers.regenerateSecret"), t("triggers.regenerateConfirm"), [
                        { text: t("common.cancel"), style: "cancel" },
                        { text: t("triggers.regenerateSecret"), onPress: () => doRegenerateSecret(webhook.id) },
                    ]),
                },
                {
                    text: t("common.delete"), style: "destructive",
                    onPress: () => Modal.alert(t("common.delete"), t("triggers.deleteConfirm"), [
                        { text: t("common.cancel"), style: "cancel" },
                        { text: t("common.delete"), style: "destructive", onPress: () => doDeleteWebhook(webhook.id) },
                    ]),
                },
                { text: t("common.cancel"), style: "cancel" },
            ],
        );
    }, [doToggleWebhook, doDeleteWebhook, doRegenerateSecret, router, machineId]);

    const handleCreate = React.useCallback(() => {
        Modal.alert(t("triggers.title"), "", [
            { text: t("triggers.createSchedule"), onPress: () => router.push(`/machine/${machineId}/trigger-schedule/new`) },
            { text: t("triggers.createWebhook"), onPress: () => router.push(`/machine/${machineId}/webhook-trigger/new`) },
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
            style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}
            contentContainerStyle={{ maxWidth: layout.maxWidth, width: "100%", alignSelf: "center" as const, paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} />}
        >
            <ItemGroup title={t("triggers.cronSchedules")}>
                <View style={styles.sectionPad}>
                    {schedules.length === 0 ? (
                        <EmptySection message={t("triggers.noCronSchedules")} iconName="time-outline" />
                    ) : (
                        <View style={styles.cardList}>
                            {schedules.map((s) => (
                                <ScheduleCard key={s.id} schedule={s} onPress={() => handleSchedulePress(s)} />
                            ))}
                        </View>
                    )}
                </View>
            </ItemGroup>

            <ItemGroup title={t("triggers.webhookTriggers")}>
                <View style={styles.sectionPad}>
                    {webhooks.length === 0 ? (
                        <EmptySection message={t("triggers.noWebhookTriggers")} iconName="flash-outline" />
                    ) : (
                        <View style={styles.cardList}>
                            {webhooks.map((w) => (
                                <WebhookCard key={w.id} webhook={w} onPress={() => handleWebhookPress(w)} />
                            ))}
                        </View>
                    )}
                </View>
            </ItemGroup>

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
    sectionPad: {
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 12,
    },
    cardList: {
        gap: 8,
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
