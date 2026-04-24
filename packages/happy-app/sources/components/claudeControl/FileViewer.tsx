import * as React from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import { remoteReadFile } from "@/sync/apiClaudeControl";
import type { ReadFileResponse } from "@kmmao/happy-wire";
import { log } from "@/log";

interface FileViewerProps {
    sessionId: string;
    path: string;
    onClose: () => void;
}

type LoadState =
    | { kind: "loading" }
    | { kind: "ok"; contents: string; absPath: string; truncated: boolean }
    | { kind: "denied"; reason: NonNullable<ReadFileResponse["deniedReason"]> }
    | { kind: "error" };

function denyMessage(
    reason: NonNullable<ReadFileResponse["deniedReason"]>,
): string {
    switch (reason) {
        case "blacklisted_path":
            return t("claudeControl.fileViewer.deniedBlacklistedPath");
        case "permission_denied":
            return t("claudeControl.fileViewer.deniedPermissionDenied");
        case "too_large":
            return t("claudeControl.fileViewer.deniedTooLarge");
        case "not_found":
            return t("claudeControl.fileViewer.deniedNotFound");
        case "error":
            return t("claudeControl.fileViewer.deniedError");
    }
}

/**
 * Full-screen viewer for a single remote file. Calls `read_file` with the
 * session's E2E encryption; renders the decrypted contents in a monospace
 * ScrollView. Shows a localized explainer when the CLI denies the read
 * (blacklist / Read-tool permission / size / not-found / error).
 */
export const FileViewer = React.memo(function FileViewer({
    sessionId,
    path,
    onClose,
}: FileViewerProps) {
    const [state, setState] = React.useState<LoadState>({ kind: "loading" });

    React.useEffect(() => {
        let cancelled = false;
        setState({ kind: "loading" });
        remoteReadFile(sessionId, path)
            .then((res) => {
                if (cancelled) return;
                if (res.result === null) {
                    setState({
                        kind: "denied",
                        reason: res.deniedReason ?? "error",
                    });
                    return;
                }
                setState({
                    kind: "ok",
                    contents: res.result.contents,
                    absPath: res.result.absPath,
                    truncated: !!res.result.truncated,
                });
            })
            .catch((e) => {
                log.log("[FileViewer] read_file failed", e);
                if (!cancelled) setState({ kind: "error" });
            });
        return () => {
            cancelled = true;
        };
    }, [sessionId, path]);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text
                    style={styles.headerTitle}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                >
                    {path}
                </Text>
                <Pressable
                    onPress={onClose}
                    accessibilityLabel={t("claudeControl.fileViewer.close")}
                    style={({ pressed }) => [
                        styles.closeButton,
                        pressed && { opacity: 0.65 },
                    ]}
                >
                    <Text style={styles.closeText}>
                        {t("claudeControl.fileViewer.close")}
                    </Text>
                </Pressable>
            </View>

            {state.kind === "loading" && (
                <View style={styles.centered}>
                    <ActivityIndicator />
                    <Text style={styles.mutedText}>
                        {t("claudeControl.fileViewer.loading")}
                    </Text>
                </View>
            )}

            {state.kind === "denied" && (
                <View style={styles.centered}>
                    <Text style={styles.errorText}>
                        {denyMessage(state.reason)}
                    </Text>
                </View>
            )}

            {state.kind === "error" && (
                <View style={styles.centered}>
                    <Text style={styles.errorText}>
                        {t("claudeControl.fileViewer.deniedError")}
                    </Text>
                </View>
            )}

            {state.kind === "ok" && (
                <>
                    {state.truncated && (
                        <View style={styles.truncatedBanner}>
                            <Text style={styles.truncatedText}>
                                {t("claudeControl.fileViewer.truncated")}
                            </Text>
                        </View>
                    )}
                    <ScrollView
                        style={styles.scroll}
                        contentContainerStyle={styles.scrollContent}
                    >
                        <Text style={styles.code}>{state.contents}</Text>
                    </ScrollView>
                </>
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.primary,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    headerTitle: {
        flex: 1,
        fontSize: 14,
        fontWeight: "600",
        color: theme.colors.text,
        marginRight: 12,
    },
    closeButton: {
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    closeText: {
        fontSize: 14,
        color: theme.colors.textLink,
    },
    centered: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
    },
    mutedText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    errorText: {
        fontSize: 14,
        color: theme.colors.textDestructive,
        textAlign: "center",
    },
    truncatedBanner: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: theme.colors.warning,
    },
    truncatedText: {
        fontSize: 13,
        color: theme.colors.text,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
    },
    code: {
        fontFamily: "Menlo",
        fontSize: 12,
        color: theme.colors.text,
    },
}));
