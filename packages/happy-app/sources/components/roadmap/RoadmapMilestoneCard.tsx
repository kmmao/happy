import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type { RoadmapMilestone, MilestoneStatus } from "@/sync/roadmapTypes";
import { useFeaturesForMilestone, useMilestoneProgress } from "@/sync/roadmapStore";
import { RoadmapProgressBar } from "./RoadmapProgressBar";
import { RoadmapFeatureItem } from "./RoadmapFeatureItem";

const STATUS_ICONS: Record<MilestoneStatus, keyof typeof Ionicons.glyphMap> = {
    planning: "time-outline",
    active: "play-circle-outline",
    completed: "checkmark-circle-outline",
    on_hold: "pause-circle-outline",
};

interface RoadmapMilestoneCardProps {
    projectId: string;
    milestone: RoadmapMilestone;
    onMilestonePress: () => void;
    onFeaturePress: (featureId: string) => void;
    onAddFeature: () => void;
}

export const RoadmapMilestoneCard = React.memo(
    ({
        projectId,
        milestone,
        onMilestonePress,
        onFeaturePress,
        onAddFeature,
    }: RoadmapMilestoneCardProps) => {
        const { theme } = useUnistyles();
        const shouldExpand = milestone.status === "active" || milestone.status === "planning";
        const [expanded, setExpanded] = React.useState(shouldExpand);
        const [prevStatus, setPrevStatus] = React.useState(milestone.status);

        if (milestone.status !== prevStatus) {
            setPrevStatus(milestone.status);
            setExpanded(milestone.status === "active" || milestone.status === "planning");
        }

        const features = useFeaturesForMilestone(projectId, milestone.id);
        const progress = useMilestoneProgress(projectId, milestone.id);

        const toggleExpanded = React.useCallback(() => {
            setExpanded((prev) => !prev);
        }, []);

        return (
            <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider }]}>
                {/* Header */}
                <Pressable style={styles.header} onPress={toggleExpanded} onLongPress={onMilestonePress}>
                    <Ionicons
                        name={STATUS_ICONS[milestone.status]}
                        size={20}
                        color={theme.colors.header.tint}
                    />
                    <View style={styles.headerContent}>
                        <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
                            {milestone.title}
                        </Text>
                        {milestone.targetDate && (
                            <Text style={[styles.date, { color: theme.colors.textSecondary }]}>
                                {new Date(milestone.targetDate).toLocaleDateString()}
                            </Text>
                        )}
                    </View>
                    <Ionicons
                        name={expanded ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>

                {/* Progress */}
                {progress.total > 0 && (
                    <View style={styles.progressContainer}>
                        <RoadmapProgressBar completed={progress.completed} total={progress.total} />
                    </View>
                )}

                {/* Features */}
                {expanded && (
                    <View>
                        {features.length > 0 && (
                            <View style={[styles.featureList, { borderTopColor: theme.colors.divider }]}>
                                {features.map((feature, index) => (
                                    <RoadmapFeatureItem
                                        key={feature.id}
                                        feature={feature}
                                        onPress={() => onFeaturePress(feature.id)}
                                        isLast={index === features.length - 1}
                                    />
                                ))}
                            </View>
                        )}
                        <Pressable
                            style={[styles.addButton, { borderTopColor: theme.colors.divider }]}
                            onPress={onAddFeature}
                        >
                            <Ionicons name="add" size={16} color={theme.colors.header.tint} />
                            <Text style={[styles.addButtonText, { color: theme.colors.header.tint }]}>
                                {t("roadmap.newFeature")}
                            </Text>
                        </Pressable>
                    </View>
                )}
            </View>
        );
    },
);

const styles = StyleSheet.create(() => ({
    card: {
        borderRadius: 12,
        overflow: "hidden",
        borderWidth: 0.5,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        gap: 10,
    },
    headerContent: {
        flex: 1,
        gap: 2,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 16,
    },
    date: {
        ...Typography.default(),
        fontSize: 12,
    },
    progressContainer: {
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    featureList: {
        borderTopWidth: 0.5,
    },
    addButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 12,
        gap: 4,
        borderTopWidth: 0.5,
    },
    addButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
}));
