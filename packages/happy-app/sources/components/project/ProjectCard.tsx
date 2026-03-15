import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
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
}

export const ProjectCard = React.memo(({ project, onPress }: ProjectCardProps) => {
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

    const subtitle = React.useMemo(() => {
        const parts: string[] = [machineName];
        if (branch) {
            parts.push(`⎇ ${branch}`);
        }
        parts.push(path);
        return parts.join(" · ");
    }, [machineName, branch, path]);

    return (
        <Item
            title={displayName}
            subtitle={subtitle}
            subtitleLines={1}
            icon={
                <Ionicons
                    name="folder-outline"
                    size={24}
                    color={theme.colors.text}
                />
            }
            onPress={onPress}
            rightElement={
                sessionCount > 0 ? (
                    <View style={styles.sessionBadge}>
                        <Text style={styles.sessionBadgeText}>
                            {sessionCount}
                        </Text>
                    </View>
                ) : undefined
            }
            showChevron
        />
    );
});

const styles = StyleSheet.create((theme) => ({
    sessionBadge: {
        backgroundColor: theme.colors.status.connected,
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        paddingHorizontal: 6,
        justifyContent: "center",
        alignItems: "center",
    },
    sessionBadgeText: {
        color: "#FFFFFF",
        fontSize: 11,
        ...Typography.default("semiBold"),
    },
}));
