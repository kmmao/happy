import * as React from "react";
import {
    View,
    ActivityIndicator,
    Platform,
    Pressable,
    RefreshControl,
    NativeScrollEvent,
    NativeSyntheticEvent,
    TextInput,
} from "react-native";
import { t } from "@/text";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Item } from "@/components/Item";
import { ItemList } from "@/components/ItemList";
import { Typography } from "@/constants/Typography";
import { sessionListDirectory, DirectoryEntry } from "@/sync/ops";
import { storage } from "@/sync/storage";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { FileIcon } from "@/components/FileIcon";
import { utf8ToBase64 } from "@/utils/stringUtils";

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

function isBinaryExtension(name: string): boolean {
    const ext = name.split(".").pop()?.toLowerCase();
    return ext ? BINARY_EXTENSIONS.has(ext) : false;
}

function formatFileSize(bytes?: number): string {
    if (bytes === undefined || bytes === null) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SCROLL_COLLAPSE_THRESHOLD = 20;

const HIDDEN_PATTERNS = new Set([
    ".git", ".svn", ".hg", ".history", ".vscode", ".idea",
    ".DS_Store", ".gitignore", ".gitattributes", ".gitmodules",
    "node_modules", "__pycache__", ".cache", ".tmp",
]);

function isHiddenEntry(name: string): boolean {
    return name.startsWith(".") || HIDDEN_PATTERNS.has(name);
}

export const GitBrowseTab = React.memo<{
    sessionId: string;
    onPullDown?: () => void;
    onScrollUp?: () => void;
    embedded?: boolean;
    onFileOpen?: () => void;
    onFilePress?: (fullPath: string) => void;
    onReference?: (path: string) => void;
}>(function GitBrowseTab({ sessionId, onPullDown, onScrollUp, embedded, onFileOpen, onFilePress, onReference }) {
    const router = useRouter();
    const { theme } = useUnistyles();

    const basePath = React.useMemo(
        () => storage.getState().sessions[sessionId]?.metadata?.path ?? null,
        [sessionId],
    );

    const [currentPath, setCurrentPath] = React.useState<string | null>(null);
    const [entries, setEntries] = React.useState<DirectoryEntry[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [pathHistory, setPathHistory] = React.useState<string[]>([]);
    const [refreshKey, setRefreshKey] = React.useState(0);
    const [filterText, setFilterText] = React.useState("");
    const [showHidden, setShowHidden] = React.useState(false);

    // Initialize to basePath once
    React.useEffect(() => {
        if (basePath && currentPath === null) {
            setCurrentPath(basePath);
        }
    }, [basePath, currentPath]);

    // Load directory entries
    React.useEffect(() => {
        if (!currentPath) return;
        let cancelled = false;

        const load = async () => {
            setIsLoading(true);
            try {
                const result = await sessionListDirectory(sessionId, currentPath);
                if (!cancelled) {
                    if (result.success && result.entries) {
                        setEntries(
                            result.entries.filter(
                                (e) => e.type !== "other",
                            ),
                        );
                    } else {
                        setEntries([]);
                    }
                }
            } catch {
                if (!cancelled) setEntries([]);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [sessionId, currentPath, refreshKey]);

    // Refresh listing on screen focus (skip in embedded/overlay mode)
    useFocusEffect(
        React.useCallback(() => {
            if (!embedded) {
                setRefreshKey((k) => k + 1);
            }
        }, [embedded]),
    );

    const handleEntryPress = React.useCallback(
        (entry: DirectoryEntry) => {
            if (entry.type === "directory") {
                const newPath = `${currentPath}/${entry.name}`;
                setPathHistory((prev) => [...prev, currentPath!]);
                setCurrentPath(newPath);
            } else {
                const fullPath = `${currentPath}/${entry.name}`;
                if (onFilePress) {
                    onFilePress(fullPath);
                } else {
                    onFileOpen?.();
                    const encodedPath = utf8ToBase64(fullPath);
                    router.push(`/session/${sessionId}/file?path=${encodedPath}`);
                }
            }
        },
        [currentPath, sessionId, router, onFilePress],
    );

    const handleBack = React.useCallback(() => {
        setPathHistory((prev) => {
            const next = [...prev];
            const parent = next.pop() ?? basePath ?? currentPath;
            setCurrentPath(parent);
            return next;
        });
    }, [basePath, currentPath]);

    const handleRefresh = React.useCallback(() => {
        setRefreshKey((k) => k + 1);
        onPullDown?.();
    }, [onPullDown]);

    const canGoBack = pathHistory.length > 0;

    // Show path relative to basePath
    const displayPath =
        basePath && currentPath
            ? currentPath.slice(basePath.length) || "/"
            : currentPath ?? "/";

    // Clear filter when navigating directories
    React.useEffect(() => {
        setFilterText("");
    }, [currentPath]);

    // Sort: directories first, then files; both alphabetically
    // Filter by search text and hidden files
    const sorted = React.useMemo(() => {
        const lowerFilter = filterText.toLowerCase();
        return [...entries]
            .filter((e) => {
                if (!showHidden && isHiddenEntry(e.name)) return false;
                if (lowerFilter && !e.name.toLowerCase().includes(lowerFilter)) return false;
                return true;
            })
            .sort((a, b) => {
                if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
    }, [entries, filterText, showHidden]);

    const scrollCollapseCalledRef = React.useRef(false);
    const handleScroll = React.useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (!onScrollUp) return;
            const y = e.nativeEvent.contentOffset.y;
            if (y > SCROLL_COLLAPSE_THRESHOLD && !scrollCollapseCalledRef.current) {
                scrollCollapseCalledRef.current = true;
                onScrollUp();
            } else if (y <= 0) {
                scrollCollapseCalledRef.current = false;
            }
        },
        [onScrollUp],
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            {/* Path bar */}
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: embedded ? 8 : 16,
                    paddingVertical: embedded ? 4 : 12,
                    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                    borderBottomColor: theme.colors.divider,
                    backgroundColor: theme.colors.surfaceHigh,
                    gap: embedded ? 6 : 8,
                }}
            >
                {canGoBack && (
                    <Pressable onPress={handleBack} hitSlop={8}>
                        <Octicons
                            name="arrow-left"
                            size={18}
                            color={theme.colors.textLink}
                        />
                    </Pressable>
                )}
                <Octicons
                    name="file-directory"
                    size={16}
                    color={theme.colors.textSecondary}
                />
                <Text
                    style={{
                        flex: 1,
                        fontSize: embedded ? 12 : 13,
                        color: theme.colors.textSecondary,
                        ...Typography.mono(),
                    }}
                    numberOfLines={1}
                >
                    {displayPath}
                </Text>
                {embedded && (
                    <Pressable
                        onPress={() => setShowHidden((v) => !v)}
                        hitSlop={6}
                        style={{ padding: 2 }}
                    >
                        <Octicons
                            name={showHidden ? "eye" : "eye-closed"}
                            size={14}
                            color={showHidden ? theme.colors.textLink : theme.colors.textSecondary}
                        />
                    </Pressable>
                )}
            </View>

            {/* Filter bar (embedded mode) */}
            {embedded && (
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderBottomWidth: 1,
                        borderBottomColor: theme.colors.divider,
                        gap: 4,
                    }}
                >
                    <Octicons name="search" size={12} color={theme.colors.textSecondary} />
                    <TextInput
                        value={filterText}
                        onChangeText={setFilterText}
                        placeholder={t("files.filterFiles")}
                        placeholderTextColor={theme.colors.textSecondary}
                        style={{
                            flex: 1,
                            fontSize: 12,
                            color: theme.colors.text,
                            paddingVertical: 2,
                            ...Typography.default(),
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    {filterText.length > 0 && (
                        <Pressable onPress={() => setFilterText("")} hitSlop={4}>
                            <Octicons name="x" size={12} color={theme.colors.textSecondary} />
                        </Pressable>
                    )}
                </View>
            )}

            {/* Directory listing */}
            <ItemList
                style={{ flex: 1 }}
                onScroll={!embedded && onScrollUp ? handleScroll : undefined}
                scrollEventThrottle={!embedded && onScrollUp ? 16 : undefined}
                nestedScrollEnabled={embedded}
                refreshControl={
                    embedded ? undefined : (
                        <RefreshControl
                            refreshing={false}
                            onRefresh={handleRefresh}
                        />
                    )
                }
            >
                {isLoading ? (
                    <View
                        style={{
                            flex: 1,
                            justifyContent: "center",
                            alignItems: "center",
                            paddingTop: 40,
                        }}
                    >
                        <ActivityIndicator
                            size="small"
                            color={theme.colors.textSecondary}
                        />
                    </View>
                ) : sorted.length === 0 ? (
                    <View
                        style={{
                            flex: 1,
                            justifyContent: "center",
                            alignItems: "center",
                            paddingTop: embedded ? 20 : 40,
                            paddingHorizontal: 20,
                        }}
                    >
                        <Octicons
                            name={filterText ? "search" : "file-directory"}
                            size={embedded ? 28 : 48}
                            color={theme.colors.textSecondary}
                        />
                        <Text
                            style={{
                                fontSize: embedded ? 13 : 16,
                                color: theme.colors.textSecondary,
                                textAlign: "center",
                                marginTop: embedded ? 8 : 16,
                                ...Typography.default(),
                            }}
                        >
                            {filterText ? t("files.noMatchingFiles") : t("files.emptyDirectory")}
                        </Text>
                    </View>
                ) : embedded ? (
                    sorted.map((entry) => {
                        const isDir = entry.type === "directory";
                        const entryFullPath = `${currentPath}/${entry.name}`;
                        const entryRelPath = basePath
                            ? entryFullPath.slice(basePath.length + 1)
                            : entry.name;

                        return (
                            <Pressable
                                key={`${entry.type}-${entry.name}`}
                                onPress={() => handleEntryPress(entry)}
                                style={({ pressed }) => ({
                                    flexDirection: "row",
                                    alignItems: "center",
                                    paddingHorizontal: 12,
                                    paddingVertical: 6,
                                    gap: 8,
                                    backgroundColor: pressed ? theme.colors.surfacePressedOverlay : "transparent",
                                })}
                            >
                                {isDir ? (
                                    <Octicons name="file-directory" size={19} color="#007AFF" />
                                ) : (
                                    <FileIcon fileName={entry.name} size={19} />
                                )}
                                <Text
                                    style={{
                                        flex: 1,
                                        fontSize: 15,
                                        color: theme.colors.text,
                                        ...Typography.default(),
                                    }}
                                    numberOfLines={1}
                                >
                                    {entry.name}
                                </Text>
                                {onReference && (
                                    <Pressable
                                        onPress={(e) => {
                                            e.stopPropagation();
                                            onReference(entryRelPath);
                                        }}
                                        hitSlop={6}
                                        style={({ pressed }) => ({
                                            padding: 2,
                                            opacity: pressed ? 0.5 : 1,
                                        })}
                                    >
                                        <Octicons name="mention" size={15} color={theme.colors.textLink} />
                                    </Pressable>
                                )}
                                {isDir && (
                                    <Octicons name="chevron-right" size={15} color={theme.colors.textSecondary} />
                                )}
                            </Pressable>
                        );
                    })
                ) : (
                    sorted.map((entry, index) => {
                        const isDir = entry.type === "directory";
                        const icon = isDir ? (
                            <Octicons
                                name="file-directory"
                                size={29}
                                color="#007AFF"
                            />
                        ) : (
                            <FileIcon fileName={entry.name} size={29} />
                        );

                        const subtitle = isDir
                            ? t("files.directory")
                            : formatFileSize(entry.size);

                        const entryFullPath = `${currentPath}/${entry.name}`;
                        const entryRelPath = basePath
                            ? entryFullPath.slice(basePath.length + 1)
                            : entry.name;

                        const baseRightEl = isDir ? (
                            <Octicons
                                name="chevron-right"
                                size={16}
                                color={theme.colors.textSecondary}
                            />
                        ) : isBinaryExtension(entry.name) ? (
                            <Text
                                style={{
                                    fontSize: 11,
                                    color: theme.colors.textSecondary,
                                    ...Typography.default(),
                                }}
                            >
                                binary
                            </Text>
                        ) : undefined;

                        const rightEl = onReference ? (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <Pressable
                                    onPress={(e) => {
                                        e.stopPropagation();
                                        onReference(entryRelPath);
                                    }}
                                    hitSlop={6}
                                    style={({ pressed }) => ({
                                        padding: 4,
                                        borderRadius: 6,
                                        opacity: pressed ? 0.5 : 1,
                                    })}
                                >
                                    <Octicons
                                        name="mention"
                                        size={16}
                                        color={theme.colors.textLink}
                                    />
                                </Pressable>
                                {baseRightEl}
                            </View>
                        ) : baseRightEl;

                        return (
                            <Item
                                key={`${entry.type}-${entry.name}`}
                                title={entry.name}
                                subtitle={subtitle}
                                icon={icon}
                                rightElement={rightEl}
                                onPress={() => handleEntryPress(entry)}
                                showDivider={index < sorted.length - 1}
                            />
                        );
                    })
                )}
            </ItemList>
        </View>
    );
});

GitBrowseTab.displayName = "GitBrowseTab";

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
        maxWidth: layout.maxWidth,
        alignSelf: "center",
        width: "100%",
    },
}));
