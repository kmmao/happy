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
import { parseUnifiedPatch, type DiffLine, type DiffToken } from "@/components/diff/calculateDiff";
import { tokenizeLine, getSyntaxColor, type SyntaxToken } from "@/components/diff/syntaxTokenizer";

const BINARY_EXTENSIONS = new Set([
    "png", "jpg", "jpeg", "gif", "bmp", "svg", "ico",
    "mp4", "avi", "mov", "wmv", "flv", "webm",
    "mp3", "wav", "flac", "aac", "ogg",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "zip", "tar", "gz", "rar", "7z",
    "exe", "dmg", "deb", "rpm",
    "woff", "woff2", "ttf", "otf",
    "db", "sqlite", "sqlite3",
]);

function getFileLanguage(path: string): string | null {
    const ext = path.split(".").pop()?.toLowerCase();
    const map: Record<string, string> = {
        js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
        py: "python", html: "html", htm: "html", css: "css", json: "json",
        md: "markdown", xml: "xml", yaml: "yaml", yml: "yaml",
        sh: "bash", bash: "bash", sql: "sql", go: "go",
        rs: "rust", java: "java", c: "c", cpp: "cpp", cc: "cpp",
        php: "php", rb: "ruby", swift: "swift", kt: "kotlin",
    };
    return ext ? (map[ext] ?? null) : null;
}

interface SidePanelFilePreviewProps {
    sessionId: string;
    filePath: string;
    onClose: () => void;
}

