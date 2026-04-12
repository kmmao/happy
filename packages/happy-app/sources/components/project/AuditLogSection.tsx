import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal } from "@/modal";
import { TokenStorage } from "@/auth/tokenStorage";
import { vetoSuggestion, type AuditLogEntry } from "@/sync/apiWorld";

const VETO_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface AuditLogSectionProps {
    projectId: string;
    entries: AuditLogEntry[];
    onVetoed: () => void;
}

function typeIcon(type: string): keyof typeof Ionicons.glyphMap {
    if (type === "suggested_goal") return "flag-outline";
    if (type === "suggested_task") return "checkmark-circle-outline";
    if (type === "suggested_decision") return "help-circle-outline";
    return "flash-outline";
}

function typeColor(type: string): string {
    if (type === "suggested_goal") return "#8B5CF6";
    if (type === "suggested_task") return "#10B981";
    if (type === "suggested_decision") return "#F59E0B";
    return "#3B82F6";
}

function canVeto(entry: AuditLogEntry): boolean {
    if (entry.status !== "accepted") return false;
    if (!entry.actedAt) return false;
    return Date.now() - entry.actedAt < VETO_WINDOW_MS;
}

function formatTime(ts: number | null): string {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const AuditLogSection = React.memo(function AuditLogSection({
    projectId,
    entries,
    onVetoed,
}: AuditLogSectionProps) {
    const { theme } = useUnistyles();

    const handleVeto = React.useCallback(async (entry: AuditLogEntry) => {
        const confirmed = await Modal.confirm(
            t("governance.auditVetoConfirmTitle"),
            t("governance.auditVetoConfirmBody"),
        );
        if (!confirmed) return;

        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        try {
            await vetoSuggestion(credentials, projectId, entry.id);
            Modal.toast(t("governance.auditVetoed"));
            onVetoed();
        } catch {
            Modal.toast(t("governance.auditVetoFailed"));
        }
    }, [projectId, onVetoed]);

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <Ionicons name="list-outline" size={16} color={theme.colors.text} />
                <Text style={styles.title}>{t("governance.auditLog")}</Text>
            </View>

            {entries.length === 0 ? (
                <Text style={styles.emptyText}>{t("governance.auditEmpty")}</Text>
            ) : (
                entries.map((entry) => (
                    <View key={entry.id} style={styles.entry}>
                        <View style={styles.entryLeft}>
                            <Ionicons
                                name={typeIcon(entry.type)}
                                size={16}
                                color={typeColor(entry.type)}
                            />
                            <View style={styles.entryContent}>
                                <Text style={styles.entryTitle} numberOfLines={2}>
                                    {entry.title}
                                </Text>
                                <Text style={styles.entryMeta}>
                                    {entry.status === "dismissed"
                                        ? t("governance.auditVetoed")
                                        : t("governance.auditAutoAccepted")}
                                    {entry.actedAt ? ` · ${formatTime(entry.actedAt)}` : ""}
                                </Text>
                            </View>
                        </View>
                        {canVeto(entry) ? (
                            <Pressable
                                style={styles.vetoButton}
                                onPress={() => { void handleVeto(entry); }}
                            >
                                <Text style={styles.vetoText}>{t("governance.auditVeto")}</Text>
                            </Pressable>
                        ) : null}
                    </View>
                ))
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    card: {
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 16,
        gap: 10,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
        flex: 1,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    entry: {
        flexDirection: "row",
        alignItems: "flex-start",
        paddingVertical: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        gap: 8,
    },
    entryLeft: {
        flex: 1,
        flexDirection: "row",
        gap: 8,
    },
    entryContent: {
        flex: 1,
        gap: 2,
    },
    entryTitle: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    entryMeta: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    vetoButton: {
        borderWidth: 1,
        borderColor: "#EF4444" + "66",
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    vetoText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: "#EF4444",
    },
}));
