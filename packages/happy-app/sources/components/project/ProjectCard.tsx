import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import {
    Project,
    getProjectDisplayName,
} from "@/sync/projectManager";
import { formatPathRelativeToHome } from "@/utils/sessionUtils";
import { t } from "@/text";

interface ProjectCardProps {
    project: Project;
    onPress: () => void;
    onLongPress?: () => void;
    showDivider?: boolean;
}

export const ProjectCard = React.memo(({ project, onPress, onLongPress, showDivider }: ProjectCardProps) => {
    const { theme } = useUnistyles();

    const displayName = getProjectDisplayName(project);
    const sessionCount = project.sessionIds.length;
    const machineName =
        project.machineMetadata?.displayName ||
        project.machineMetadata?.host ||
        t("status.unknown");

    const path = formatPathRelativeToHome(
        project.key.path,
        project.machineMetadata?.homeDir,
    );

    const branch = project.gitStatus?.branch;

    const badges = React.useMemo(() => {
        const items: Array<{ key: string; label: string; icon?: keyof typeof Ionicons.glyphMap; tone?: "accent" | "neutral" }> = [
            {
                key: "machine",
                label: machineName,
                tone: "neutral",
            },
        ];
        if (branch) {
            items.push({
                key: "branch",
                label: branch,
                icon: "git-branch-outline",
                tone: "accent",
            });
        }
        return items;
    }, [branch, machineName]);

    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            accessibilityRole="button"
            style={({ pressed }) => [
                styles.container,
                showDivider && styles.containerDivider,
                pressed && styles.containerPressed,
            ]}
        >
            <View style={styles.iconBadge}>
                <Ionicons
                    name="folder-open-outline"
                    size={20}
                    color={theme.colors.header.tint}
                />
            </View>
            <View style={styles.content}>
                <View style={styles.headerRow}>
                    <Text style={styles.title} numberOfLines={1}>
                        {displayName}
                    </Text>
                    <View style={styles.headerActions}>
                        {sessionCount > 0 ? (
                            <View style={styles.sessionBadge}>
                                <Ionicons
                                    name="chatbubble-ellipses-outline"
                                    size={11}
                                    color="#FFFFFF"
                                />
                                <Text style={styles.sessionBadgeText}>
                                    {sessionCount}
                                </Text>
                            </View>
                        ) : null}
                        <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={theme.colors.groupped.chevron}
                        />
                    </View>
                </View>
                <Text style={styles.pathText} numberOfLines={1}>
                    {path}
                </Text>
                <View style={styles.badgesRow}>
                    {badges.map((badge) => (
                        <View
                            key={badge.key}
                            style={[
                                styles.metaBadge,
                                badge.tone === "accent" && styles.metaBadgeAccent,
                            ]}
                        >
                            {badge.icon ? (
                                <Ionicons
                                    name={badge.icon}
                                    size={11}
                                    color={
                                        badge.tone === "accent"
                                            ? theme.colors.accentPurple
                                            : theme.colors.textSecondary
                                    }
                                />
                            ) : null}
                            <Text
                                style={[
                                    styles.metaBadgeText,
                                    badge.tone === "accent" &&
                                        styles.metaBadgeTextAccent,
                                ]}
                                numberOfLines={1}
                            >
                                {badge.label}
                            </Text>
                        </View>
                    ))}
                </View>
            </View>
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: theme.colors.surface,
    },
    containerPressed: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    containerDivider: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    iconBadge: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${theme.colors.header.tint}14`,
    },
    content: {
        flex: 1,
        minWidth: 0,
        gap: 8,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    headerActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    title: {
        flex: 1,
        minWidth: 0,
        fontSize: 15,
        lineHeight: 20,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    pathText: {
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    badgesRow: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
    },
    metaBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: theme.colors.groupped.background,
        maxWidth: "100%",
    },
    metaBadgeAccent: {
        backgroundColor: `${theme.colors.accentPurple}12`,
    },
    metaBadgeText: {
        fontSize: 10,
        color: theme.colors.textSecondary,
        flexShrink: 1,
        ...Typography.default(),
    },
    metaBadgeTextAccent: {
        color: theme.colors.accentPurple,
        ...Typography.default("semiBold"),
    },
    sessionBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: theme.dark
            ? theme.colors.accentPurple
            : theme.colors.header.tint,
        borderRadius: 999,
        minWidth: 20,
        height: 20,
        paddingHorizontal: 6,
        justifyContent: "center",
    },
    sessionBadgeText: {
        color: "#FFFFFF",
        fontSize: 11,
        ...Typography.default("semiBold"),
    },
}));
