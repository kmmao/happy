/**
 * Diagnostics page for a machine.
 *
 * Shows all Happy CLI processes running on this machine,
 * with options to kill individual processes or clean all runaway ones.
 *
 * Route: /machine/{id}/diagnostics
 */

import * as React from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { machineBash, machineKillProcess } from "@/sync/ops";
import { Modal } from "@/modal";
import { layout } from "@/components/layout";
import { t } from "@/text";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HappyProcessType = "daemon" | "session" | "version-check" | "other";

interface HappyProcess {
    pid: number;
    type: HappyProcessType;
    command: string;
    /** Parsed from --happy-session-id flag; present when type === "session". */
    sessionId?: string;
}

// ---------------------------------------------------------------------------
// Process parsing helpers
// ---------------------------------------------------------------------------

function classifyProcess(cmd: string): HappyProcessType {
    if (cmd.includes("daemon start")) return "daemon";
    if (cmd.includes("--started-by daemon")) return "session";
    if (cmd.includes("--version")) return "version-check";
    return "other";
}

/** Extract --happy-session-id <value> from a process command string. */
function parseSessionId(cmd: string): string | undefined {
    const match = cmd.match(/--happy-session-id\s+(\S+)/);
    return match?.[1];
}

/**
 * Parse `ps aux` output lines into structured HappyProcess entries.
 * Expected format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND...
 */
