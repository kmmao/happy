import * as React from "react";
import {
  View,
  ScrollView,
  ActivityIndicator,
  Platform,
  Pressable,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Text } from "@/components/StyledText";
import { SimpleSyntaxHighlighter } from "@/components/SimpleSyntaxHighlighter";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { Typography } from "@/constants/Typography";
import { sessionReadFile } from "@/sync/ops";
import { storage } from "@/sync/storage";
import { Modal } from "@/modal";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { useLayout, screenLayoutMaxWidth } from "@/components/layout";
import { t } from "@/text";
import { FileIcon } from "@/components/FileIcon";
import { Octicons } from "@expo/vector-icons";
import { base64ToUtf8 } from "@/utils/stringUtils";
import { log } from '@/log';
import { CommitDiffView } from "@/components/git/CommitDiffView";
import { getLanguageForPath } from "@/components/diff/fileLanguage";
import { isBinaryFilePath } from "@/components/diff/binaryFiles";

interface FileContent {
  content: string;
  encoding: "utf8" | "base64";
  isBinary: boolean;
}

function FileScreen() {
    const layout = useLayout();
  const { theme } = useUnistyles();
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const searchParams = useLocalSearchParams();
  const encodedPath = searchParams.path as string;
  const commitHash = searchParams.commit as string | undefined;
  let filePath = "";

  // Decode base64 path with error handling (UTF-8 safe, with legacy atob fallback)
  try {
    filePath = encodedPath ? base64ToUtf8(encodedPath) : "";
  } catch {
    // Fallback to plain atob for legacy paths encoded before UTF-8 migration
    try {
      filePath = encodedPath ? atob(encodedPath) : "";
    } catch {
      filePath = encodedPath || "";
    }
  }

  // Commit-scoped view delegates to CommitDiffView — it handles git show,
  // binary detection, and diff rendering. Hooks below still run unconditionally
  // for the non-commit branch; CommitDiffView is rendered after they settle.
  const isCommitView = !!(commitHash && sessionId);

  const [fileContent, setFileContent] = React.useState<FileContent | null>(
    null,
  );
  const [markdownMode, setMarkdownMode] = React.useState<"preview" | "source">("preview");
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // Increment to force re-reading the file without remounting (preserves
  // markdownMode toggle across refreshes).
  const [reloadKey, setReloadKey] = React.useState(0);

  const handleRefresh = React.useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  // Load file content
  React.useEffect(() => {
    // Commit-scoped view is rendered by CommitDiffView (see early return
    // below), so skip the working-tree load entirely in that mode.
    if (isCommitView) {
      setIsLoading(false);
      return;
    }
    let isCancelled = false;

    const loadFile = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Check if file is likely binary before trying to read
        if (isBinaryFilePath(filePath)) {
          if (!isCancelled) {
            setFileContent({
              content: "",
              encoding: "base64",
              isBinary: true,
            });
            setIsLoading(false);
          }
          return;
        }

        {
          const response = await sessionReadFile(sessionId, filePath);

          if (!isCancelled) {
            if (response.success && response.content !== undefined) {
              // Decode base64 content to raw bytes
              let binaryString: string;
              try {
                binaryString = atob(response.content);
              } catch {
                setFileContent({
                  content: "",
                  encoding: "base64",
                  isBinary: true,
                });
                return;
              }

              // Handle empty files
              const len = binaryString.length;
              if (len === 0) {
                setFileContent({
                  content: "",
                  encoding: "utf8",
                  isBinary: false,
                });
                return;
              }

              // Check for binary data using a loop (avoids split/filter allocation)
              let nonPrintableCount = 0;
              let hasNullBytes = false;
              for (let i = 0; i < len; i++) {
                const code = binaryString.charCodeAt(i);
                if (code === 0) {
                  hasNullBytes = true;
                  break;
                }
                if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
                  nonPrintableCount++;
                }
              }

              let isBinary = hasNullBytes || nonPrintableCount / len > 0.1;
              let textContent = "";
              let encoding: "utf8" | "base64" = isBinary ? "base64" : "utf8";

              if (!isBinary) {
                try {
                  const bytes = new Uint8Array(len);
                  for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  if (typeof TextDecoder !== "undefined") {
                    textContent = new TextDecoder("utf-8", {
                      fatal: true,
                    }).decode(bytes);
                  } else {
                    const encoded = new Array(len);
                    for (let i = 0; i < len; i++) {
                      encoded[i] = "%" + bytes[i].toString(16).padStart(2, "0");
                    }
                    textContent = decodeURIComponent(encoded.join(""));
                  }
                } catch {
                  // Invalid UTF-8: treat as binary
                  isBinary = true;
                  encoding = "base64";
                  textContent = "";
                }
              }

              setFileContent({
                content: textContent,
                encoding,
                isBinary,
              });
            } else {
              setError(response.error || "Failed to read file");
            }
          }
        }
      } catch (error) {
        log.error("Failed to load file:", error);
        if (!isCancelled) {
          setError("Failed to load file");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    loadFile();

    return () => {
      isCancelled = true;
    };
  }, [sessionId, filePath, commitHash, isCommitView, reloadKey]);

  // Show error modal if there's an error
  React.useEffect(() => {
    if (error) {
      Modal.alert(t("common.error"), error);
    }
  }, [error]);

  const fileName = filePath.split("/").pop() || filePath;
  const language = getLanguageForPath(filePath);
  const isMarkdown = language === "markdown";

  // Commit-scoped view: defer entirely to CommitDiffView so the diff renders
  // with proper line wrapping and shares logic with SidePanelGitPanel.
  if (isCommitView) {
    const session = storage.getState().sessions[sessionId!];
    const sessionPath = session?.metadata?.path ?? "";
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
        <CommitDiffView
          sessionId={sessionId!}
          sessionPath={sessionPath}
          fullPath={filePath}
          commitHash={commitHash!}
        />
      </View>
    );
  }

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.surface,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        <Text
          style={{
            marginTop: 16,
            fontSize: 16,
            color: theme.colors.textSecondary,
            ...Typography.default(),
          }}
        >
          {t("files.loadingFile", { fileName })}
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.surface,
          justifyContent: "center",
          alignItems: "center",
          padding: 20,
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: "bold",
            color: theme.colors.textDestructive,
            marginBottom: 8,
            ...Typography.default("semiBold"),
          }}
        >
          {t("common.error")}
        </Text>
        <Text
          style={{
            fontSize: 16,
            color: theme.colors.textSecondary,
            textAlign: "center",
            ...Typography.default(),
          }}
        >
          {error}
        </Text>
      </View>
    );
  }

  if (fileContent?.isBinary) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.surface,
          justifyContent: "center",
          alignItems: "center",
          padding: 20,
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: "bold",
            color: theme.colors.textSecondary,
            marginBottom: 8,
            ...Typography.default("semiBold"),
          }}
        >
          {t("files.binaryFile")}
        </Text>
        <Text
          style={{
            fontSize: 16,
            color: theme.colors.textSecondary,
            textAlign: "center",
            ...Typography.default(),
          }}
        >
          {t("files.cannotDisplayBinary")}
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: "#999",
            textAlign: "center",
            marginTop: 8,
            ...Typography.default(),
          }}
        >
          {fileName}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      {/* File path header */}
      <View
        style={{
          padding: 16,
          borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
          borderBottomColor: theme.colors.divider,
          backgroundColor: theme.colors.surfaceHigh,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <FileIcon fileName={fileName} size={20} />
        <Text
          style={{
            fontSize: 14,
            color: theme.colors.textSecondary,
            marginLeft: 8,
            flex: 1,
            ...Typography.mono(),
          }}
        >
          {filePath}
        </Text>
        <Pressable
          onPress={handleRefresh}
          disabled={isLoading}
          hitSlop={8}
          accessibilityLabel={t("files.refresh")}
          style={({ pressed }) => ({
            padding: 6,
            marginLeft: 8,
            opacity: isLoading ? 0.4 : pressed ? 0.5 : 1,
          })}
        >
          <Octicons
            name="sync"
            size={18}
            color={theme.colors.textLink}
          />
        </Pressable>
      </View>

      {/* Markdown preview/source toggle */}
      {isMarkdown && (
        <View
          style={{
            flexDirection: "row",
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
            borderBottomColor: theme.colors.divider,
            backgroundColor: theme.colors.surface,
          }}
        >
          <Pressable
            onPress={() => setMarkdownMode("preview")}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor:
                markdownMode === "preview"
                  ? theme.colors.textLink
                  : theme.colors.input.background,
              marginRight: 8,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color:
                  markdownMode === "preview" ? "white" : theme.colors.textSecondary,
                ...Typography.default(),
              }}
            >
              {t("files.preview")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMarkdownMode("source")}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor:
                markdownMode === "source"
                  ? theme.colors.textLink
                  : theme.colors.input.background,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color:
                  markdownMode === "source" ? "white" : theme.colors.textSecondary,
                ...Typography.default(),
              }}
            >
              {t("files.source")}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Content display */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, maxWidth: layout.maxWidth, alignSelf: "center" as const, width: "100%" as const }}
        showsVerticalScrollIndicator={true}
      >
        {fileContent?.content ? (
          isMarkdown && markdownMode === "preview" ? (
            <MarkdownView markdown={fileContent.content} />
          ) : (
            <SimpleSyntaxHighlighter
              code={fileContent.content}
              language={language}
              selectable={true}
            />
          )
        ) : (
          <Text
            style={{
              fontSize: 16,
              color: theme.colors.textSecondary,
              fontStyle: "italic",
              ...Typography.default(),
            }}
          >
            {t("files.fileEmpty")}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((_theme, rt) => ({
  container: {
    flex: 1,
    maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
    alignSelf: "center",
    width: "100%",
  },
}));

export default React.memo(FileScreen);
