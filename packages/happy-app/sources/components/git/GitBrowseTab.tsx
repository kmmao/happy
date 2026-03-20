import * as React from "react";
import {
    View,
    ActivityIndicator,
    Platform,
    Pressable,
    RefreshControl,
    NativeScrollEvent,
    NativeSyntheticEvent,
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

export const GitBrowseTab = React.memo<{
    sessionId: string;
    onPullDown?: () => void;
    onScrollUp?: () => void;
}>(function GitBrowseTab({ sessionId, onPullDown, onScrollUp }) {
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

    // Refresh listing on screen focus
    useFocusEffect(
        React.useCallback(() => {
            setRefreshKey((k) => k + 1);
        }, []),
    );

    const handleEntryPress = React.useCallback(
        (entry: DirectoryEntry) => {
            if (entry.type === "directory") {
                const newPath = `${currentPath}/${entry.name}`;
                setPathHistory((prev) => [...prev, currentPath!]);
                setCurrentPath(newPath);
            } else {
                const fullPath = `${currentPath}/${entry.name}`;
                const encodedPath = utf8ToBase64(fullPath);
                router.push(`/session/${sessionId}/file?path=${encodedPath}`);
            }
        },
        [currentPath, sessionId, router],
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

    // Sort: directories first, then files; both alphabetically
    const sorted = React.useMemo(
        () =>
            [...entries].sort((a, b) => {
                if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
                return a.name.localeCompare(b.name);
            }),
        [entries],
    );

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
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                    borderBottomColor: theme.colors.divider,
                    backgroundColor: theme.colors.surfaceHigh,
                    gap: 8,
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
                        fontSize: 13,
                        color: theme.colors.textSecondary,
                        ...Typography.mono(),
                    }}
                    numberOfLines={1}
                >
                    {displayPath}
                </Text>
            </View>

            {/* Directory listing */}
            <ItemList
                style={{ flex: 1 }}
                onScroll={onScrollUp ? handleScroll : undefined}
                scrollEventThrottle={onScrollUp ? 16 : undefined}
                refreshControl={
                    <RefreshControl
                        refreshing={false}
                        onRefresh={handleRefresh}
                    />
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
                            paddingTop: 40,
                            paddingHorizontal: 20,
                        }}
                    >
                        <Octicons
                            name="file-directory"
                            size={48}
                            color={theme.colors.textSecondary}
                        />
                        <Text
                            style={{
                                fontSize: 16,
                                color: theme.colors.textSecondary,
                                textAlign: "center",
                                marginTop: 16,
                                ...Typography.default(),
                            }}
                        >
                            {t("files.emptyDirectory")}
                        </Text>
                    </View>
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

                        const rightEl = isDir ? (
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