function parsePsOutput(stdout: string): HappyProcess[] {
    const result: HappyProcess[] = [];

    for (const line of stdout.trim().split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 11) continue;
        const pid = parseInt(parts[1], 10);
        if (isNaN(pid) || pid <= 1) continue;
        const command = parts.slice(10).join(" ");
        const type = classifyProcess(command);
        const sessionId = type === "session" ? parseSessionId(command) : undefined;
        result.push({ pid, type, command, sessionId });
    }

    return result;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useHappyProcesses(machineId: string | undefined) {
    const [processes, setProcesses] = React.useState<HappyProcess[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const scan = React.useCallback(async () => {
        if (!machineId) return;
        const id = machineId; // narrow to string for async closure
        setIsLoading(true);
        setError(null);
        try {
            const result = await machineBash(
                id,
                "ps aux | grep -E 'happy\\.mjs|dist/index\\.mjs|happy-coder' | grep -v grep",
                "/",
            );
            if (result.success || result.exitCode === 1) {
                // exitCode 1 means grep found nothing — treat as empty
                setProcesses(parsePsOutput(result.stdout ?? ""));
            } else {
                setError(result.stderr || result.error || t("diagnostics.errorScanning"));
            }
        } catch {
            setError(t("diagnostics.errorScanning"));
        } finally {
            setIsLoading(false);
        }
    }, [machineId]);

    React.useEffect(() => {
        scan();
    }, [scan]);

    return { processes, isLoading, error, scan };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProcessTypeLabel({ type }: { type: HappyProcessType }) {
    const { theme } = useUnistyles();

    const config: Record<HappyProcessType, { label: string; color: string; icon: string }> = {
        daemon: { label: t("diagnostics.typeDaemon"), color: theme.colors.textLink, icon: "pulse-outline" },
        session: { label: t("diagnostics.typeSession"), color: "#10B981", icon: "terminal-outline" },
        "version-check": { label: t("diagnostics.typeVersionCheck"), color: theme.colors.textSecondary, icon: "search-outline" },
        other: { label: t("diagnostics.typeOther"), color: theme.colors.textSecondary, icon: "help-circle-outline" },
    };

    const { label, color, icon } = config[type];

    return (
        <View style={[typeStyles.badge, { backgroundColor: color + "1A" }]}>
            <Ionicons name={icon as any} size={11} color={color} />
            <Text style={[typeStyles.badgeText, { color }]}>{label}</Text>
        </View>
    );
}

const typeStyles = StyleSheet.create((theme) => ({
    badge: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: "600" as const,
    },
}));

function ProcessRow({
    proc,
    onKill,
    onOpenSession,
}: {
    proc: HappyProcess;
    onKill: (proc: HappyProcess) => Promise<void>;
    onOpenSession: (sessionId: string) => void;
}) {
    const { theme } = useUnistyles();
    const [isKilling, setIsKilling] = React.useState(false);

    const handleKill = async () => {
        setIsKilling(true);
        try {
            await onKill(proc);
        } finally {
            setIsKilling(false);
        }
    };

    // Show a short version of the command
    const shortCmd = proc.command.length > 60
        ? proc.command.slice(0, 57) + "..."
        : proc.command;

    const canOpenSession = proc.type === "session" && !!proc.sessionId;

    return (
        <View style={[rowStyles.row, { backgroundColor: theme.colors.surfaceHighest }]}>
            <Pressable
                style={rowStyles.info}
                onPress={canOpenSession ? () => onOpenSession(proc.sessionId!) : undefined}
                disabled={!canOpenSession}
            >
                <View style={rowStyles.header}>
                    <ProcessTypeLabel type={proc.type} />
                    <Text style={[rowStyles.pid, { color: theme.colors.textSecondary }]}>
                        PID {proc.pid}
                    </Text>
                    {canOpenSession && (
                        <Ionicons
                            name="chevron-forward-outline"
                            size={13}
                            color={theme.colors.textLink}
                        />
                    )}
                </View>
                <Text style={[rowStyles.cmd, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                    {shortCmd}
                </Text>
            </Pressable>
            <Pressable
                onPress={handleKill}
                disabled={isKilling}
                style={({ pressed }) => [
                    rowStyles.killBtn,
                    {
                        backgroundColor: theme.colors.textDestructive + "18",
                        opacity: pressed || isKilling ? 0.6 : 1,
                    },
                ]}
            >
                {isKilling ? (
                    <ActivityIndicator size="small" color={theme.colors.textDestructive} />
                ) : (
                    <Ionicons name="close-outline" size={16} color={theme.colors.textDestructive} />
                )}
            </Pressable>
        </View>
    );
}

const rowStyles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        marginBottom: 8,
        gap: 10,
    },
    info: {
        flex: 1,
        gap: 4,
    },
    header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
    },
    pid: {
        fontSize: 12,
        fontFamily: "Menlo",
    },
    cmd: {
        fontSize: 12,
        fontFamily: "Menlo",
        lineHeight: 16,
    },
    killBtn: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: "center" as const,
        justifyContent: "center" as const,
    },
}));

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default React.memo(function DiagnosticsPage() {
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const { theme } = useUnistyles();
    const router = useRouter();
    const { processes, isLoading, error, scan } = useHappyProcesses(machineId);
    const [isCleaning, setIsCleaning] = React.useState(false);

    const handleOpenSession = React.useCallback((sessionId: string) => {
        router.push(`/session/${sessionId}` as any);
    }, [router]);

    const handleKill = React.useCallback(async (proc: HappyProcess) => {
        const confirmed = await Modal.confirm(
            t("diagnostics.killConfirmTitle"),
            t("diagnostics.killConfirmMessage", { pid: proc.pid }),
        );
        if (!confirmed) return;

        const result = await machineKillProcess(machineId!, proc.pid);
        if (result.success) {
            await scan();
        } else {
            Modal.alert(t("common.error"), result.error || result.stderr || "Failed");
        }
    }, [machineId, scan]);

    const handleCleanRunaway = React.useCallback(async () => {
        const confirmed = await Modal.confirm(
            t("diagnostics.cleanConfirmTitle"),
            t("diagnostics.cleanConfirmMessage"),
        );
        if (!confirmed) return;

        setIsCleaning(true);
        try {
            const result = await machineBash(machineId!, "happy doctor clean", "/");
            if (result.success) {
                // Parse "Cleaned up N runaway processes" from stdout
                const match = (result.stdout ?? "").match(/(\d+)/);
                const killed = match ? parseInt(match[1], 10) : 0;
                Modal.alert(
                    t("common.success"),
                    t("diagnostics.cleanSuccess", { killed }),
                );
                await scan();
            } else {
                Modal.alert(t("common.error"), t("diagnostics.cleanFailed"));
            }
        } catch {
            Modal.alert(t("common.error"), t("diagnostics.cleanFailed"));
        } finally {
            setIsCleaning(false);
        }
    }, [machineId, scan]);

    // Runaway processes = daemon, version-check, session
    const runawayCount = processes.filter(
        (p) => p.type === "daemon" || p.type === "version-check" || p.type === "session",
    ).length;

    if (isLoading && processes.length === 0) {
        return (
            <View style={pageStyles.centered}>
                <ActivityIndicator size="large" color={theme.colors.text} />
                <Text style={[pageStyles.statusText, { color: theme.colors.textSecondary }]}>
                    {t("diagnostics.loading")}
                </Text>
            </View>
        );
    }

    return (
        <ScrollView
            style={[pageStyles.container, { backgroundColor: theme.colors.surface }]}
            contentContainerStyle={pageStyles.contentContainer}
        >
            <View style={pageStyles.inner}>
                {/* Header actions */}
                <View style={pageStyles.headerRow}>
                    <Text style={[pageStyles.countText, { color: theme.colors.textSecondary }]}>
                        {t("diagnostics.processCount", { count: processes.length })}
                    </Text>
                    <View style={pageStyles.headerActions}>
                        {/* Refresh */}
                        <Pressable
                            onPress={scan}
                            disabled={isLoading}
                            style={({ pressed }) => [
                                pageStyles.headerBtn,
                                {
                                    backgroundColor: theme.colors.surfaceHighest,
                                    opacity: pressed || isLoading ? 0.6 : 1,
                                },
                            ]}
                        >
                            {isLoading ? (
                                <ActivityIndicator size="small" color={theme.colors.text} />
                            ) : (
                                <Ionicons name="refresh-outline" size={16} color={theme.colors.text} />
                            )}
                        </Pressable>
                        {/* Clean runaway */}
                        {runawayCount > 0 && (
                            <Pressable
                                onPress={handleCleanRunaway}
                                disabled={isCleaning}
                                style={({ pressed }) => [
                                    pageStyles.headerBtn,
                                    {
                                        backgroundColor: theme.colors.textDestructive + "18",
                                        opacity: pressed || isCleaning ? 0.6 : 1,
                                    },
                                ]}
                            >
                                {isCleaning ? (
                                    <ActivityIndicator size="small" color={theme.colors.textDestructive} />
                                ) : (
                                    <Ionicons name="trash-outline" size={16} color={theme.colors.textDestructive} />
                                )}
                                <Text style={[pageStyles.cleanBtnText, { color: theme.colors.textDestructive }]}>
                                    {t("diagnostics.cleanRunaway")}
                                </Text>
                            </Pressable>
                        )}
                    </View>
                </View>

                {/* Error state */}
                {error && (
                    <View style={[pageStyles.errorBox, { backgroundColor: theme.colors.textDestructive + "18" }]}>
                        <Ionicons name="warning-outline" size={16} color={theme.colors.textDestructive} />
                        <Text style={[pageStyles.errorText, { color: theme.colors.textDestructive }]} numberOfLines={3}>
                            {error}
                        </Text>
                    </View>
                )}

                {/* Empty state */}
                {!isLoading && processes.length === 0 && !error && (
                    <View style={pageStyles.emptyState}>
                        <Ionicons name="checkmark-circle-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={[pageStyles.emptyTitle, { color: theme.colors.text }]}>
                            {t("diagnostics.noProcesses")}
                        </Text>
                        <Text style={[pageStyles.emptyHint, { color: theme.colors.textSecondary }]}>
                            {t("diagnostics.noProcessesHint")}
                        </Text>
                    </View>
                )}

                {/* Process list */}
                {processes.map((proc) => (
                    <ProcessRow key={proc.pid} proc={proc} onKill={handleKill} onOpenSession={handleOpenSession} />
                ))}
            </View>
        </ScrollView>
    );
});

const pageStyles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    contentContainer: {
        paddingBottom: 40,
    },
    inner: {
        width: "100%",
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    centered: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 12,
    },
    statusText: {
        fontSize: 16,
    },
    headerRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        marginBottom: 16,
    },
    countText: {
        fontSize: 14,
        fontWeight: "500" as const,
    },
    headerActions: {
        flexDirection: "row" as const,
        gap: 8,
    },
    headerBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        minWidth: 34,
        minHeight: 34,
        justifyContent: "center" as const,
    },
    cleanBtnText: {
        fontSize: 13,
        fontWeight: "600" as const,
    },
    errorBox: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 8,
        padding: 12,
        borderRadius: 10,
        marginBottom: 12,
    },
    errorText: {
        flex: 1,
        fontSize: 13,
        lineHeight: 18,
    },
    emptyState: {
        alignItems: "center" as const,
        paddingVertical: 48,
        gap: 12,
    },
    emptyTitle: {
        fontSize: 17,
        fontWeight: "600" as const,
    },
    emptyHint: {
        fontSize: 14,
        textAlign: "center" as const,
        paddingHorizontal: 32,
    },
}));
