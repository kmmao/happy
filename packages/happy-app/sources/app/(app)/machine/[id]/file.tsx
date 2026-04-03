import * as React from "react";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { SimpleSyntaxHighlighter } from "@/components/SimpleSyntaxHighlighter";
import { DiffView } from "@/components/diff/DiffView";
import { layout } from "@/components/layout";
import { Typography } from "@/constants/Typography";
import { Modal } from "@/modal";
import { machineBash } from "@/sync/ops";
import { t } from "@/text";
import { base64ToUtf8 } from "@/utils/stringUtils";

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function detectLanguage(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md":
      return "markdown";
    case "js":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "py":
      return "python";
    case "json":
      return "json";
    case "sh":
      return "bash";
    case "yml":
    case "yaml":
      return "yaml";
    default:
      return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchState(content: string, query: string, matchCursor: number): {
  matches: number;
  activeMatch: number;
  focusedExcerpt: string;
  activeLine: number | null;
} {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return { matches: 0, activeMatch: 0, focusedExcerpt: content, activeLine: null };
  }

  const lines = content.split("\n");
  const matchingLines = lines.reduce<number[]>((acc, line, index) => {
    if (line.toLowerCase().includes(normalized)) {
      acc.push(index);
    }
    return acc;
  }, []);

  if (matchingLines.length === 0) {
    return { matches: 0, activeMatch: 0, focusedExcerpt: "", activeLine: null };
  }

  const activeMatch = ((matchCursor % matchingLines.length) + matchingLines.length) % matchingLines.length;
  const activeLine = matchingLines[activeMatch];
  const start = Math.max(0, activeLine - 8);
  const end = Math.min(lines.length - 1, activeLine + 8);
  const excerpt: string[] = [];

  if (start > 0) {
    excerpt.push("…");
  }
  for (let index = start; index <= end; index += 1) {
    const prefix = index === activeLine ? ">" : " ";
    excerpt.push(`${prefix} ${index + 1}: ${lines[index]}`);
  }
  if (end < lines.length - 1) {
    excerpt.push("…");
  }

  return {
    matches: matchingLines.length,
    activeMatch,
    focusedExcerpt: excerpt.join("\n"),
    activeLine,
  };
}

