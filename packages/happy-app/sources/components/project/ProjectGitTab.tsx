import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { t } from "@/text";

interface ProjectGitTabProps {
    project: Project;
}

export const ProjectGitTab = React.memo(({ project }: ProjectGitTabProps) => {
    const { theme } = useUnistyles();
    const gitStatus = project.gitStatus;

    if (!gitStatus) {
        return (
            <View style={styles.emptyContainer}>
                <Ionicons
                    name="git-branch-outline"
                    size={48}
                    color={theme.colors.textSecondary}
                />
                <Text style={styles.emptyText}>
                    {t("projects.noGitInfo")}
                </Text>
            </View>
        );
    }

    return (
        <ItemList>
            <ItemGroup title={t("projects.gitInfo")}>
                <Item
                    title={t("projects.branch")}
                    detail={gitStatus.branch ?? "-"}
                    icon={
                        <Ionicons
                            name="git-branch-outline"
                            size={24}
                            color={theme.colors.text}
                        />
                    }
                    showChevron={false}
                />
                {gitStatus.aheadCount !== undefined && (
                    <Item
                        title={t("projects.ahead")}
                        detail={String(gitStatus.aheadCount)}
                        showChevron={false}
                    />
                )}
                {gitStatus.behindCount !== undefined && (
                    <Item
                        title={t("projects.behind")}
                        detail={String(gitStatus.behindCount)}
                        showChevron={false}
                    />
                )}
                <Item
                    title={t("projects.dirty")}
                    detail={gitStatus.isDirty ? t("common.yes") : t("common.no")}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
});

const styles = StyleSheet.create((theme) => ({
    emptyContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        marginTop: 12,
        textAlign: "center",
    },
}));
