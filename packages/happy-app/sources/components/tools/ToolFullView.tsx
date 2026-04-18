import * as React from "react";
import {
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { ToolCall, Message } from "@/sync/typesMessage";
import { CodeView } from "../CodeView";
import { Metadata } from "@/sync/storageTypes";
import { getToolFullViewComponent } from "./views/_all";
import { layout } from "../layout";
import { useLocalSetting, useLocalSettingMutable } from "@/sync/storage";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import { buildToolFullViewTheme } from "@/components/tools/toolChromeTheme";
import { ToolSimpleContent } from "./ToolSimpleContent";
import { getToolProvider } from "@/components/tools/toolProvider";

interface ToolFullViewProps {
  tool: ToolCall;
  metadata?: Metadata | null;
  messages?: Message[];
}

export const ToolFullView = React.memo(function ToolFullView({
  tool,
  metadata,
  messages = [],
}: ToolFullViewProps) {
  // Check if there's a specialized content view for this tool
  const SpecializedFullView = getToolFullViewComponent(tool.name);
  const screenWidth = useWindowDimensions().width;
  const devModeEnabled = useLocalSetting("devModeEnabled") || __DEV__;
  const [toolDetailMode, setToolDetailMode] =
    useLocalSettingMutable("toolDetailMode");
  const scrollViewRef = React.useRef<ScrollView>(null);
  const { theme } = useUnistyles();
  const toolProvider = getToolProvider({
    toolName: tool.name,
    metadata,
  });
  const fullViewTheme = buildToolFullViewTheme(toolProvider, theme);

  // For tools with specialized full views (Bash, Edit, MultiEdit),
  // always use the specialized view — they are already intuitive.
  const hasSpecializedView = !!SpecializedFullView;

  // Only show mode switcher for tools without specialized views
  const showModeSwitcher = !hasSpecializedView;
  const isSimpleMode = showModeSwitcher && toolDetailMode === "simple";

  return (
    <ScrollView
      ref={scrollViewRef}
      style={[
        styles.container,
        { backgroundColor: fullViewTheme.background },
        { paddingHorizontal: screenWidth > 700 ? 16 : 0 },
      ]}
    >
      <View style={styles.contentWrapper}>
        {/* Mode Switcher */}
        {showModeSwitcher && (
          <View style={styles.modeSwitcherContainer}>
            <View
              style={[
                styles.segmentContainer,
                {
                  backgroundColor: fullViewTheme.modeTrackBackground,
                },
              ]}
            >
              <Pressable
                onPress={() => setToolDetailMode("simple")}
                style={[
                  styles.segment,
                  toolDetailMode === "simple" && {
                    backgroundColor: fullViewTheme.modeActiveBackground,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    {
                      color:
                        toolDetailMode === "simple"
                          ? fullViewTheme.modeActiveText
                          : fullViewTheme.modeInactiveText,
                    },
                  ]}
                >
                  {t("tools.fullView.simpleMode")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setToolDetailMode("developer")}
                style={[
                  styles.segment,
                  toolDetailMode === "developer" && {
                    backgroundColor: fullViewTheme.modeActiveBackground,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    {
                      color:
                        toolDetailMode === "developer"
                          ? fullViewTheme.modeActiveText
                          : fullViewTheme.modeInactiveText,
                    },
                  ]}
                >
                  {t("tools.fullView.developerMode")}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Tool-specific content or generic fallback */}
        {hasSpecializedView ? (
          <SpecializedFullView
            tool={tool}
            metadata={metadata || null}
            messages={messages}
            scrollViewRef={scrollViewRef}
          />
        ) : isSimpleMode ? (
          <ToolSimpleContent
            tool={tool}
            metadata={metadata || null}
            provider={toolProvider}
          />
        ) : (
          <>
            {/* Generic fallback for tools without specialized views */}
            {/* Tool Description */}
            {tool.description && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons
                    name="information-circle"
                    size={20}
                    color={fullViewTheme.infoIconColor}
                  />
                  <Text
                    style={[
                      styles.sectionTitle,
                      { color: fullViewTheme.sectionTitleColor },
                    ]}
                  >
                    {t("tools.fullView.description")}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.description,
                    { color: fullViewTheme.descriptionColor },
                  ]}
                >
                  {tool.description}
                </Text>
              </View>
            )}
            {/* Input Parameters */}
            {tool.input && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons
                    name="log-in"
                    size={20}
                    color={fullViewTheme.inputIconColor}
                  />
                  <Text
                    style={[
                      styles.sectionTitle,
                      { color: fullViewTheme.sectionTitleColor },
                    ]}
                  >
                    {t("tools.fullView.inputParams")}
                  </Text>
                </View>
                <CodeView code={JSON.stringify(tool.input, null, 2)} />
              </View>
            )}

            {/* Result/Output */}
            {tool.state === "completed" && tool.result && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons
                    name="log-out"
                    size={20}
                    color={fullViewTheme.outputIconColor}
                  />
                  <Text
                    style={[
                      styles.sectionTitle,
                      { color: fullViewTheme.sectionTitleColor },
                    ]}
                  >
                    {t("tools.fullView.output")}
                  </Text>
                </View>
                <CodeView
                  code={
                    typeof tool.result === "string"
                      ? tool.result
                      : JSON.stringify(tool.result, null, 2)
                  }
                />
              </View>
            )}

            {/* Error Details */}
            {tool.state === "error" && tool.result && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={fullViewTheme.errorIconColor}
                  />
                  <Text
                    style={[
                      styles.sectionTitle,
                      { color: fullViewTheme.sectionTitleColor },
                    ]}
                  >
                    {t("tools.fullView.error")}
                  </Text>
                </View>
                <View
                  style={[
                    styles.errorContainer,
                    {
                      backgroundColor: fullViewTheme.errorBackground,
                      borderColor: fullViewTheme.errorBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.errorText,
                      { color: fullViewTheme.errorText },
                    ]}
                  >
                    {String(tool.result)}
                  </Text>
                </View>
              </View>
            )}

            {/* No Output Message */}
            {tool.state === "completed" && !tool.result && (
              <View style={styles.section}>
                <View style={styles.emptyOutputContainer}>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={48}
                    color={fullViewTheme.emptyIconColor}
                  />
                  <Text
                    style={[
                      styles.emptyOutputText,
                      { color: fullViewTheme.sectionTitleColor },
                    ]}
                  >
                    {t("tools.fullView.completed")}
                  </Text>
                  <Text
                    style={[
                      styles.emptyOutputSubtext,
                      { color: fullViewTheme.descriptionColor },
                    ]}
                  >
                    {t("tools.fullView.noOutput")}
                  </Text>
                </View>
              </View>
            )}
          </>
        )}

        {/* Raw JSON View (Dev Mode Only) */}
        {devModeEnabled && (
          <RawJsonSection
            tool={tool}
            messages={messages}
            fullViewTheme={fullViewTheme}
          />
        )}
      </View>
    </ScrollView>
  );
});

