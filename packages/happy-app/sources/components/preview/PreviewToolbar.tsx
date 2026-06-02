/**
 * Toolbar for the live preview: URL bar, device viewport presets, zoom controls.
 */

import * as React from "react";
import { View, TextInput, Pressable, Platform } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import {
    VIEWPORT_PRESETS,
    type ViewportPreset,
} from "@/hooks/useRemotePreview";

interface PreviewToolbarProps {
    url: string;
    viewport: ViewportPreset;
    zoom: number;
    onUrlChange: (url: string) => void;
    onUrlSubmit: () => void;
    onRefresh: () => void;
    onViewportChange: (preset: ViewportPreset) => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onAnnotate?: () => void;
    /** U6: annotation mode toggle button */
    annotationModeActive?: boolean;
    onToggleAnnotationMode?: () => void;
    /** U8: open preview in external browser tab (web only) */
    onOpenExternal?: () => void;
    /** U9: rotate viewport (portrait/landscape) */
    orientation?: "portrait" | "landscape";
    onToggleOrientation?: () => void;
    /** Hand-pan mode (drag to pan when zoomed) */
    handMode?: boolean;
    onToggleHandMode?: (active: boolean) => void;
    compact?: boolean;
}

export const PreviewToolbar = React.memo<PreviewToolbarProps>(
    function PreviewToolbar({
        url,
        viewport,
        zoom,
        onUrlChange,
        onUrlSubmit,
        onRefresh,
        onViewportChange,
        onZoomIn,
        onZoomOut,
        onAnnotate,
        annotationModeActive = false,
        onToggleAnnotationMode,
        onOpenExternal,
        orientation = "portrait",
        onToggleOrientation,
        handMode = false,
        onToggleHandMode,
        compact = false,
    }) {
        const { theme } = useUnistyles();

        return (
            <View style={styles.container}>
                {/* URL bar */}
                <View style={styles.urlRow}>
                    <TextInput
                        style={[
                            styles.urlInput,
                            {
                                color: theme.colors.text,
                                backgroundColor: theme.colors.surfaceHighest,
                            },
                        ]}
                        placeholder="http://localhost:5173"
                        placeholderTextColor={theme.colors.textSecondary}
                        value={url}
                        onChangeText={onUrlChange}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        returnKeyType="go"
                        onSubmitEditing={onUrlSubmit}
                    />
                    <ToolbarButton
                        icon="refresh-outline"
                        onPress={onRefresh}
                        compact={compact}
                    />
                </View>

                {/* Controls row: viewport presets + zoom + annotate */}
                <View style={styles.controlsRow}>
                    {/* Viewport presets */}
                    <View style={styles.viewportGroup}>
                        {VIEWPORT_PRESETS.map((preset) => (
                            <Pressable
                                key={preset.key}
                                onPress={() => onViewportChange(preset)}
                                style={({ pressed }) => [
                                    styles.viewportButton,
                                    {
                                        backgroundColor:
                                            viewport.key === preset.key
                                                ? theme.colors.textLink + "20"
                                                : "transparent",
                                        opacity: pressed ? 0.6 : 1,
                                    },
                                ]}
                            >
                                <Ionicons
                                    name={preset.icon}
                                    size={compact ? 14 : 16}
                                    color={
                                        viewport.key === preset.key
                                            ? theme.colors.textLink
                                            : theme.colors.textSecondary
                                    }
                                />
                            </Pressable>
                        ))}
                    </View>

                    {/* U9: rotate viewport — disabled on desktop */}
                    {onToggleOrientation && (
                        <ToolbarButton
                            icon={
                                orientation === "portrait"
                                    ? "phone-portrait-outline"
                                    : "phone-landscape-outline"
                            }
                            onPress={onToggleOrientation}
                            compact={compact}
                            disabled={viewport.key === "desktop"}
                        />
                    )}

                    {/* Hand-pan mode */}
                    {onToggleHandMode && (
                        <ToolbarButton
                            icon={handMode ? "hand-left" : "hand-left-outline"}
                            onPress={() => onToggleHandMode(!handMode)}
                            compact={compact}
                            accent={handMode}
                        />
                    )}

                    {/* Resolution label */}
                    {!compact && (
                        <Text style={[styles.resolutionText, { color: theme.colors.textSecondary }]}>
                            {viewport.width} x {viewport.height}
                        </Text>
                    )}

                    {/* Spacer */}
                    <View style={{ flex: 1 }} />

                    {/* Zoom controls */}
                    <View style={styles.zoomGroup}>
                        <ToolbarButton
                            icon="remove-outline"
                            onPress={onZoomOut}
                            compact={compact}
                        />
                        <Text style={[styles.zoomText, { color: theme.colors.text }]}>
                            {zoom}%
                        </Text>
                        <ToolbarButton
                            icon="add-outline"
                            onPress={onZoomIn}
                            compact={compact}
                        />
                    </View>

                    {/* U6: annotation mode toggle (element pick) */}
                    {onToggleAnnotationMode && (
                        <ToolbarButton
                            icon={annotationModeActive ? "locate" : "locate-outline"}
                            onPress={onToggleAnnotationMode}
                            compact={compact}
                            accent={annotationModeActive}
                        />
                    )}

                    {/* U8: external open (web only) */}
                    {onOpenExternal && (
                        <ToolbarButton
                            icon="open-outline"
                            onPress={onOpenExternal}
                            compact={compact}
                        />
                    )}

                    {/* Legacy screenshot-mode annotate */}
                    {onAnnotate && (
                        <ToolbarButton
                            icon="pencil-outline"
                            onPress={onAnnotate}
                            compact={compact}
                            accent
                        />
                    )}
                </View>
            </View>
        );
    },
);

// ── Small icon button ────────────────────────────────────────────────────────

function ToolbarButton({
    icon,
    onPress,
    compact = false,
    accent = false,
    disabled = false,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    compact?: boolean;
    accent?: boolean;
    disabled?: boolean;
}) {
    const { theme } = useUnistyles();

    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            style={({ pressed }) => [
                styles.iconButton,
                compact && styles.iconButtonCompact,
                {
                    backgroundColor: accent
                        ? theme.colors.textLink + "20"
                        : theme.colors.surfaceHighest,
                    opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
                },
            ]}
        >
            <Ionicons
                name={icon}
                size={compact ? 14 : 16}
                color={accent ? theme.colors.textLink : theme.colors.text}
            />
        </Pressable>
    );
}

const styles = StyleSheet.create((_theme) => ({
    container: {
        gap: 8,
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
    urlRow: {
        flexDirection: "row",
        gap: 6,
        alignItems: "center",
    },
    urlInput: {
        flex: 1,
        fontSize: 13,
        paddingHorizontal: 10,
        paddingVertical: Platform.select({ ios: 7, default: 7 }),
        borderRadius: 8,
        ...Typography.mono(),
    },
    controlsRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    viewportGroup: {
        flexDirection: "row",
        gap: 2,
    },
    viewportButton: {
        padding: 6,
        borderRadius: 6,
    },
    resolutionText: {
        fontSize: 11,
        ...Typography.mono(),
    },
    zoomGroup: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
    },
    zoomText: {
        fontSize: 12,
        fontWeight: "600",
        minWidth: 36,
        textAlign: "center",
        ...Typography.mono(),
    },
    iconButton: {
        padding: 7,
        borderRadius: 8,
    },
    iconButtonCompact: {
        padding: 5,
        borderRadius: 6,
    },
}));
