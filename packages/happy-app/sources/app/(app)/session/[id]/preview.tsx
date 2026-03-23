/**
 * Frontend preview page for a session.
 *
 * Layer 1: Detects dev server ports, captures screenshots via agent-browser.
 * Layer 2: Baseline management + before/after diff comparison.
 *
 * Route: /session/{id}/preview
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
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import { usePreview, type DetectedPort } from "@/hooks/usePreview";
import { useHiddenProcesses } from "@/hooks/useHiddenProcesses";
import { useSession } from "@/sync/storage";
import { layout } from "@/components/layout";

type DiffTab = "before" | "after" | "diff";

export default React.memo(function PreviewPage() {
  const { id: sessionId, url: initialUrl } = useLocalSearchParams<{
    id: string;
    url?: string;
  }>();
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
  const [customUrl, setCustomUrl] = React.useState(initialUrl ?? "");
  const [diffTab, setDiffTab] = React.useState<DiffTab>("after");
  const autoCapturedRef = React.useRef(false);

  // Auto-detect ports on mount
  React.useEffect(() => {
    if (sessionId) {
      detectPorts();
    }
  }, [sessionId, detectPorts]);

  // Auto-capture when URL param is provided and ports are detected
  React.useEffect(() => {
    if (
      initialUrl &&
      !autoCapturedRef.current &&
      (state.status === "ports-detected" || state.status === "captured" || state.status === "error")
    ) {
      autoCapturedRef.current = true;
      captureScreenshot(initialUrl);
    }
  }, [initialUrl, state.status, captureScreenshot]);

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
    const phaseKey = state.status === "detecting-ports" && state.phase
      ? `preview.phase.${state.phase}` as const
      : null;
    const portsFound = state.status === "detecting-ports" ? state.portsFound ?? 0 : 0;
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.text} />
        <Text style={styles.statusText}>{t("preview.detectingPorts")}</Text>
        {phaseKey && (
          <Text style={styles.phaseText}>
            {t(phaseKey)}
            {portsFound > 0 ? ` · ${t("preview.portsFoundCount", { count: portsFound })}` : ""}
          </Text>
        )}
      </View>
    );
  }

  // Tool unavailable
  if (state.status === "unavailable") {
    return (
      <View style={styles.centered}>
        <Ionicons
          name="cube-outline"
          size={48}
          color={theme.colors.textSecondary}
        />
        <Text style={[styles.statusText, { fontWeight: "600", fontSize: 17 }]}>
          {t("preview.unavailableTitle")}
        </Text>
        <Text
          style={[
            styles.urlText,
            { textAlign: "center", paddingHorizontal: 32 },
          ]}
        >
          {t("preview.unavailableHint")}
        </Text>
      </View>
    );
  }

  if (state.status === "capturing") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.text} />
        <Text style={styles.statusText}>{t("preview.capturing")}</Text>
        <Text style={styles.urlText}>{state.url}</Text>
      </View>
    );
  }

  if (state.status === "comparing") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.text} />
        <Text style={styles.statusText}>{t("preview.comparing")}</Text>
        <Text style={styles.urlText}>{state.url}</Text>
      </View>
    );
  }

  const ports = "ports" in state ? state.ports : [];
  const webPorts = filterProcesses(ports.filter((p) => p.isWeb));

  // Determine which diff image to show
  const getDiffImageUri = (): string | null => {
    if (state.status !== "compared") return null;
    switch (diffTab) {
      case "before":
        return state.diff.baseline.uri;
      case "after":
        return state.diff.current.uri;
      case "diff":
        return state.diff.diffUri;
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.innerContainer}>
        {/* Custom URL input + Refresh — always at top */}
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
            onPress={detectPorts}
            style={({ pressed }) => [
              styles.topButton,
              {
                backgroundColor: theme.colors.surfaceHighest,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons
              name="refresh-outline"
              size={16}
              color={theme.colors.text}
            />
          </Pressable>
        </View>

        {/* Empty state hint — only when no screenshot/comparison yet */}
        {state.status === "ports-detected" && (
          <View style={styles.emptyHint}>
            <Ionicons
              name="camera-outline"
              size={36}
              color={theme.colors.textSecondary}
            />
            <Text style={styles.emptyHintText}>{t("preview.emptyHint")}</Text>
          </View>
        )}

        {/* Diff comparison result (Layer 2) */}
        {state.status === "compared" && (
          <View style={styles.screenshotSection}>
            {/* Tab bar: Before / After / Diff */}
            <View style={styles.tabBar}>
              {(["before", "after", "diff"] as const).map((tab) => (
                <Pressable
                  key={tab}
                  onPress={() => setDiffTab(tab)}
                  style={[
                    styles.tab,
                    diffTab === tab && {
                      borderBottomColor: theme.colors.textLink,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      {
                        color:
                          diffTab === tab
                            ? theme.colors.textLink
                            : theme.colors.textSecondary,
                      },
                    ]}
                  >
                    {t(`preview.${tab}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Image
              source={{ uri: getDiffImageUri() ?? "" }}
              style={{ width: "100%", aspectRatio: 16 / 10, minHeight: 200 }}
              contentFit="contain"
              transition={150}
            />
            <Text style={styles.screenshotLabel}>
              {t("preview.screenshotAt", {
                url: state.diff.current.url,
              })}
            </Text>
          </View>
        )}

        {/* Single screenshot result (Layer 1) */}
        {state.status === "captured" && (
          <View style={styles.screenshotSection}>
            <Image
              source={{ uri: state.screenshot.uri }}
              style={{ width: "100%", aspectRatio: 16 / 10, minHeight: 200 }}
              contentFit="contain"
              transition={200}
            />
            <Text style={styles.screenshotLabel}>
              {t("preview.screenshotAt", {
                url: state.screenshot.url,
              })}
            </Text>
          </View>
        )}

        {/* Error state */}
        {state.status === "error" && (
          <View style={styles.errorSection}>
            <Ionicons
              name="warning-outline"
              size={32}
              color={theme.colors.textDestructive}
            />
            <Text style={styles.errorText}>
              {t("preview.screenshotFailed")}
            </Text>
            <Text style={styles.errorDetail}>{state.message}</Text>
          </View>
        )}

        {/* Baseline indicator + actions (Layer 2) */}
        {baseline ? (
          <View style={styles.baselineBar}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={theme.colors.success}
            />
            <Text style={[styles.baselineText, { color: theme.colors.text }]}>
              {t("preview.baselineSet")}
            </Text>
            <Pressable
              onPress={clearBaseline}
              style={({ pressed }) => [
                styles.baselineClearButton,
                { opacity: pressed ? 0.5 : 1 },
              ]}
            >
              <Text
                style={{
                  color: theme.colors.textDestructive,
                  fontSize: 13,
                }}
              >
                {t("preview.clearBaseline")}
              </Text>
            </Pressable>
          </View>
        ) : state.status === "captured" ? (
          <View style={styles.baselineBar}>
            <Pressable
              onPress={setBaseline}
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: theme.colors.button.primary.background,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="bookmark-outline" size={16} color="#fff" />
              <Text style={styles.captureButtonText}>
                {t("preview.setBaseline")}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Web services — chip/tag layout */}
        <Text style={styles.sectionTitle}>{t("preview.devServers")}</Text>
        {webPorts.length === 0 ? (
          <View style={styles.emptyPortsRow}>
            <Text style={styles.emptyPortsText}>{t("preview.noPorts")}</Text>
          </View>
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
                  name={
                    p.process.startsWith("docker:")
                      ? "cube-outline"
                      : "globe-outline"
                  }
                  size={14}
                  color={theme.colors.textLink}
                />
                <Text
                  style={[
                    styles.chipPort,
                    { color: theme.colors.textLink },
                  ]}
                >
                  {p.port}
                </Text>
                <Text style={styles.chipProcess} numberOfLines={1}>
                  {p.process}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Non-web ports are hidden — only web services are relevant for preview */}
      </View>
    </ScrollView>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  contentContainer: {
    paddingBottom: 40,
  },
  innerContainer: {
    width: "100%",
    maxWidth: layout.maxWidth,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  centered: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  statusText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
  },
  phaseText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    opacity: 0.7,
  },
  urlText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    opacity: 0.7,
  },
  screenshotSection: {
    marginBottom: 20,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
  },
  screenshotLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
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
  errorSection: {
    alignItems: "center",
    padding: 20,
    marginBottom: 20,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceHighest,
    gap: 8,
  },
  errorText: {
    fontSize: 15,
    color: theme.colors.textDestructive,
    fontWeight: "600",
  },
  errorDetail: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
  baselineBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    marginBottom: 8,
  },
  baselineText: {
    fontSize: 14,
    fontWeight: "500",
  },
  baselineClearButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
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
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyHint: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 8,
  },
  emptyHintText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  chipContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
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
  emptyPortsRow: {
    paddingVertical: 12,
    marginBottom: 16,
  },
  emptyPortsText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
}));