interface RawJsonSectionProps {
  tool: ToolCall;
  messages: Message[];
  fullViewTheme: ReturnType<typeof buildToolFullViewTheme>;
}

const RawJsonSection = React.memo(function RawJsonSection({
  tool,
  messages,
  fullViewTheme,
}: RawJsonSectionProps) {
  const [copied, setCopied] = React.useState(false);

  const jsonString = React.useMemo(
    () =>
      JSON.stringify(
        {
          name: tool.name,
          state: tool.state,
          description: tool.description,
          input: tool.input,
          result: tool.result,
          createdAt: tool.createdAt,
          startedAt: tool.startedAt,
          completedAt: tool.completedAt,
          permission: tool.permission,
          messages,
        },
        null,
        2,
      ),
    [tool, messages],
  );

  const handleCopy = React.useCallback(async () => {
    try {
      await Clipboard.setStringAsync(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can fail on unsupported web contexts; surface nothing
    }
  }, [jsonString]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons
          name="code-slash"
          size={20}
          color={fullViewTheme.rawIconColor}
        />
        <Text
          style={[
            styles.sectionTitle,
            { color: fullViewTheme.sectionTitleColor },
          ]}
        >
          {t("tools.fullView.rawJsonDevMode")}
        </Text>
        <Pressable
          onPress={handleCopy}
          disabled={copied}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={copied ? t("common.copied") : t("common.copy")}
          style={({ pressed }) => [
            styles.copyButton,
            {
              backgroundColor: fullViewTheme.copyButtonBackground,
              borderColor: copied
                ? fullViewTheme.copiedColor
                : fullViewTheme.copyButtonBorder,
            },
            pressed && !copied && styles.copyButtonPressed,
          ]}
        >
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={14}
            color={copied ? fullViewTheme.copiedColor : fullViewTheme.rawIconColor}
          />
          <Text
            style={[
              styles.copyButtonText,
              {
                color: copied
                  ? fullViewTheme.copiedColor
                  : fullViewTheme.copyButtonText,
              },
            ]}
          >
            {copied ? t("common.copied") : t("common.copy")}
          </Text>
        </Pressable>
      </View>
      <CodeView code={jsonString} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    paddingTop: 12,
  },
  contentWrapper: {
    maxWidth: layout.maxWidth,
    alignSelf: "center",
    width: "100%",
  },
  modeSwitcherContainer: {
    alignItems: "center",
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  segmentContainer: {
    flexDirection: "row",
    borderRadius: 8,
    padding: 3,
  },
  segment: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "600",
  },
  section: {
    marginBottom: 28,
    paddingHorizontal: 4,
  },
  sectionFullWidth: {
    marginBottom: 28,
    paddingHorizontal: 0,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  copyButton: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  copyButtonPressed: {
    opacity: 0.7,
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
  toolId: {
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    color: theme.colors.textSecondary,
  },
  errorContainer: {
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
  },
  emptyOutputContainer: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyOutputText: {
    fontSize: 16,
    fontWeight: "600",
  },
  emptyOutputSubtext: {
    fontSize: 14,
  },
}));

// Export styles for use in specialized views
export const toolFullViewStyles = styles;
