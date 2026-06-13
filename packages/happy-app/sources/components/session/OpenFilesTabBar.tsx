/**
 * OpenFilesTabBar — VSCode-style horizontal tab bar for the multi-file
 * preview overlay hosted by SessionSidePanel, MobileSessionPanelSheet and
 * the /git page.
 *
 * Each tab shows a small file icon + truncated filename + close (×). A
 * trailing "+" button (when `onAddFile` is provided) returns to the file
 * browser so the user can pick another file without losing currently
 * opened tabs.
 *
 * Tabs are keyed by `filePath`; switching tabs is instant because the
 * host keeps every SidePanelFilePreview mounted (active vs. hidden via
 * `display`), preserving each file's mode toggle, scroll position and
 * load state.
 */

import * as React from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { Octicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";

import { FileIcon } from "@/components/FileIcon";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";

export interface OpenFile {
    readonly filePath: string;
    readonly repoPath?: string;
}

interface OpenFilesTabBarProps {
    readonly files: ReadonlyArray<OpenFile>;
    readonly activeIndex: number;
    readonly onTabPress: (index: number) => void;
    readonly onTabClose: (index: number) => void;
    /**
     * Optional "+" button at the right end. Tapping it returns the host
     * to the file browser so the user can pick another file. Hide when
     * there is no browser to return to (e.g. nothing useful underneath).
     */
    readonly onAddFile?: () => void;
}

const TAB_MAX_WIDTH = 168;

export const OpenFilesTabBar = React.memo<OpenFilesTabBarProps>(
    function OpenFilesTabBar({ files, activeIndex, onTabPress, onTabClose, onAddFile }) {
        const { theme } = useUnistyles();

        return (
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "stretch",
                    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                    borderBottomColor: theme.colors.divider,
                    backgroundColor: theme.colors.surfaceHigh,
                    minHeight: 34,
                }}
            >
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ alignItems: "stretch" }}
                >
                    {files.map((file, index) => {
                        const isActive = index === activeIndex;
                        const fileName =
                            file.filePath.split("/").pop() || file.filePath;
                        return (
                            <Pressable
                                key={file.filePath}
                                onPress={() => onTabPress(index)}
                                style={({ pressed }) => ({
                                    flexDirection: "row",
                                    alignItems: "center",
                                    paddingLeft: 10,
                                    paddingRight: 6,
                                    gap: 6,
                                    maxWidth: TAB_MAX_WIDTH,
                                    backgroundColor: isActive
                                        ? theme.colors.surface
                                        : pressed
                                          ? theme.colors.surfacePressedOverlay
                                          : "transparent",
                                    borderRightWidth: 1,
                                    borderRightColor: theme.colors.divider,
                                    borderTopWidth: 2,
                                    borderTopColor: isActive
                                        ? theme.colors.textLink
                                        : "transparent",
                                })}
                            >
                                <FileIcon fileName={fileName} size={14} />
                                <Text
                                    numberOfLines={1}
                                    style={{
                                        flex: 1,
                                        fontSize: 12,
                                        color: isActive
                                            ? theme.colors.text
                                            : theme.colors.textSecondary,
                                        fontWeight: isActive ? "600" : "400",
                                        ...Typography.default(),
                                    }}
                                >
                                    {fileName}
                                </Text>
                                <Pressable
                                    onPress={(e) => {
                                        e.stopPropagation();
                                        onTabClose(index);
                                    }}
                                    hitSlop={6}
                                    accessibilityLabel={t("files.closeTab")}
                                    style={({ pressed }) => ({
                                        padding: 4,
                                        borderRadius: 4,
                                        opacity: pressed ? 0.5 : 0.75,
                                    })}
                                >
                                    <Octicons
                                        name="x"
                                        size={12}
                                        color={theme.colors.textSecondary}
                                    />
                                </Pressable>
                            </Pressable>
                        );
                    })}
                </ScrollView>
                {onAddFile && (
                    <Pressable
                        onPress={onAddFile}
                        hitSlop={6}
                        accessibilityLabel={t("files.browseMore")}
                        style={({ pressed }) => ({
                            paddingHorizontal: 12,
                            justifyContent: "center",
                            opacity: pressed ? 0.5 : 1,
                            borderLeftWidth: 1,
                            borderLeftColor: theme.colors.divider,
                        })}
                    >
                        <Octicons
                            name="plus"
                            size={16}
                            color={theme.colors.textLink}
                        />
                    </Pressable>
                )}
            </View>
        );
    },
);
