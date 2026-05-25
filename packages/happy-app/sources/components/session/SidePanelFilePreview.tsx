import * as React from "react";
import {
    View,
    ScrollView,
    ActivityIndicator,
    Platform,
    Pressable,
} from "react-native";
import { Text } from "@/components/StyledText";
import { SimpleSyntaxHighlighter } from "@/components/SimpleSyntaxHighlighter";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { Typography } from "@/constants/Typography";
import { sessionReadFile, sessionBash } from "@/sync/ops";
import { storage } from "@/sync/storage";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import { FileIcon } from "@/components/FileIcon";
import { Ionicons } from "@expo/vector-icons";
import { log } from "@/log";
import { UnifiedDiffView } from "@/components/diff/UnifiedDiffView";
import { getLanguageForPath } from "@/components/diff/fileLanguage";
import { isBinaryFilePath } from "@/components/diff/binaryFiles";

interface SidePanelFilePreviewProps {
    sessionId: string;
    filePath: string;
    onClose: () => void;
    /** Git repo root for diff — defaults to session path when omitted */
    repoPath?: string;
}

export const SidePanelFilePreview = React.memo<SidePanelFilePreviewProps>(
    function SidePanelFilePreview({ sessionId, filePath, onClose, repoPath }) {
        const { theme } = useUnistyles();
        const [content, setContent] = React.useState<string | null>(null);
        const [diffContent, setDiffContent] = React.useState<string | null>(null);
        const [displayMode, setDisplayMode] = React.useState<"file" | "diff">("file");
        const [markdownMode, setMarkdownMode] = React.useState<"preview" | "source">("preview");
        const [isBinary, setIsBinary] = React.useState(false);
        const [isLoading, setIsLoading] = React.useState(true);
        const [error, setError] = React.useState<string | null>(null);

        const fileName = filePath.split("/").pop() || filePath;
        const language = getLanguageForPath(filePath);
        const isMarkdown = language === "markdown";

        React.useEffect(() => {
            let cancelled = false;

            const load = async () => {
                setIsLoading(true);
                setError(null);
                setContent(null);
                setDiffContent(null);
                setIsBinary(false);

                if (isBinaryFilePath(filePath)) {
                    if (!cancelled) {
                        setIsBinary(true);
                        setIsLoading(false);
                    }
                    return;
                }

                const session = storage.getState().sessions[sessionId];
                const sessionPath = session?.metadata?.path;

                // Fetch diff — use repoPath (submodule root) when provided, else session root
                const diffCwd = repoPath ?? sessionPath;
                if (diffCwd) {
                    try {
                        // Make path relative to the git repo root so git diff works for submodules
                        const relativePath = filePath.startsWith(diffCwd + "/")
                            ? filePath.slice(diffCwd.length + 1)
                            : filePath;
                        const escapedPath = relativePath.replace(/'/g, "'\\''");
                        const diffResp = await sessionBash(sessionId, {
                            command: `git diff --no-ext-diff -- '${escapedPath}'`,
                            cwd: diffCwd,
                            timeout: 5000,
                        });
                        if (!cancelled && diffResp.success && (diffResp.stdout ?? "").trim()) {
                            setDiffContent(diffResp.stdout ?? "");
                            setDisplayMode("diff");
                        }
                    } catch (e) {
                        log.log("Side panel diff error:", e);
                    }
                }

                // Read file
                try {
                    const resp = await sessionReadFile(sessionId, filePath);
                    if (cancelled) return;

                    if (resp.success && resp.content !== undefined) {
                        let binaryString: string;
                        try {
                            binaryString = atob(resp.content);
                        } catch {
                            setIsBinary(true);
                            setIsLoading(false);
                            return;
                        }

                        const len = binaryString.length;
                        if (len === 0) {
                            setContent("");
                            setIsLoading(false);
                            return;
                        }

                        let nonPrintable = 0;
                        let hasNull = false;
                        for (let i = 0; i < len; i++) {
                            const code = binaryString.charCodeAt(i);
                            if (code === 0) { hasNull = true; break; }
                            if (code < 32 && code !== 9 && code !== 10 && code !== 13) nonPrintable++;
                        }

                        if (hasNull || nonPrintable / len > 0.1) {
                            setIsBinary(true);
                        } else {
                            try {
                                const bytes = new Uint8Array(len);
                                for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
                                const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                                setContent(text);
                            } catch {
                                setIsBinary(true);
                            }
                        }
                    } else {
                        setError(resp.error || "Failed to read file");
                    }
                } catch {
                    if (!cancelled) setError("Failed to read file");
                } finally {
                    if (!cancelled) setIsLoading(false);
                }
            };

            load();
            return () => { cancelled = true; };
        }, [sessionId, filePath]);


        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
                {/* Header with file name and close button */}
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                        borderBottomColor: theme.colors.divider,
                        backgroundColor: theme.colors.surfaceHigh,
                        gap: 8,
                    }}
                >
                    <Pressable onPress={onClose} hitSlop={8}>
                        <Ionicons
                            name="arrow-back"
                            size={20}
                            color={theme.colors.textLink}
                        />
                    </Pressable>
                    <FileIcon fileName={fileName} size={18} />
                    <Text
                        style={{
                            flex: 1,
                            fontSize: 13,
                            color: theme.colors.text,
                            fontWeight: "600",
                            ...Typography.mono(),
                        }}
                        numberOfLines={1}
                    >
                        {fileName}
                    </Text>
                </View>

                {/* Mode toggle */}
                {(diffContent || isMarkdown) && !isLoading && !isBinary && (
                    <View
                        style={{
                            flexDirection: "row",
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                            borderBottomColor: theme.colors.divider,
                            gap: 6,
                        }}
                    >
                        {diffContent && (
                            <ModeButton
                                label={t("files.diff")}
                                active={displayMode === "diff"}
                                onPress={() => setDisplayMode("diff")}
                            />
                        )}
                        <ModeButton
                            label={t("files.file")}
                            active={displayMode === "file"}
                            onPress={() => setDisplayMode("file")}
                        />
                        {isMarkdown && displayMode === "file" && (
                            <>
                                <View style={{ width: 1, backgroundColor: theme.colors.divider }} />
                                <ModeButton
                                    label={t("files.preview")}
                                    active={markdownMode === "preview"}
                                    onPress={() => setMarkdownMode("preview")}
                                />
                                <ModeButton
                                    label={t("files.source")}
                                    active={markdownMode === "source"}
                                    onPress={() => setMarkdownMode("source")}
                                />
                            </>
                        )}
                    </View>
                )}

                {/* Content */}
                {isLoading ? (
                    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : error ? (
                    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
                        <Text style={{ fontSize: 14, color: theme.colors.textDestructive, textAlign: "center", ...Typography.default() }}>
                            {error}
                        </Text>
                    </View>
                ) : isBinary ? (
                    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
                        <Text style={{ fontSize: 14, color: theme.colors.textSecondary, textAlign: "center", ...Typography.default() }}>
                            {t("files.binaryFile")}
                        </Text>
                    </View>
                ) : (
                    <ScrollView
                        style={{ flex: 1 }}
                        contentContainerStyle={{ padding: 12 }}
                        showsVerticalScrollIndicator
                    >
                        {displayMode === "diff" && diffContent ? (
                            <UnifiedDiffView diffContent={diffContent} language={language} />
                        ) : content !== null ? (
                            isMarkdown && markdownMode === "preview" ? (
                                <MarkdownView markdown={content} />
                            ) : (
                                <SimpleSyntaxHighlighter
                                    code={content}
                                    language={language}
                                    selectable
                                />
                            )
                        ) : (
                            <Text style={{ fontSize: 14, color: theme.colors.textSecondary, fontStyle: "italic", ...Typography.default() }}>
                                {t("files.fileEmpty")}
                            </Text>
                        )}
                    </ScrollView>
                )}
            </View>
        );
    },
);

// Small toggle button for diff/file/preview/source modes
const ModeButton = React.memo<{
    label: string;
    active: boolean;
    onPress: () => void;
}>(function ModeButton({ label, active, onPress }) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            onPress={onPress}
            style={{
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 6,
                backgroundColor: active ? theme.colors.textLink : theme.colors.input.background,
            }}
        >
            <Text
                style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: active ? "white" : theme.colors.textSecondary,
                    ...Typography.default(),
                }}
            >
                {label}
            </Text>
        </Pressable>
    );
});

