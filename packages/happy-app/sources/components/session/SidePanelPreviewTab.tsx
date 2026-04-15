/**
 * Side panel tab for frontend preview (dev server screenshots).
 * Adapted from the preview.tsx page to accept sessionId as a prop.
 */

import * as React from "react";
import {
    View,
    ScrollView,
    Pressable,
    ActivityIndicator,
    TextInput,
    Platform,
} from "react-native";
import { Image } from "expo-image";
import { useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import { usePreview, type DetectedPort } from "@/hooks/usePreview";
import { useHiddenProcesses } from "@/hooks/useHiddenProcesses";
import { useSession } from "@/sync/storage";
import { Typography } from "@/constants/Typography";

type DiffTab = "before" | "after" | "diff";

interface SidePanelPreviewTabProps {
    sessionId: string;
}

export const SidePanelPreviewTab = React.memo<SidePanelPreviewTabProps>(
    function SidePanelPreviewTab({ sessionId }) {
        const {
            state,
            baseline,
            detectPorts,
            captureScreenshot,
            setBaseline,
            clearBaseline,
            compareWithBaseline,
        } = usePreview(sessionId);
        const session = useSession(sessionId);
        const machineId = session?.metadata?.machineId;
        const { filterProcesses } = useHiddenProcesses(machineId);
        const { theme } = useUnistyles();
        const [customUrl, setCustomUrl] = React.useState("");
        const [diffTab, setDiffTab] = React.useState<DiffTab>("after");

        // Auto-detect ports on mount
        React.useEffect(() => {
            if (sessionId) {
                detectPorts();
            }
        }, [sessionId, detectPorts]);

        const handlePortPress = React.useCallback(
            (port: DetectedPort) => {
                if (baseline) {
                    compareWithBaseline(`http://localhost:${port.port}`);
                } else {
                    captureScreenshot(`http://localhost:${port.port}`);
                }
            },
            [baseline, captureScreenshot, compareWithBaseline],
        );

        const handleCustomCapture = React.useCallback(() => {
            const url = customUrl.trim();
            if (url.length === 0) return;
            if (baseline) {
                compareWithBaseline(url);
            } else {
                captureScreenshot(url);
            }
        }, [customUrl, baseline, captureScreenshot, compareWithBaseline]);

        // Loading states
        if (state.status === "idle" || state.status === "detecting-ports") {
            return (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
                    <ActivityIndicator size="small" color={theme.colors.text} />
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                        {t("preview.detectingPorts")}
                    </Text>
                </View>
            );
        }

        if (state.status === "unavailable") {
            return (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 20 }}>
                    <Ionicons name="cube-outline" size={40} color={theme.colors.textSecondary} />
                    <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.textSecondary }}>
                        {t("preview.unavailableTitle")}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, textAlign: "center" }}>
                        {t("preview.unavailableHint")}
                    </Text>
                </View>
            );
        }

        if (state.status === "capturing" || state.status === "comparing") {
            return (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <ActivityIndicator size="small" color={theme.colors.text} />
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                        {state.status === "capturing" ? t("preview.capturing") : t("preview.comparing")}
                    </Text>
                </View>
            );
        }

        const ports = "ports" in state ? state.ports : [];
        const webPorts = filterProcesses(ports.filter((p) => p.isWeb));

        const getDiffImageUri = (): string | null => {
            if (state.status !== "compared") return null;
            switch (diffTab) {
                case "before": return state.diff.baseline.uri;
                case "after": return state.diff.current.uri;
                case "diff": return state.diff.diffUri;
            }
        };

        return (
            <ScrollView
                style={{ flex: 1, backgroundColor: theme.colors.surface }}
                contentContainerStyle={{ padding: 10, paddingBottom: 40 }}
            >
                {/* URL input + capture */}
                <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
                    <TextInput
                        style={{
                            flex: 1,
                            fontSize: 12,
                            paddingHorizontal: 10,
                            paddingVertical: Platform.select({ ios: 7, default: 7 }),
                            borderRadius: 8,
                            backgroundColor: theme.colors.surfaceHighest,
                            color: theme.colors.text,
                            ...Typography.mono(),
                        }}
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
                        style={({ pressed }) => ({
                            paddingHorizontal: 10,
                            paddingVertical: 7,
                            borderRadius: 8,
                            backgroundColor: theme.colors.button.primary.background,
                            opacity: pressed ? 0.7 : 1,
                        })}
                    >
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>
                            {baseline ? t("preview.compare") : t("preview.capture")}
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={detectPorts}
                        style={({ pressed }) => ({
                            paddingHorizontal: 8,
                            paddingVertical: 7,
                            borderRadius: 8,
                            backgroundColor: theme.colors.surfaceHighest,
                            opacity: pressed ? 0.7 : 1,
                        })}
                    >
                        <Ionicons name="refresh-outline" size={14} color={theme.colors.text} />
                    </Pressable>
                </View>

                {/* Empty state */}
                {state.status === "ports-detected" && (
                    <View style={{ alignItems: "center", paddingVertical: 20, gap: 6 }}>
                        <Ionicons name="camera-outline" size={32} color={theme.colors.textSecondary} />
                        <Text style={{ fontSize: 12, color: theme.colors.textSecondary, textAlign: "center" }}>
                            {t("preview.emptyHint")}
                        </Text>
                    </View>
                )}

                {/* Diff comparison */}
                {state.status === "compared" && (
                    <View style={{ marginBottom: 12, borderRadius: 10, overflow: "hidden", backgroundColor: theme.colors.surfaceHighest }}>
                        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
                            {(["before", "after", "diff"] as const).map((tab) => (
                                <Pressable
                                    key={tab}
                                    onPress={() => setDiffTab(tab)}
                                    style={{
                                        flex: 1,
                                        alignItems: "center",
                                        paddingVertical: 8,
                                        borderBottomWidth: 2,
                                        borderBottomColor: diffTab === tab ? theme.colors.textLink : "transparent",
                                    }}
                                >
                                    <Text style={{ fontSize: 12, fontWeight: "600", color: diffTab === tab ? theme.colors.textLink : theme.colors.textSecondary }}>
                                        {t(`preview.${tab}`)}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                        <Image
                            source={{ uri: getDiffImageUri() ?? "" }}
                            style={{ width: "100%", aspectRatio: 16 / 10, minHeight: 150 }}
                            contentFit="contain"
                            transition={150}
                        />
                    </View>
                )}

                {/* Single screenshot */}
                {state.status === "captured" && (
                    <View style={{ marginBottom: 12, borderRadius: 10, overflow: "hidden", backgroundColor: theme.colors.surfaceHighest }}>
                        <Image
                            source={{ uri: state.screenshot.uri }}
                            style={{ width: "100%", aspectRatio: 16 / 10, minHeight: 150 }}
                            contentFit="contain"
                            transition={200}
                        />
                    </View>
                )}

                {/* Error */}
                {state.status === "error" && (
                    <View style={{ alignItems: "center", padding: 16, marginBottom: 12, borderRadius: 10, backgroundColor: theme.colors.surfaceHighest, gap: 6 }}>
                        <Ionicons name="warning-outline" size={24} color={theme.colors.textDestructive} />
                        <Text style={{ fontSize: 13, color: theme.colors.textDestructive, fontWeight: "600" }}>
                            {t("preview.screenshotFailed")}
                        </Text>
                        <Text style={{ fontSize: 11, color: theme.colors.textSecondary, textAlign: "center" }}>
                            {state.message}
                        </Text>
                    </View>
                )}

                {/* Baseline actions */}
                {baseline ? (
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8 }}>
                        <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                        <Text style={{ fontSize: 12, color: theme.colors.text }}>{t("preview.baselineSet")}</Text>
                        <Pressable onPress={clearBaseline}>
                            <Text style={{ color: theme.colors.textDestructive, fontSize: 12 }}>{t("preview.clearBaseline")}</Text>
                        </Pressable>
                    </View>
                ) : state.status === "captured" ? (
                    <View style={{ alignItems: "center", paddingVertical: 8 }}>
                        <Pressable
                            onPress={setBaseline}
                            style={({ pressed }) => ({
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 4,
                                paddingHorizontal: 14,
                                paddingVertical: 8,
                                borderRadius: 8,
                                backgroundColor: theme.colors.button.primary.background,
                                opacity: pressed ? 0.7 : 1,
                            })}
                        >
                            <Ionicons name="bookmark-outline" size={14} color="#fff" />
                            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>{t("preview.setBaseline")}</Text>
                        </Pressable>
                    </View>
                ) : null}

                {/* Dev servers */}
                <Text style={{ fontSize: 11, fontWeight: "600", color: theme.colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 6 }}>
                    {t("preview.devServers")}
                </Text>
                {webPorts.length === 0 ? (
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, paddingVertical: 8 }}>
                        {t("preview.noPorts")}
                    </Text>
                ) : (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                        {webPorts.map((p) => (
                            <Pressable
                                key={p.port}
                                onPress={() => handlePortPress(p)}
                                style={({ pressed }) => ({
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 4,
                                    paddingHorizontal: 10,
                                    paddingVertical: 6,
                                    borderRadius: 16,
                                    borderWidth: 1,
                                    backgroundColor: p.isCommonDevPort ? theme.colors.textLink + "18" : theme.colors.surfaceHighest,
                                    borderColor: p.isCommonDevPort ? theme.colors.textLink + "40" : theme.colors.divider,
                                    opacity: pressed ? 0.6 : 1,
                                })}
                            >
                                <Ionicons
                                    name={p.process.startsWith("docker:") ? "cube-outline" : "globe-outline"}
                                    size={12}
                                    color={theme.colors.textLink}
                                />
                                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.colors.textLink }}>{p.port}</Text>
                                <Text style={{ fontSize: 11, color: theme.colors.textSecondary, maxWidth: 80 }} numberOfLines={1}>{p.process}</Text>
                            </Pressable>
                        ))}
                    </View>
                )}
            </ScrollView>
        );
    },
);