export const SidePanelFilePreview = React.memo<SidePanelFilePreviewProps>(
    function SidePanelFilePreview({ sessionId, filePath, onClose }) {
        const { theme } = useUnistyles();
        const [content, setContent] = React.useState<string | null>(null);
        const [diffContent, setDiffContent] = React.useState<string | null>(null);
        const [displayMode, setDisplayMode] = React.useState<"file" | "diff">("file");
        const [markdownMode, setMarkdownMode] = React.useState<"preview" | "source">("preview");
        const [isBinary, setIsBinary] = React.useState(false);
        const [isLoading, setIsLoading] = React.useState(true);
        const [error, setError] = React.useState<string | null>(null);

        const fileName = filePath.split("/").pop() || filePath;
        const language = getFileLanguage(filePath);
        const isMarkdown = language === "markdown";
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

        React.useEffect(() => {
            let cancelled = false;

            const load = async () => {
                setIsLoading(true);
                setError(null);
                setContent(null);
                setDiffContent(null);
                setIsBinary(false);

                if (BINARY_EXTENSIONS.has(ext)) {
                    if (!cancelled) {
                        setIsBinary(true);
                        setIsLoading(false);
                    }
                    return;
                }

                const session = storage.getState().sessions[sessionId];
                const sessionPath = session?.metadata?.path;

                // Fetch diff
                if (sessionPath) {
                    try {
                        const escapedPath = filePath.replace(/'/g, "'\\''");
                        const diffResp = await sessionBash(sessionId, {
                            command: `git diff --no-ext-diff -- '${escapedPath}'`,
                            cwd: sessionPath,
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
        }, [sessionId, filePath, ext]);


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
                            <DiffLines diffContent={diffContent} language={language} />
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

// GitHub-style diff renderer with line numbers and inline highlighting
const DiffLines = React.memo<{ diffContent: string; language?: string | null }>(
    function DiffLines({ diffContent, language }) {
        const { theme } = useUnistyles();
        const colors = theme.colors.diff;

        const { hunks, stats } = React.useMemo(
            () => parseUnifiedPatch(diffContent),
            [diffContent],
        );

        // Collapsible hunk state
        const [collapsedHunks, setCollapsedHunks] = React.useState<Set<number>>(new Set());
        const toggleHunk = React.useCallback((hunkIndex: number) => {
            setCollapsedHunks((prev) => {
                const next = new Set(prev);
                if (next.has(hunkIndex)) {
                    next.delete(hunkIndex);
                } else {
                    next.add(hunkIndex);
                }
                return next;
            });
        }, []);

        // Compute max line number width for alignment
        const lineNumWidth = React.useMemo(() => {
            let max = 0;
            for (const hunk of hunks) {
                for (const line of hunk.lines) {
                    if (line.oldLineNumber && line.oldLineNumber > max) max = line.oldLineNumber;
                    if (line.newLineNumber && line.newLineNumber > max) max = line.newLineNumber;
                }
            }
            return String(max).length;
        }, [hunks]);

        // Replace leading spaces with non-breaking spaces (\u00A0) to prevent
        // React Native <Text> from collapsing indentation whitespace
        const preserveIndent = (s: string) =>
            s.replace(/^ +/, (m) => "\u00A0".repeat(m.length));

        const renderInlineContent = (
            content: string,
            baseColor: string,
            tokens?: DiffToken[],
            syntaxTokens?: SyntaxToken[],
        ) => {
            if (tokens && tokens.length > 0) {
                let first = true;
                return tokens.map((token, idx) => {
                    const val = first ? preserveIndent(token.value) : token.value;
                    if (token.value) first = false;
                    if (token.added || token.removed) {
                        return (
                            <Text
                                key={idx}
                                style={{
                                    backgroundColor: token.added
                                        ? colors.inlineAddedBg
                                        : colors.inlineRemovedBg,
                                    color: token.added
                                        ? colors.inlineAddedText
                                        : colors.inlineRemovedText,
                                }}
                            >
                                {val}
                            </Text>
                        );
                    }
                    return (
                        <Text key={idx} style={{ color: baseColor }}>
                            {val}
                        </Text>
                    );
                });
            }

            if (syntaxTokens && syntaxTokens.length > 0) {
                let first = true;
                return syntaxTokens.map((token, idx) => {
                    const val = first ? preserveIndent(token.text) : token.text;
                    if (token.text) first = false;
                    return (
                        <Text
                            key={idx}
                            style={{ color: getSyntaxColor(token.type, token.nestLevel, theme) }}
                        >
                            {val}
                        </Text>
                    );
                });
            }

            return preserveIndent(content);
        };

        const renderDiffLine = (line: DiffLine, key: string) => {
            const isAdded = line.type === "add";
            const isRemoved = line.type === "remove";
            const textColor = isAdded
                ? colors.addedText
                : isRemoved
                    ? colors.removedText
                    : colors.contextText;
            const bgColor = isAdded
                ? colors.addedBg
                : isRemoved
                    ? colors.removedBg
                    : colors.contextBg;

            const hasDiffTokens = line.tokens && line.tokens.length > 0;
            const syntaxToks =
                language && !hasDiffTokens
                    ? tokenizeLine(line.content, language)
                    : undefined;

            const oldNum = line.oldLineNumber != null
                ? String(line.oldLineNumber).padStart(lineNumWidth, " ")
                : " ".repeat(lineNumWidth);
            const newNum = line.newLineNumber != null
                ? String(line.newLineNumber).padStart(lineNumWidth, " ")
                : " ".repeat(lineNumWidth);

            const sign = isAdded ? " + " : isRemoved ? " - " : "   ";

            return (
                <Text
                    key={key}
                    numberOfLines={1}
                    style={{
                        ...Typography.mono(),
                        fontSize: 12,
                        lineHeight: 18,
                        backgroundColor: bgColor,
                        color: textColor,
                        paddingRight: 6,
                    }}
                >
                    <Text style={{ color: colors.lineNumberText, backgroundColor: colors.lineNumberBg }}>
                        {` ${oldNum} `}
                    </Text>
                    <Text style={{ color: colors.lineNumberText, backgroundColor: colors.lineNumberBg }}>
                        {` ${newNum} `}
                    </Text>
                    {sign}
                    {renderInlineContent(line.content, textColor, line.tokens, syntaxToks)}
                </Text>
            );
        };

        return (
            <View style={{ borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: colors.outline }}>
                {/* Stats header */}
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        backgroundColor: theme.colors.surfaceHigh,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.outline,
                        gap: 8,
                    }}
                >
                    <Text style={{ ...Typography.mono(), fontSize: 11, color: colors.addedText, fontWeight: "600" }}>
                        +{stats.additions}
                    </Text>
                    <Text style={{ ...Typography.mono(), fontSize: 11, color: colors.removedText, fontWeight: "600" }}>
                        -{stats.deletions}
                    </Text>
                </View>

                {/* Hunks */}
                {hunks.map((hunk, hunkIndex) => {
                    const isCollapsed = collapsedHunks.has(hunkIndex);
                    return (
                        <View key={`hunk-${hunkIndex}`}>
                            <Pressable
                                onPress={() => toggleHunk(hunkIndex)}
                                style={{
                                    backgroundColor: colors.hunkHeaderBg,
                                    paddingVertical: 6,
                                    paddingHorizontal: 10,
                                    borderTopWidth: hunkIndex > 0 ? 1 : 0,
                                    borderTopColor: colors.outline,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 4,
                                }}
                            >
                                <Ionicons
                                    name={isCollapsed ? "chevron-forward" : "chevron-down"}
                                    size={12}
                                    color={colors.hunkHeaderText}
                                />
                                <Text
                                    numberOfLines={1}
                                    style={{
                                        ...Typography.mono(),
                                        fontSize: 11,
                                        color: colors.hunkHeaderText,
                                        flex: 1,
                                    }}
                                >
                                    @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                                </Text>
                                <Text
                                    style={{
                                        ...Typography.mono(),
                                        fontSize: 10,
                                        color: colors.hunkHeaderText,
                                        opacity: 0.7,
                                    }}
                                >
                                    {hunk.lines.filter((l) => l.type !== "normal").length}
                                </Text>
                            </Pressable>
                            {!isCollapsed && hunk.lines.map((line, lineIndex) =>
                                renderDiffLine(line, `l-${hunkIndex}-${lineIndex}`),
                            )}
                        </View>
                    );
                })}
            </View>
        );
    },
);
