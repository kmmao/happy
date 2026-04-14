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
import { sessionReadFile, sessionBash } from "@/sync/ops";
import { storage } from "@/sync/storage";
import { Modal } from "@/modal";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { FileIcon } from "@/components/FileIcon";
import { base64ToUtf8 } from "@/utils/stringUtils";
import { log } from '@/log';

interface FileContent {
  content: string;
  encoding: "utf8" | "base64";
  isBinary: boolean;
}

function FileScreen() {
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

  const [fileContent, setFileContent] = React.useState<FileContent | null>(
    null,
  );
  const [markdownMode, setMarkdownMode] = React.useState<"preview" | "source">("preview");
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Determine file language from extension
  const getFileLanguage = React.useCallback((path: string): string | null => {
    const ext = path.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "js":
      case "jsx":
        return "javascript";
      case "ts":
      case "tsx":
        return "typescript";
      case "py":
        return "python";
      case "html":
      case "htm":
        return "html";
      case "css":
        return "css";
      case "json":
        return "json";
      case "md":
        return "markdown";
      case "xml":
        return "xml";
      case "yaml":
      case "yml":
        return "yaml";
      case "sh":
      case "bash":
        return "bash";
      case "sql":
        return "sql";
      case "go":
        return "go";
      case "rust":
      case "rs":
        return "rust";
      case "java":
        return "java";
      case "c":
        return "c";
      case "cpp":
      case "cc":
      case "cxx":
        return "cpp";
      case "php":
        return "php";
      case "rb":
        return "ruby";
      case "swift":
        return "swift";
      case "kt":
        return "kotlin";
      default:
        return null;
    }
  }, []);

  // Check if file is likely binary based on extension
  const isBinaryFile = React.useCallback((path: string): boolean => {
    const ext = path.split(".").pop()?.toLowerCase();
    const binaryExtensions = [
      "png", "jpg", "jpeg", "gif", "bmp", "svg", "ico",
      "mp4", "avi", "mov", "wmv", "flv", "webm",
      "mp3", "wav", "flac", "aac", "ogg",
      "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
      "zip", "tar", "gz", "rar", "7z",
      "exe", "dmg", "deb", "rpm",
      "woff", "woff2", "ttf", "otf",
      "db", "sqlite", "sqlite3",
    ];
    return ext ? binaryExtensions.includes(ext) : false;
  }, []);

  // Load file content
  React.useEffect(() => {
    let isCancelled = false;

    const loadFile = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Get session metadata for git commands
        const session = storage.getState().sessions[sessionId!];
        const sessionPath = session?.metadata?.path;

        // Check if file is likely binary before trying to read
        if (isBinaryFile(filePath)) {
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

        // When viewing a historical commit, read the file at that commit
        // Otherwise, read the current working tree version
        if (commitHash && sessionPath && sessionId) {
          try {
            const showResponse = await sessionBash(sessionId, {
              command: `git show ${commitHash}:"${filePath}"`,
              cwd: sessionPath,
              timeout: 10000,
            });

            if (!isCancelled) {
              if (showResponse.success) {
                const content = showResponse.stdout ?? "";
                const hasNullBytes = content.includes("\0");
                const isBinary = hasNullBytes;

                setFileContent({
                  content: isBinary ? "" : content,
                  encoding: "utf8",
                  isBinary,
                });
              } else {
                setError(
                  showResponse.stderr || "Failed to read file at commit",
                );
              }
            }
          } catch (showError) {
            log.error("Failed to read file at commit:", showError);
            if (!isCancelled) {
              setError("Failed to read file at commit");
            }
          }
        } else {
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
  }, [sessionId, filePath, commitHash, isBinaryFile]);

  // Show error modal if there's an error
  React.useEffect(() => {
    if (error) {
      Modal.alert(t("common.error"), error);
    }
  }, [error]);

  const fileName = filePath.split("/").pop() || filePath;
  const language = getFileLanguage(filePath);
  const isMarkdown = language === "markdown";

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

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    maxWidth: layout.maxWidth,
    alignSelf: "center",
    width: "100%",
  },
}));

export default React.memo(FileScreen);