function HighlightedTextBlock(props: {
  content: string;
  query: string;
  activeLine?: number | null;
}) {
  const { theme } = useUnistyles();
  const normalized = props.query.trim();
  const matcher = normalized ? new RegExp(`(${escapeRegExp(normalized)})`, "ig") : null;
  const lines = React.useMemo(() => props.content.split("\n"), [props.content]);

  return (
    <View>
      {lines.map((line, index) => {
        const isActive = line.startsWith("> ");
        const lineContent = isActive ? line.slice(2) : line;
        const parts = matcher ? lineContent.split(matcher) : [lineContent];
        return (
          <View
            key={`${index}-${line.slice(0, 16)}`}
            style={[
              styles.highlightLine,
              isActive
                ? { backgroundColor: theme.colors.surfaceHigh, borderLeftColor: theme.colors.primary, borderLeftWidth: 3 }
                : null,
            ]}
          >
            <Text style={[styles.plainText, { color: theme.colors.text }]}> 
              {parts.map((part, partIndex) => {
                const isMatch = matcher ? part.toLowerCase() === normalized.toLowerCase() : false;
                return (
                  <Text
                    key={`${index}-${partIndex}`}
                    style={isMatch ? { backgroundColor: theme.colors.warning, color: "#000" } : undefined}
                  >
                    {part}
                  </Text>
                );
              })}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function MachineFileViewerScreen() {
  const { theme } = useUnistyles();
  const {
    id: machineIdParam,
    path: encodedPath,
    title: encodedTitle,
  } = useLocalSearchParams<{ id: string; path?: string; title?: string }>();

  const machineId = typeof machineIdParam === "string" ? machineIdParam : undefined;
  const filePath = typeof encodedPath === "string" ? base64ToUtf8(encodedPath) : "";
  const title =
    typeof encodedTitle === "string"
      ? base64ToUtf8(encodedTitle)
      : filePath.split("/").pop() || t("common.fileViewer");

  const [content, setContent] = React.useState("");
  const [truncated, setTruncated] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [matchCursor, setMatchCursor] = React.useState(0);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = React.useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = React.useState<number | null>(null);
  const [searchMode, setSearchMode] = React.useState<"focused" | "full">("focused");
  const [displayMode, setDisplayMode] = React.useState<"content" | "diff">("content");
  const [markdownMode, setMarkdownMode] = React.useState<"preview" | "source">("preview");
  const [previousContent, setPreviousContent] = React.useState<string | null>(null);
  const [lastRefreshChanged, setLastRefreshChanged] = React.useState<boolean | null>(null);

  const loadFile = React.useCallback(async () => {
    if (!machineId || !filePath) {
      setError(t("common.error"));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const quotedPath = shellEscape(filePath);
      const result = await machineBash(
        machineId,
        `FILE=${quotedPath}; if [ ! -f "$FILE" ]; then echo "File not found: $FILE" >&2; exit 1; fi; TOTAL=$(wc -l < "$FILE" | tr -d ' '); sed -n '1,2000p' "$FILE"; if [ "$TOTAL" -gt 2000 ]; then echo ""; echo "[truncated after 2000 lines from $TOTAL total lines]"; fi`,
        "/",
        20_000,
      );
      if (!result.success) {
        throw new Error(result.stderr || result.error || "Failed to read file");
      }
      const output = result.stdout ?? "";
      setContent((current) => {
        if (current && current !== output) {
          setPreviousContent(current);
          setLastRefreshChanged(true);
          setDisplayMode("diff");
          return output;
        }
        if (current === output) {
          setLastRefreshChanged(false);
        } else if (!current) {
          setLastRefreshChanged(null);
        }
        return output;
      });
      setTruncated(output.includes("[truncated after 2000 lines"));
      setLastRefreshedAt(Date.now());
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [filePath, machineId]);

  React.useEffect(() => {
    void loadFile();
  }, [loadFile]);

  React.useEffect(() => {
    if (!autoRefreshEnabled) {
      return;
    }
    const interval = setInterval(() => {
      void loadFile();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefreshEnabled, loadFile]);

  React.useEffect(() => {
    setMatchCursor(0);
  }, [query]);

  const language = detectLanguage(filePath);
  const isMarkdown = language === "markdown";
  const searchState = React.useMemo(
    () => buildSearchState(content, query, matchCursor),
    [content, matchCursor, query],
  );
  const displayContent = query.trim()
    ? searchMode === "focused"
      ? searchState.focusedExcerpt
      : content
    : content;
  const showDiffMode = displayMode === "diff" && previousContent != null;

  const copyContent = React.useCallback(async () => {
    if (!content) {
      Modal.toast(t("markdown.copyFailed"));
      return;
    }
    await Clipboard.setStringAsync(content);
    Modal.toast(
      t("items.copiedToClipboard", { label: t("machine.fileViewerCopyContent") }),
    );
  }, [content]);

  const copyPath = React.useCallback(async () => {
    await Clipboard.setStringAsync(filePath);
    Modal.toast(
      t("items.copiedToClipboard", { label: t("machine.fileViewerCopyPath") }),
    );
  }, [filePath]);

  const openOnMachine = React.useCallback(async () => {
    if (!machineId || !filePath) {
      return;
    }
    try {
      const quotedPath = shellEscape(filePath);
      const result = await machineBash(
        machineId,
        `FILE=${quotedPath}; if command -v open >/dev/null 2>&1; then open -R "$FILE" || open "$(dirname "$FILE")"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$(dirname "$FILE")"; else echo "No GUI opener available" >&2; exit 1; fi`,
        "/",
        15_000,
      );
      if (!result.success) {
        throw new Error(result.stderr || result.error || "Failed to open path");
      }
      Modal.toast(t("machine.fileViewerOpenedOnMachine"));
    } catch (error) {
      Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
    }
  }, [filePath, machineId]);

  const jumpToPreviousMatch = React.useCallback(() => {
    setMatchCursor((current) => current - 1);
  }, []);

  const jumpToNextMatch = React.useCallback(() => {
    setMatchCursor((current) => current + 1);
  }, []);

  const clearPreviousSnapshot = React.useCallback(() => {
    setPreviousContent(null);
    setLastRefreshChanged(null);
    setDisplayMode("content");
    Modal.toast(t("machine.fileViewerSnapshotCleared"));
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <Stack.Screen options={{ title }} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.textSecondary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={{ color: theme.colors.textSecondary }}>{error}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.toolbar}>
            <Pressable
              style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}
              onPress={() => void copyContent()}
            >
              <Text style={{ color: theme.colors.text }}>{t("machine.fileViewerCopyContent")}</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}
              onPress={() => void copyPath()}
            >
              <Text style={{ color: theme.colors.text }}>{t("machine.fileViewerCopyPath")}</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}
              onPress={() => void openOnMachine()}
            >
              <Text style={{ color: theme.colors.text }}>{t("machine.fileViewerOpenOnMachine")}</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}
              onPress={() => void loadFile()}
            >
              <Text style={{ color: theme.colors.text }}>{t("machine.fileViewerRefresh")}</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: autoRefreshEnabled ? theme.colors.primary : theme.colors.surfaceHigh }]}
              onPress={() => setAutoRefreshEnabled((value) => !value)}
            >
              <Text style={{ color: autoRefreshEnabled ? theme.colors.button.primary.tint : theme.colors.text }}>
                {autoRefreshEnabled ? t("machine.fileViewerAutoRefreshOn") : t("machine.fileViewerAutoRefreshOff")}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: displayMode === "content" ? theme.colors.primary : theme.colors.surfaceHigh }]}
              onPress={() => setDisplayMode("content")}
            >
              <Text style={{ color: displayMode === "content" ? theme.colors.button.primary.tint : theme.colors.text }}>
                {t("machine.fileViewerContentMode")}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: displayMode === "diff" ? theme.colors.primary : theme.colors.surfaceHigh, opacity: previousContent ? 1 : 0.5 }]}
              onPress={() => previousContent && setDisplayMode("diff")}
              disabled={!previousContent}
            >
              <Text style={{ color: displayMode === "diff" ? theme.colors.button.primary.tint : theme.colors.text }}>
                {t("machine.fileViewerDiffMode")}
              </Text>
            </Pressable>
            {previousContent ? (
              <Pressable
                style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}
                onPress={clearPreviousSnapshot}
              >
                <Text style={{ color: theme.colors.text }}>
                  {t("machine.fileViewerClearSnapshot")}
                </Text>
              </Pressable>
            ) : null}
            {isMarkdown && displayMode === "content" && (
              <>
                <Pressable
                  style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: markdownMode === "preview" ? theme.colors.primary : theme.colors.surfaceHigh }]}
                  onPress={() => setMarkdownMode("preview")}
                >
                  <Text style={{ color: markdownMode === "preview" ? theme.colors.button.primary.tint : theme.colors.text }}>
                    {t("machine.fileViewerPreview")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: markdownMode === "source" ? theme.colors.primary : theme.colors.surfaceHigh }]}
                  onPress={() => setMarkdownMode("source")}
                >
                  <Text style={{ color: markdownMode === "source" ? theme.colors.button.primary.tint : theme.colors.text }}>
                    {t("machine.fileViewerSource")}
                  </Text>
                </Pressable>
              </>
            )}
          </View>

          <Text style={[styles.pathText, { color: theme.colors.textSecondary }]}>{filePath}</Text>

          <TextInput
            style={[styles.searchInput, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
            placeholder={t("machine.fileViewerSearchPlaceholder")}
            placeholderTextColor={theme.colors.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {lastRefreshedAt ? (
            <Text style={[styles.note, { color: theme.colors.textSecondary }]}> 
              {t("machine.fileViewerLastRefreshed")}: {new Date(lastRefreshedAt).toLocaleTimeString()}
            </Text>
          ) : null}

          {lastRefreshChanged != null ? (
            <Text style={[styles.note, { color: lastRefreshChanged ? theme.colors.success : theme.colors.textSecondary }]}>
              {lastRefreshChanged ? t("machine.fileViewerChangedSinceRefresh") : t("machine.fileViewerNoChangeSinceRefresh")}
            </Text>
          ) : null}

          {query.trim() ? (
            <>
              <View style={styles.toolbar}>
                <Pressable
                  style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: searchMode === "focused" ? theme.colors.primary : theme.colors.surfaceHigh }]}
                  onPress={() => setSearchMode("focused")}
                >
                  <Text style={{ color: searchMode === "focused" ? theme.colors.button.primary.tint : theme.colors.text }}>
                    {t("machine.fileViewerSearchModeFocused")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: searchMode === "full" ? theme.colors.primary : theme.colors.surfaceHigh }]}
                  onPress={() => setSearchMode("full")}
                >
                  <Text style={{ color: searchMode === "full" ? theme.colors.button.primary.tint : theme.colors.text }}>
                    {t("machine.fileViewerSearchModeFull")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh, opacity: searchState.matches > 0 ? 1 : 0.5 }]}
                  onPress={jumpToPreviousMatch}
                  disabled={searchState.matches === 0}
                >
                  <Text style={{ color: theme.colors.text }}>{t("machine.fileViewerPreviousMatch")}</Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh, opacity: searchState.matches > 0 ? 1 : 0.5 }]}
                  onPress={jumpToNextMatch}
                  disabled={searchState.matches === 0}
                >
                  <Text style={{ color: theme.colors.text }}>{t("machine.fileViewerNextMatch")}</Text>
                </Pressable>
              </View>
              <Text style={[styles.note, { color: theme.colors.textSecondary }]}> 
                {searchState.matches > 0
                  ? t("machine.fileViewerMatchPosition", { index: searchState.activeMatch + 1, count: searchState.matches })
                  : t("machine.fileViewerNoMatches")}
              </Text>
            </>
          ) : truncated ? (
            <Text style={[styles.note, { color: theme.colors.textSecondary }]}>{t("machine.fileViewerTruncated")}</Text>
          ) : null}

          {showDiffMode ? (
            <DiffView
              oldText={previousContent ?? ""}
              newText={content}
              language={language}
              viewMode="unified"
              expandedContext={true}
              showDiffStats={true}
              oldTitle={t("machine.fileViewerPreviousVersion")}
              newTitle={t("machine.fileViewerCurrentVersion")}
            />
          ) : query.trim() ? (
            <HighlightedTextBlock content={displayContent} query={query} activeLine={searchState.activeLine} />
          ) : isMarkdown && markdownMode === "preview" ? (
            <MarkdownView markdown={displayContent} />
          ) : (
            language ? (
              <SimpleSyntaxHighlighter code={displayContent} language={language} selectable={true} />
            ) : (
              <Text style={[styles.plainText, { color: theme.colors.text }]}>{displayContent}</Text>
            )
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    maxWidth: layout.maxWidth,
    alignSelf: "center",
    width: "100%",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  toolbar: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  secondaryButton: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  pathText: {
    marginBottom: 12,
    fontSize: 12,
  },
  searchInput: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  note: {
    marginBottom: 12,
    fontSize: 13,
  },
  highlightLine: {
    paddingVertical: 1,
    paddingHorizontal: 6,
  },
  plainText: {
    ...Typography.mono(),
    fontSize: 14,
    lineHeight: Platform.OS === "ios" ? 20 : 21,
  },
}));
