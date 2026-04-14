import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { t } from "@/text";
import { WorldRolesTab } from "./WorldRolesTab";
import { WorldMembersTab } from "./WorldMembersTab";

type SubTab = "roles" | "members";

interface WorldTeamTabProps {
    project: Project;
    isActive: boolean;
}

export const WorldTeamTab = React.memo(
    ({ project, isActive }: WorldTeamTabProps) => {
        const [subTab, setSubTab] = React.useState<SubTab>("roles");

        return (
            <View style={styles.container}>
                <View style={styles.segmentRow}>
                    {(["roles", "members"] as SubTab[]).map((key) => {
                        const active = subTab === key;
                        return (
                            <Pressable
                                key={key}
                                style={[styles.segmentButton, active && styles.segmentButtonActive]}
                                onPress={() => setSubTab(key)}
                            >
                                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                                    {key === "roles" ? t("projects.tabRoles") : t("projects.tabMembers")}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
                <View style={subTab === "roles" ? styles.visible : styles.hidden}>
                    <WorldRolesTab project={project} isActive={isActive && subTab === "roles"} />
                </View>
                <View style={subTab === "members" ? styles.visible : styles.hidden}>
                    <WorldMembersTab project={project} isActive={isActive && subTab === "members"} />
                </View>
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    segmentRow: {
        flexDirection: "row",
        justifyContent: "center",
        gap: 4,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    segmentButton: {
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 14,
        backgroundColor: theme.colors.surface,
    },
    segmentButtonActive: {
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
    },
    segmentText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    segmentTextActive: {
        color: "#FFFFFF",
    },
    visible: {
        flex: 1,
    },
    hidden: {
        flex: 1,
        display: "none",
    },
}));
