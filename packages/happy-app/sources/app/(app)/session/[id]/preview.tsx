/**
 * Frontend preview page for a session.
 *
 * Two modes:
 * - **Live**: Real-time WebView/iframe rendering of remote dev server pages
 * - **Screenshot**: Static screenshot capture via agent-browser (original mode)
 *
 * Route: /session/{id}/preview
 */

import * as React from "react";
import {
    View,
    ScrollView,
    Pressable,
    TextInput,
    Platform,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import { usePreview, type DetectedPort } from "@/hooks/usePreview";
import { useRemotePreview } from "@/hooks/useRemotePreview";
import { useHiddenProcesses } from "@/hooks/useHiddenProcesses";
import { useSession } from "@/sync/storage";
import { screenLayoutMaxWidth } from "@/components/layout";
import { SharedStateView } from "@/components/SharedStateView";
import { PreviewModeSwitch } from "@/components/preview/PreviewModeSwitch";
import { PreviewToolbar } from "@/components/preview/PreviewToolbar";
import { LivePreviewView } from "@/components/preview/LivePreviewView";
import { AnnotationOverlay } from "@/components/preview/AnnotationOverlay";
import { sync } from "@/sync/sync";
import { uploadImage } from "@/utils/imageUpload.shared";

type DiffTab = "before" | "after" | "diff";

export default React.memo(function PreviewPage() {
    const { id: sessionId, url: initialUrl } = useLocalSearchParams<{
        id: string;
        url?: string;
    }>();

    // ── Live Preview state ───────────────────────────────────────────────────
    const remote = useRemotePreview(sessionId);

    // ── Screenshot mode state (original) ─────────────────────────────────────
    const {
        state: screenshotState,
        baseline,
        detectPorts: detectScreenshotPorts,
        captureScreenshot,
        setBaseline,
        clearBaseline,
        compareWithBaseline,
    } = usePreview(sessionId);

    const session = useSession(sessionId);
    const machineId = session?.metadata?.machineId;
    const { filterProcesses } = useHiddenProcesses(machineId);
    const { theme } = useUnistyles();

    const [customUrl, setCustomUrl] = React.useState(initialUrl ?? "");
    const [diffTab, setDiffTab] = React.useState<DiffTab>("after");
    const [reloadKey, setReloadKey] = React.useState(0);
    const [annotating, setAnnotating] = React.useState(false);

    // Auto-detect ports on mount for screenshot mode
    React.useEffect(() => {
        if (sessionId && remote.mode === "screenshot") {
            detectScreenshotPorts();
        }
    }, [sessionId, remote.mode, detectScreenshotPorts]);

    // ── Handlers ─────────────────────────────────────────────────────────────

    const handlePortPress = React.useCallback(
        (port: DetectedPort) => {
            if (remote.mode === "live") {
                remote.selectPort(port);
            } else if (baseline) {
                compareWithBaseline(`http://localhost:${port.port}`);
            } else {
                captureScreenshot(`http://localhost:${port.port}`);
            }
        },
        [remote, baseline, captureScreenshot, compareWithBaseline],
    );

    const handleCustomCapture = React.useCallback(() => {
        const url = customUrl.trim();
        if (url.length === 0) return;
        if (remote.mode === "live") {
            remote.setUrl(url);
            setReloadKey((k) => k + 1);
        } else if (baseline) {
            compareWithBaseline(url);
        } else {
            captureScreenshot(url);
        }
    }, [customUrl, remote, baseline, captureScreenshot, compareWithBaseline]);

    const handleRefresh = React.useCallback(() => {
        setReloadKey((k) => k + 1);
    }, []);

    const handleAnnotate = React.useCallback(() => {
        setAnnotating(true);
    }, []);

    const handleAnnotationSubmit = React.useCallback(
        async (imageUri: string, comment: string) => {
            // Upload annotated screenshot if available (data URI from annotation overlay)
            let imagePart = "";
            if (imageUri && imageUri.startsWith("data:")) {
                try {
                    const base64 = imageUri.split(",")[1];
                    if (base64) {
                        const remotePath = await uploadImage(sessionId, base64);
                        imagePart = `[image: ${remotePath}]\n`;
                    }
                } catch {
                    // Proceed without image if upload fails
                }
            }

            const feedbackText = `[Preview Feedback]\n${imagePart}${comment}`;
            sync.sendMessage(sessionId, feedbackText);
            setAnnotating(false);
        },
        [sessionId],
    );

    const handleAnnotationCancel = React.useCallback(() => {
        setAnnotating(false);
    }, []);

    // ── Derive port lists ────────────────────────────────────────────────────

    const ports =
        remote.mode === "live"
            ? remote.state.ports
            : "ports" in screenshotState
                ? screenshotState.ports
                : [];
    const webPorts = filterProcesses(
        (ports as DetectedPort[]).filter((p) => p.isWeb),
    );

    // ── Annotation overlay ───────────────────────────────────────────────────

    if (annotating) {
        // TODO: In Sprint 2, capture WebView screenshot first.
        // For now, use a placeholder.
        return (
            <AnnotationOverlay
                screenshotUri=""
                width={remote.state.viewport.width}
                height={remote.state.viewport.height}
                onSubmit={handleAnnotationSubmit}
                onCancel={handleAnnotationCancel}
            />
        );
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <View style={styles.container}>
            <View style={styles.innerContainer}>
                {/* Mode switch */}
                <View style={styles.modeSwitchRow}>
                    <PreviewModeSwitch
                        mode={remote.mode}
                        onModeChange={remote.setMode}
                    />
                </View>

                {/* ── Live Preview Mode ───────────────────────────────────── */}
                {remote.mode === "live" && (
                    <>
                        <PreviewToolbar
                            url={remote.state.url}
                            viewport={remote.state.viewport}
                            zoom={remote.state.zoom}
                            onUrlChange={remote.setUrl}
                            onUrlSubmit={() => setReloadKey((k) => k + 1)}
                            onRefresh={handleRefresh}
                            onViewportChange={remote.setViewport}
                            onZoomIn={remote.zoomIn}
                            onZoomOut={remote.zoomOut}
                            onAnnotate={handleAnnotate}
                        />

                        {remote.state.status === "detecting" ? (
                            <SharedStateView
                                inline
                                kind="loading"
                                title={t("preview.detectingPorts")}
                            />
                        ) : remote.state.status === "error" ? (
                            <SharedStateView
                                inline
                                kind="error"
                                title="Preview Error"
                                description={remote.state.error}
                            />
                        ) : (
                            <View style={styles.previewArea}>
                                <LivePreviewView
                                    url={remote.state.url}
                                    viewport={remote.state.viewport}
                                    zoom={remote.state.zoom}
                                    onLoad={remote.onWebViewLoad}
                                    onError={remote.onWebViewError}
                                    reloadKey={reloadKey}
                                />
                            </View>
                        )}
                    </>
                )}

                {/* ── Screenshot Mode (original) ─────────────────────────── */}
                {remote.mode === "screenshot" && (
                    <ScrollView contentContainerStyle={styles.screenshotContent}>
                        {/* URL input */}
                        <View style={styles.topBar}>
                            <TextInput
                                style={[styles.topUrlInput, { color: theme.colors.text }]}
                                placeholder={t("preview.urlPlaceholder")}
                                placeholderTextColor={theme.colors.textSecondary}
                                value={customUrl}
                                onChangeText={setCustomUrl}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="url"
                                returnKeyType="go"
                                onSubmitEditing={handleCustomCapture}
                            />
                            <Pressable
                                onPress={handleCustomCapture}
                                style={({ pressed }) => [
                                    styles.topButton,
                                    {
                                        backgroundColor: theme.colors.button.primary.background,
                                        opacity: pressed ? 0.7 : 1,
                                    },
                                ]}
                            >
                                <Text style={styles.captureButtonText}>
                                    {baseline ? t("preview.compare") : t("preview.capture")}
                                </Text>
                            </Pressable>
                            <Pressable
                                onPress={detectScreenshotPorts}
                                style={({ pressed }) => [
                                    styles.topButton,
                                    {
                                        backgroundColor: theme.colors.surfaceHighest,
                                        opacity: pressed ? 0.7 : 1,
                                    },
                                ]}
                            >
                                <Ionicons name="refresh-outline" size={16} color={theme.colors.text} />
                            </Pressable>
                        </View>

                        {/* Loading states */}
                        {(screenshotState.status === "idle" || screenshotState.status === "detecting-ports") && (
                            <SharedStateView
                                inline
                                kind="loading"
                                title={t("preview.detectingPorts")}
                            />
                        )}

                        {screenshotState.status === "unavailable" && (
                            <SharedStateView
                                inline
                                kind="empty"
                                title={t("preview.unavailableTitle")}
                                description={t("preview.unavailableHint")}
                            />
                        )}

                        {(screenshotState.status === "capturing" || screenshotState.status === "comparing") && (
                            <SharedStateView
                                inline
                                kind="loading"
                                title={screenshotState.status === "capturing" ? t("preview.capturing") : t("preview.comparing")}
                            />
                        )}

                        {screenshotState.status === "ports-detected" && (
                            <SharedStateView
                                inline
                                kind="empty"
                                title={t("preview.emptyHint")}
                                icon={<Ionicons name="camera-outline" size={28} color={theme.colors.textSecondary} />}
                            />
                        )}

                        {/* Diff comparison */}
                        {screenshotState.status === "compared" && (
                            <View style={styles.screenshotSection}>
                                <View style={styles.tabBar}>
                                    {(["before", "after", "diff"] as const).map((tab) => (
                                        <Pressable
                                            key={tab}
                                            onPress={() => setDiffTab(tab)}
                                            style={[
                                                styles.tab,
                                                diffTab === tab && { borderBottomColor: theme.colors.textLink },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.tabText,
                                                    { color: diffTab === tab ? theme.colors.textLink : theme.colors.textSecondary },
                                                ]}
                                            >
                                                {t(`preview.${tab}`)}
                                            </Text>
                                        </Pressable>
                                    ))}
                                </View>
                                <Image
                                    source={{
                                        uri:
                                            diffTab === "before" ? screenshotState.diff.baseline.uri :
                                            diffTab === "after" ? screenshotState.diff.current.uri :
                                            screenshotState.diff.diffUri,
                                    }}
                                    style={{ width: "100%", aspectRatio: 16 / 10, minHeight: 200 }}
                                    contentFit="contain"
                                    transition={150}
                                />
                            </View>
                        )}

                        {/* Single screenshot */}
                        {screenshotState.status === "captured" && (
                            <View style={styles.screenshotSection}>
                                <Image
                                    source={{ uri: screenshotState.screenshot.uri }}
                                    style={{ width: "100%", aspectRatio: 16 / 10, minHeight: 200 }}
                                    contentFit="contain"
                                    transition={200}
                                />
                            </View>
                        )}

                        {/* Error */}
                        {screenshotState.status === "error" && (
                            <SharedStateView
                                inline
                                kind="error"
                                title={t("preview.screenshotFailed")}
                                description={screenshotState.message}
                            />
                        )}

                        {/* Baseline controls */}
                        {baseline ? (
                            <View style={styles.baselineBar}>
                                <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
                                <Text style={[styles.baselineText, { color: theme.colors.text }]}>
                                    {t("preview.baselineSet")}
                                </Text>
                                <Pressable onPress={clearBaseline} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
                                    <Text style={{ color: theme.colors.textDestructive, fontSize: 13 }}>
                                        {t("preview.clearBaseline")}
                                    </Text>
                                </Pressable>
                            </View>
                        ) : screenshotState.status === "captured" ? (
                            <View style={styles.baselineBar}>
                                <Pressable
                                    onPress={setBaseline}
                                    style={({ pressed }) => [
                                        styles.actionButton,
                                        { backgroundColor: theme.colors.button.primary.background, opacity: pressed ? 0.7 : 1 },
                                    ]}
                                >
                                    <Ionicons name="bookmark-outline" size={16} color="#fff" />
                                    <Text style={styles.captureButtonText}>{t("preview.setBaseline")}</Text>
                                </Pressable>
                            </View>
                        ) : null}
                    </ScrollView>
                )}

                {/* ── Dev Servers (shared) ────────────────────────────────── */}
                <View style={styles.portsSection}>
                    <Text style={styles.sectionTitle}>{t("preview.devServers")}</Text>
                    {webPorts.length === 0 ? (
                        <Text style={styles.emptyPortsText}>{t("preview.noPorts")}</Text>
                    ) : (
                        <View style={styles.chipContainer}>
                            {webPorts.map((p) => (
                                <Pressable
                                    key={p.port}
                                    onPress={() => handlePortPress(p)}
                                    style={({ pressed }) => [
                                        styles.chip,
                                        {
                                            backgroundColor: p.isCommonDevPort
                                                ? theme.colors.textLink + "18"
                                                : theme.colors.surfaceHighest,
                                            borderColor: p.isCommonDevPort
                                                ? theme.colors.textLink + "40"
                                                : theme.colors.divider,
                                            opacity: pressed ? 0.6 : 1,
                                        },
                                    ]}
                                >
                                    <Ionicons
                                        name={p.process.startsWith("docker:") ? "cube-outline" : "globe-outline"}
                                        size={14}
                                        color={theme.colors.textLink}
                                    />
                                    <Text style={[styles.chipPort, { color: theme.colors.textLink }]}>
                                        {p.port}
                                    </Text>
                                    <Text style={styles.chipProcess} numberOfLines={1}>
                                        {p.process}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                    )}
                </View>
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme, rt) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    innerContainer: {
        flex: 1,
        width: "100%",
        maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
        alignSelf: "center",
    },
    modeSwitchRow: {
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 4,
    },
    previewArea: {
        flex: 1,
        margin: 8,
        borderRadius: 10,
        overflow: "hidden",
        backgroundColor: theme.colors.surfaceHighest,
    },
    screenshotContent: {
        paddingHorizontal: 16,
        paddingBottom: 20,
    },
    topBar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 16,
    },
    topUrlInput: {
        flex: 1,
        fontSize: 14,
        paddingHorizontal: 12,
        paddingVertical: Platform.select({ ios: 8, default: 8 }),
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHighest,
    },
    topButton: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    captureButtonText: {
        color: "#fff",
        fontSize: 14,
        fontWeight: "600",
    },
    screenshotSection: {
        marginBottom: 20,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: theme.colors.surfaceHighest,
    },
    tabBar: {
        flexDirection: "row",
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    tab: {
        flex: 1,
        alignItems: "center",
        paddingVertical: 10,
        borderBottomWidth: 2,
        borderBottomColor: "transparent",
    },
    tabText: {
        fontSize: 14,
        fontWeight: "600",
    },
    baselineBar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 12,
    },
    baselineText: {
        fontSize: 14,
        fontWeight: "500",
    },
    actionButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 10,
    },
    portsSection: {
        paddingHorizontal: 16,
        paddingBottom: 20,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: "600",
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginTop: 12,
        marginBottom: 10,
    },
    chipContainer: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    chip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
    },
    chipPort: {
        fontSize: 15,
        fontWeight: "700",
        fontVariant: ["tabular-nums"],
    },
    chipProcess: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        maxWidth: 120,
    },
    emptyPortsText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
}));
