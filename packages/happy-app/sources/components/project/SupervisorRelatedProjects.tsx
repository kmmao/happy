import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { ItemGroup } from "@/components/ItemGroup";
import type { RelatedProject } from "@/sync/apiProjects";

interface SupervisorRelatedProjectsProps {
    relatedProjects: RelatedProject[];
}

export const SupervisorRelatedProjects = React.memo(
    ({ relatedProjects }: SupervisorRelatedProjectsProps) => {
        const { theme } = useUnistyles();

        if (relatedProjects.length === 0) return null;

        return (
            <ItemGroup title={t("supervisor.relatedProjects")}>
                {relatedProjects.map((rp, index) => (
                    <View
                        key={rp.id}
                        style={[
                            styles.relatedItem,
                            index < relatedProjects.length - 1 &&
                                styles.relatedItemBorder,
                        ]}
                    >
                        <Ionicons
                            name="desktop-outline"
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                        <View style={styles.relatedItemContent}>
                            <Text style={styles.relatedItemMachine}>
                                {rp.machineName}
                            </Text>
                            <Text
                                style={styles.relatedItemPath}
                                numberOfLines={1}
                            >
                                {rp.path}
                            </Text>
                        </View>
                    </View>
                ))}
            </ItemGroup>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    relatedItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    relatedItemBorder: {
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    relatedItemContent: {
        flex: 1,
    },
    relatedItemMachine: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
    },
    relatedItemPath: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
}));
