/**
 * Simple file picker modal that browses remote directories.
 * Uses sessionListDirectory RPC to list files/folders.
 * User can navigate into folders and select a file.
 */

import * as React from "react";
import {
    View,
    Text,
    FlatList,
    Pressable,
    Modal,
    SafeAreaView,
    ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { sessionListDirectory } from "@/sync/ops";
import type { DirectoryEntry } from "@/sync/ops";

type Props = {
    readonly visible: boolean;
    readonly sessionId: string;
    readonly onSelect: (path: string) => void;
    readonly onClose: () => void;
};

function FilePickerModalInner({ visible, sessionId, onSelect, onClose }: Props) {
    const { theme } = useUnistyles();
    const [currentPath, setCurrentPath] = React.useState(".");
    const [entries, setEntries] = React.useState<DirectoryEntry[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [pathHistory, setPathHistory] = React.useState<string[]>([]);

    const loadDirectory = React.useCallback(async (path: string) => {
        setLoading(true);
        try {
            const result = await sessionListDirectory(sessionId, path);
            if (result.success && result.entries) {
                // Sort: directories first, then files, both alphabetically
                const sorted = [...result.entries].sort((a, b) => {
                    if (a.type === "directory" && b.type !== "directory") return -1;
                    if (a.type !== "directory" && b.type === "directory") return 1;
                    return a.name.localeCompare(b.name);
                });
                setEntries(sorted);
            } else {
                setEntries([]);
            }
        } catch {
            setEntries([]);
        }
        setLoading(false);
    }, [sessionId]);

    // Load root on open
    React.useEffect(() => {
        if (visible) {
            setCurrentPath(".");
            setPathHistory([]);
            loadDirectory(".");
        }
    }, [visible, loadDirectory]);

    const navigateInto = React.useCallback((dirName: string) => {
        const newPath = currentPath === "." ? `./${dirName}` : `${currentPath}/${dirName}`;
        setPathHistory((prev) => [...prev, currentPath]);
        setCurrentPath(newPath);
        loadDirectory(newPath);
    }, [currentPath, loadDirectory]);

    const navigateBack = React.useCallback(() => {
        const prev = pathHistory[pathHistory.length - 1];
        if (prev != null) {
            setPathHistory((h) => h.slice(0, -1));
            setCurrentPath(prev);
            loadDirectory(prev);
        }
    }, [pathHistory, loadDirectory]);

    const handleSelect = React.useCallback((entry: DirectoryEntry) => {
        if (entry.type === "directory") {
            navigateInto(entry.name);
        } else {
            const filePath = currentPath === "." ? `./${entry.name}` : `${currentPath}/${entry.name}`;
            onSelect(filePath);
        }
    }, [currentPath, navigateInto, onSelect]);

    const displayPath = currentPath === "." ? "/" : currentPath.replace(/^\.\//, "/");

    const renderItem = React.useCallback(({ item }: { item: DirectoryEntry }) => {
        const isDir = item.type === "directory";
        // Hide hidden files/dirs except .env*
        if (item.name.startsWith(".") && !item.name.startsWith(".env")) return null;
        // Hide common noise
        if (item.name === "node_modules" || item.name === ".git" || item.name === "target" || item.name === "build" || item.name === ".idea") return null;

        return (
            <Pressable
                style={({ pressed }) => [
                    styles.item,
                    { borderBottomColor: theme.colors.divider },
                    pressed && { backgroundColor: `${theme.colors.textLink}08` },
                ]}
                onPress={() => handleSelect(item)}
            >
                <Ionicons
                    name={isDir ? "folder" : "document-outline"}
                    size={18}
                    color={isDir ? "#FFC107" : theme.colors.textSecondary}
                />
                <Text
                    style={[styles.itemName, { color: theme.colors.text }]}
                    numberOfLines={1}
                >
                    {item.name}
                </Text>
                {isDir && (
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                )}
            </Pressable>
        );
    }, [theme, handleSelect]);

    if (!visible) return null;

    return (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.surface }]}>
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
                    <Pressable onPress={onClose} hitSlop={10}>
                        <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                    </Pressable>
                    <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
                        Select File
                    </Text>
                    <View style={{ width: 22 }} />
                </View>

                {/* Breadcrumb */}
                <View style={[styles.breadcrumb, { backgroundColor: theme.colors.surfaceHigh }]}>
                    {pathHistory.length > 0 && (
                        <Pressable onPress={navigateBack} hitSlop={8} style={styles.backBtn}>
                            <Ionicons name="arrow-back" size={18} color={theme.colors.textLink} />
                        </Pressable>
                    )}
                    <Ionicons name="folder-open-outline" size={14} color={theme.colors.textSecondary} />
                    <Text style={[styles.breadcrumbText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                        {displayPath}
                    </Text>
                </View>

                {/* File list */}
                {loading ? (
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} style={{ marginTop: 40 }} />
                ) : (
                    <FlatList
                        data={entries}
                        renderItem={renderItem}
                        keyExtractor={(item) => item.name}
                        style={styles.list}
                    />
                )}
            </SafeAreaView>
        </Modal>
    );
}

export const FilePickerModal = React.memo(FilePickerModalInner);

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    title: {
        fontSize: 17,
        fontWeight: "600",
    },
    breadcrumb: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    breadcrumbText: {
        fontSize: 12,
        fontFamily: "monospace",
        flex: 1,
    },
    backBtn: {
        marginRight: 4,
    },
    list: {
        flex: 1,
    },
    item: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    itemName: {
        fontSize: 14,
        flex: 1,
    },
});
