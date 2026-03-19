import * as React from "react";
import { View, ScrollView, Pressable, Text, RefreshControl, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { layout } from "@/components/layout";
import type { Project } from "@/sync/projectManager";
import {
    roadmapStore,
    useMilestones,
    useRoadmapLoading,
    useRoadmapLoaded,
} from "@/sync/roadmapStore";
import { RoadmapMilestoneCard } from "./RoadmapMilestoneCard";
import { RoadmapEmptyState } from "./RoadmapEmptyState";
import { useRouter } from "expo-router";

interface ProjectRoadmapTabProps {
    project: Project;
}

export const ProjectRoadmapTab = React.memo(
    ({ project }: ProjectRoadmapTabProps) => {
        const { theme } = useUnistyles();
        const router = useRouter();
        const projectId = project.serverId ?? project.id;

        const [refreshing, setRefreshing] = React.useState(false);

        const milestones = useMilestones(projectId);
        const loading = useRoadmapLoading(projectId);
        const loaded = useRoadmapLoaded(projectId);

        // Load on mount
        React.useEffect(() => {
            roadmapStore.getState().loadRoadmap(projectId);
        }, [projectId]);

        const onRefresh = React.useCallback(async () => {
            setRefreshing(true);
            try {
                roadmapStore.setState((prev) => ({
                    loadedProjects: { ...prev.loadedProjects, [projectId]: false },
                }));
                await roadmapStore.getState().loadRoadmap(projectId);
            } finally {
                setRefreshing(false);
            }
        }, [projectId]);

        const handleNewMilestone = React.useCallback(() => {
            router.push(`/roadmap/new-milestone?projectId=${projectId}`);
        }, [router, projectId]);

        const handleMilestonePress = React.useCallback(
            (milestoneId: string) => {
                router.push(`/roadmap/milestone/${milestoneId}?projectId=${projectId}`);
            },
            [router, projectId],
        );

        const handleFeaturePress = React.useCallback(
            (featureId: string) => {
                router.push(`/roadmap/feature/${featureId}?projectId=${projectId}`);
            },
            [router, projectId],
        );

        const handleAddFeature = React.useCallback(
            (milestoneId: string) => {
                router.push(`/roadmap/new-feature?projectId=${projectId}&milestoneId=${milestoneId}`);
            },
            [router, projectId],
        );

        if (loading && !loaded) {
            return (
                <View style={styles.center}>
                    <ActivityIndicator />
                </View>
            );
        }

        return (
            <View style={styles.container}>
                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={styles.contentContainer}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                    }
                >
                    <View style={styles.innerContainer}>
                        {milestones.length === 0 ? (
                            <RoadmapEmptyState />
                        ) : (
                            <View style={styles.milestoneList}>
                                {milestones.map((milestone) => (
                                    <RoadmapMilestoneCard
                                        key={milestone.id}
                                        projectId={projectId}
                                        milestone={milestone}
                                        onMilestonePress={() =>
                                            handleMilestonePress(milestone.id)
                                        }
                                        onFeaturePress={handleFeaturePress}
                                        onAddFeature={() =>
                                            handleAddFeature(milestone.id)
                                        }
                                    />
                                ))}
                            </View>
                        )}
                    </View>
                </ScrollView>
                <Pressable
                    style={[styles.fab, { backgroundColor: theme.colors.header.tint }]}
                    onPress={handleNewMilestone}
                >
                    <Ionicons name="add" size={24} color="#FFFFFF" />
                </Pressable>
            </View>
        );
    },
);

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
    },
    center: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    scrollView: {
        flex: 1,
    },
    contentContainer: {
        paddingTop: 8,
        paddingBottom: 80,
    },
    innerContainer: {
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
    },
    milestoneList: {
        paddingHorizontal: 16,
        gap: 16,
    },
    fab: {
        position: "absolute",
        right: 16,
        bottom: 16,
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
}));
