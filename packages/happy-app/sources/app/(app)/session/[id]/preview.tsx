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
    Linking,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import { usePreview, type DetectedPort } from "@/hooks/usePreview";
import { useRemotePreview } from "@/hooks/useRemotePreview";
import { usePreviewTunnel } from "@/hooks/usePreviewTunnel";
import { useHiddenProcesses } from "@/hooks/useHiddenProcesses";
import { useSession } from "@/sync/storage";
import { screenLayoutMaxWidth } from "@/components/layout";
import { SharedStateView } from "@/components/SharedStateView";
import { PreviewModeSwitch } from "@/components/preview/PreviewModeSwitch";
import { PreviewStatusBar } from "@/components/preview/PreviewStatusBar";
import { PreviewCandidateToast } from "@/components/preview/PreviewCandidateToast";
import { PreviewToolbar } from "@/components/preview/PreviewToolbar";
import { LivePreviewView } from "@/components/preview/LivePreviewView";
import { AnnotationPinsOverlay, type AnnotationPin } from "@/components/preview/AnnotationPinsOverlay";
import { AnnotationOverlay } from "@/components/preview/AnnotationOverlay";
import { AnnotationCommentSheet } from "@/components/preview/AnnotationCommentSheet";
import { usePreviewAnnotations, type AnchorRef } from "@/hooks/usePreviewAnnotations";
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
    const tunnel = usePreviewTunnel(sessionId);

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
    const [annotationPayload, setAnnotationPayload] = React.useState<any>(null);
    const [annotationMode, setAnnotationMode] = React.useState(false);
    const [toastDismissed, setToastDismissed] = React.useState(false);
    const [selectedPin, setSelectedPin] = React.useState<AnnotationPin | null>(null);

    // Annotation pins state
    const annotations = usePreviewAnnotations(sessionId);

    // Auto-detect ports on mount for screenshot mode
    React.useEffect(() => {
        if (sessionId && remote.mode === "screenshot") {
            detectScreenshotPorts();
        }
    }, [sessionId, remote.mode, detectScreenshotPorts]);

    // Clear annotations when URL changes (page reload)
    React.useEffect(() => {
        annotations.clear();
    }, [remote.state.url]);

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

    const handleElementAnnotation = React.useCallback((payload: any) => {
        setAnnotationPayload(payload);
    }, []);

    const handleCommentSubmit = React.useCallback(
        (comment: string) => {
            // F9: structured annotation — pack full anchor data into the message
            // as a fenced JSON block so the agent can parse selector/xpath/style
            // alongside the human-readable summary.
            const target = annotationPayload?.target;
            const page = annotationPayload?.page;
            const ancestors = annotationPayload?.ancestors;
            const style = annotationPayload?.style;

            const elementTag = target
                ? `<${target.tag}${target.id ? ` id="${target.id}"` : ""}${target.className ? ` class="${String(target.className).split(" ")[0]}"` : ""}>`
                : "Element";
            const url = page?.url ?? remote.state.url;
            const textSummary = target?.text
                ? `\n**Text**: ${target.text}`
                : "";

            // Compact JSON block: only the fields the agent needs to act on.
            const structured = {
                source: "preview-annotation",
                anchor: {
                    page: page
                        ? { url: page.url, pathname: page.pathname, title: page.title }
                        : undefined,
                    target: target
                        ? {
                              tag: target.tag,
                              id: target.id,
                              className: target.className,
                              role: target.role,
                              text: target.text,
                              selector: target.selector,
                              xpath: target.xpath,
                              rect: target.rect,
                              outerHTMLPreview: target.outerHTMLPreview,
                              attributes: target.attributes,
                          }
                        : undefined,
                    ancestors: Array.isArray(ancestors)
                        ? ancestors.slice(0, 3).map((a: any) => ({
                              tag: a.tag,
                              id: a.id,
                              selector: a.selector,
                          }))
                        : undefined,
                    style,
                },
                comment,
            };

            const message =
                `[Visual Annotation]\n` +
                `**Element**: ${elementTag}\n` +
                `**URL**: ${url}${textSummary}\n` +
                `**Comment**: ${comment}\n\n` +
                "```json visual-annotation\n" +
                JSON.stringify(structured, null, 2) +
                "\n```";

            sync.sendMessage(sessionId, message);

            // Add pin to overlay if target has selector
            if (target?.selector) {
                annotations.addPin(comment, {
                    selector: target.selector,
                    xpath: target.xpath,
                });
            }

            setAnnotationPayload(null);
        },
        [sessionId, annotationPayload, remote.state.url, annotations],
    );

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
                        <PreviewCandidateToast
                            candidate={tunnel.candidate}
                            onView={() => {
                                setToastDismissed(true);
                            }}
                            onDismiss={() => {
                                setToastDismissed(true);
                            }}
                        />

                        <PreviewStatusBar
                            candidate={tunnel.candidate}
                            connection={tunnel.connection}
                            creating={tunnel.creating}
                            onCreate={tunnel.createTunnel}
                            onRevoke={tunnel.revokeTunnel}
                            onRefreshLease={tunnel.refreshLease}
                        />

                        <PreviewToolbar
                            url={remote.displayUrl}
                            viewport={remote.state.viewport}
                            zoom={remote.state.zoom}
                            onUrlChange={remote.setUrl}
                            onUrlSubmit={() => setReloadKey((k) => k + 1)}
                            onRefresh={handleRefresh}
                            onViewportChange={remote.setViewport}
                            onZoomIn={remote.zoomIn}
                            onZoomOut={remote.zoomOut}
                            onAnnotate={handleAnnotate}
                            orientation={remote.state.orientation}
                            handMode={remote.state.handMode}
                            onToggleOrientation={remote.toggleOrientation}
                            onToggleHandMode={remote.setHandMode}
                            annotationModeActive={annotationMode}
                            onToggleAnnotationMode={() => setAnnotationMode((v) => !v)}
                            onOpenExternal={() => {
                                const urlToOpen = tunnel.connection?.publicUrl ?? remote.state.url;
                                Linking.openURL(urlToOpen);
                            }}
                        />

                        {/* U7: visual hint when annotation mode is active */}
                        {annotationMode && (
                            <View
                                style={[
                                    styles.annotationHintBar,
                                    { backgroundColor: theme.colors.textLink + "18" },
                                ]}
                            >
                                <Ionicons
                                    name="locate-outline"
                                    size={14}
                                    color={theme.colors.textLink}
                                />
                                <Text
                                    style={{
                                        flex: 1,
                                        fontSize: 12,
                                        fontWeight: "500",
                                        color: theme.colors.textLink,
                                    }}
                                >
                                    {t("preview.annotateModeActive")}
                                </Text>
                            </View>
                        )}

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
                                    url={tunnel.connection?.publicUrl || remote.state.url}
                                    viewport={remote.state.viewport}
                                    zoom={remote.state.zoom}
                                    onLoad={remote.onWebViewLoad}
                                    onError={remote.onWebViewError}
                                    reloadKey={reloadKey}
                                    onAnnotation={handleElementAnnotation}
                                    annotationMode={annotationMode}
                                    orientation={remote.state.orientation}
                                    handMode={remote.state.handMode}
                                    panOffset={remote.state.panOffset}
                                    onPanChange={remote.setPanOffset}
                                    onAnchorUpdate={annotations.applyAnchorUpdates}
                                    tracksToSend={annotations.getPendingTracks()}
                                />
                                <AnnotationPinsOverlay
                                    pins={annotations.pins}
                                    viewportWidth={remote.state.viewport.width}
                                    viewportHeight={remote.state.viewport.height}
                                    scale={remote.state.zoom / 100}
                                    panOffset={remote.state.panOffset}
                                    onPinPress={setSelectedPin}
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

                {/* ── Annotation Comment Sheet ─────────────────────────── */}
                {annotationPayload && (
                    <AnnotationCommentSheet
                        annotation={annotationPayload}
                        onSubmit={handleCommentSubmit}
                        onDismiss={() => setAnnotationPayload(null)}
                    />
                )}

                {/* ── Pin Comment Modal ──────────────────────────────────── */}
                {selectedPin && (
                    <Pressable
                        style={styles.modalBackdrop}
                        onPress={() => setSelectedPin(null)}
                    >
                        <Pressable
                            style={[styles.pinCommentModal, { backgroundColor: theme.colors.surface }]}
                            onPress={() => {}}
                        >
                            <View style={styles.pinCommentHeader}>
                                <View
                                    style={[
                                        styles.pinBadge,
                                        { backgroundColor: selectedPin.lost ? theme.colors.textDestructive : theme.colors.textLink },
                                    ]}
                                >
                                    <Text style={styles.pinBadgeText}>{selectedPin.index}</Text>
                                </View>
                                <Pressable onPress={() => setSelectedPin(null)} style={styles.closeButton}>
                                    <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
                                </Pressable>
                            </View>
                            <Text style={[styles.pinCommentText, { color: theme.colors.text }]}>
                                {selectedPin.comment}
                            </Text>
                            {selectedPin.lost && (
                                <Text style={[styles.pinLostWarning, { color: theme.colors.textDestructive }]}>
                                    Element not found on current page
                                </Text>
                            )}
                        </Pressable>
                    </Pressable>
                )}
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
    annotationHintBar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginHorizontal: 8,
        marginTop: 4,
        borderRadius: 6,
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
    modalBackdrop: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 200,
    },
    pinCommentModal: {
        maxWidth: 300,
        borderRadius: 12,
        padding: 16,
        gap: 12,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 8,
    },
    pinCommentHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    pinBadge: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: "center",
        alignItems: "center",
    },
    pinBadgeText: {
        color: "#fff",
        fontSize: 14,
        fontWeight: "700",
    },
    closeButton: {
        padding: 4,
    },
    pinCommentText: {
        fontSize: 14,
        lineHeight: 20,
    },
    pinLostWarning: {
        fontSize: 12,
        fontStyle: "italic",
        marginTop: 4,
    },
}));
