/**
 * Core live preview component — renders a remote page via WebView (native) or iframe (web).
 * Supports viewport simulation through container sizing and CSS transform scaling.
 */

import * as React from "react";
import { View, Platform, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import type { ViewportPreset } from "@/hooks/useRemotePreview";

interface LivePreviewViewProps {
    url: string;
    viewport: ViewportPreset;
    zoom: number;
    onLoad?: () => void;
    onError?: (error: string) => void;
    /** Key to force WebView remount (increment to reload) */
    reloadKey?: number;
}

// ── Native WebView implementation ────────────────────────────────────────────

function NativePreview({
    url,
    viewport,
    zoom,
    onLoad,
    onError,
    reloadKey,
}: LivePreviewViewProps) {
    const { theme } = useUnistyles();
    const [loading, setLoading] = React.useState(true);
    const [hasError, setHasError] = React.useState(false);

    // Lazy-import WebView to avoid web bundle issues
    const WebViewComponent = React.useMemo(() => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { WebView } = require("react-native-webview");
            return WebView;
        } catch {
            return null;
        }
    }, []);

    if (!WebViewComponent) {
        return (
            <View style={[styles.errorContainer, { backgroundColor: theme.colors.surfaceHighest }]}>
                <Ionicons name="warning-outline" size={32} color={theme.colors.textDestructive} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
                    WebView not available
                </Text>
            </View>
        );
    }

    const scale = zoom / 100;
    const containerWidth = viewport.width * scale;
    const containerHeight = viewport.height * scale;

    return (
        <View style={[styles.previewContainer, { backgroundColor: theme.colors.surfaceHighest }]}>
            {loading && (
                <View style={styles.loadingOverlay}>
                    <ActivityIndicator size="small" color={theme.colors.text} />
                </View>
            )}
            {hasError && (
                <View style={[styles.errorOverlay, { backgroundColor: theme.colors.surfaceHighest }]}>
                    <Ionicons name="cloud-offline-outline" size={32} color={theme.colors.textDestructive} />
                    <Text style={{ color: theme.colors.textDestructive, fontSize: 13, fontWeight: "600" }}>
                        Failed to load page
                    </Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: "center" }}>
                        Check URL and network connectivity
                    </Text>
                </View>
            )}
            <View
                style={{
                    width: containerWidth,
                    height: containerHeight,
                    overflow: "hidden",
                    alignSelf: "center",
                }}
            >
                <View
                    style={{
                        width: viewport.width,
                        height: viewport.height,
                        transform: [{ scale }],
                        transformOrigin: "top left",
                    }}
                >
                    <WebViewComponent
                        key={reloadKey}
                        source={{ uri: url }}
                        style={{ flex: 1 }}
                        javaScriptEnabled
                        domStorageEnabled
                        startInLoadingState={false}
                        scalesPageToFit={false}
                        allowsFullscreenVideo={false}
                        onLoadEnd={() => {
                            setLoading(false);
                            setHasError(false);
                            onLoad?.();
                        }}
                        onError={(e: any) => {
                            setLoading(false);
                            setHasError(true);
                            onError?.(e.nativeEvent?.description ?? "Load failed");
                        }}
                        onHttpError={(e: any) => {
                            if (e.nativeEvent?.statusCode >= 400) {
                                setHasError(true);
                                onError?.(`HTTP ${e.nativeEvent.statusCode}`);
                            }
                        }}
                    />
                </View>
            </View>
        </View>
    );
}

// ── Web/Tauri iframe implementation ──────────────────────────────────────────

function WebPreview({
    url,
    viewport,
    zoom,
    onLoad,
    onError,
    reloadKey,
}: LivePreviewViewProps) {
    const { theme } = useUnistyles();
    const [loading, setLoading] = React.useState(true);
    const [hasError, setHasError] = React.useState(false);
    const iframeRef = React.useRef<HTMLIFrameElement>(null);

    const scale = zoom / 100;
    const containerWidth = viewport.width * scale;
    const containerHeight = viewport.height * scale;

    React.useEffect(() => {
        setLoading(true);
        setHasError(false);
    }, [url, reloadKey]);

    return (
        <View style={[styles.previewContainer, { backgroundColor: theme.colors.surfaceHighest }]}>
            {loading && (
                <View style={styles.loadingOverlay}>
                    <ActivityIndicator size="small" color={theme.colors.text} />
                </View>
            )}
            {hasError && (
                <View style={[styles.errorOverlay, { backgroundColor: theme.colors.surfaceHighest }]}>
                    <Ionicons name="cloud-offline-outline" size={32} color={theme.colors.textDestructive} />
                    <Text style={{ color: theme.colors.textDestructive, fontSize: 13, fontWeight: "600" }}>
                        Failed to load page
                    </Text>
                </View>
            )}
            <div
                style={{
                    width: containerWidth,
                    height: containerHeight,
                    overflow: "hidden",
                    alignSelf: "center",
                    position: "relative",
                }}
            >
                <iframe
                    ref={iframeRef}
                    key={`${url}-${reloadKey}`}
                    src={url}
                    style={{
                        width: viewport.width,
                        height: viewport.height,
                        border: "none",
                        transformOrigin: "top left",
                        transform: `scale(${scale})`,
                    }}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    onLoad={() => {
                        setLoading(false);
                        setHasError(false);
                        onLoad?.();
                    }}
                    onError={() => {
                        setLoading(false);
                        setHasError(true);
                        onError?.("iframe load failed");
                    }}
                />
            </div>
        </View>
    );
}

// ── Platform router ──────────────────────────────────────────────────────────

export const LivePreviewView = React.memo<LivePreviewViewProps>(
    function LivePreviewView(props) {
        const { theme } = useUnistyles();

        if (!props.url) {
            return (
                <View style={[styles.emptyContainer, { backgroundColor: theme.colors.surfaceHighest }]}>
                    <Ionicons name="globe-outline" size={40} color={theme.colors.textSecondary} />
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>
                        Select a dev server or enter a URL
                    </Text>
                </View>
            );
        }

        return Platform.OS === "web"
            ? <WebPreview {...props} />
            : <NativePreview {...props} />;
    },
);

const styles = StyleSheet.create((_theme) => ({
    previewContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        overflow: "hidden",
        position: "relative",
    },
    emptyContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        minHeight: 200,
        borderRadius: 8,
    },
    loadingOverlay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
    },
    errorContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 200,
        borderRadius: 8,
    },
    errorOverlay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        zIndex: 10,
    },
}));
