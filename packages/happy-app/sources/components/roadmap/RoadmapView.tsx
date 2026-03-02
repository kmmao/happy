import * as React from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { layout } from "@/components/layout";
import {
  roadmapStore,
  useRoadmapMilestones,
  useRoadmapFeatures,
  useRoadmapLoading,
  useRoadmapLoaded,
  useRoadmapExpandedMilestone,
} from "@/sync/roadmapStore";
import { type RoadmapMilestone } from "@/sync/roadmapTypes";
import { RoadmapMilestoneCard } from "./RoadmapMilestoneCard";
import { RoadmapEmptyState } from "./RoadmapEmptyState";
import { useRouter } from "expo-router";

/**
 * Main Roadmap list view.
 * Shows milestones with expandable feature lists.
 */
export const RoadmapView = React.memo(() => {
  const { theme } = useUnistyles();
  const router = useRouter();
  const milestones = useRoadmapMilestones();
  const features = useRoadmapFeatures();
  const isLoading = useRoadmapLoading();
  const isLoaded = useRoadmapLoaded();
  const expandedMilestoneId = useRoadmapExpandedMilestone();

  // Load roadmap on mount
  React.useEffect(() => {
    if (!isLoaded && !isLoading) {
      roadmapStore.getState().loadRoadmap();
    }
  }, [isLoaded, isLoading]);

  const handleToggle = React.useCallback((milestoneId: string) => {
    const current = roadmapStore.getState().expandedMilestoneId;
    roadmapStore
      .getState()
      .setExpandedMilestone(current === milestoneId ? null : milestoneId);
  }, []);

  const handleMilestonePress = React.useCallback(
    (milestoneId: string) => {
      router.push(`/roadmap/milestone/${milestoneId}`);
    },
    [router],
  );

  const handleFeaturePress = React.useCallback(
    (featureId: string) => {
      router.push(`/roadmap/feature/${featureId}`);
    },
    [router],
  );

  const renderItem = React.useCallback(
    ({ item }: { item: RoadmapMilestone }) => (
      <RoadmapMilestoneCard
        milestone={item}
        features={features}
        isExpanded={expandedMilestoneId === item.id}
        onToggle={handleToggle}
        onMilestonePress={handleMilestonePress}
        onFeaturePress={handleFeaturePress}
      />
    ),
    [
      features,
      expandedMilestoneId,
      handleToggle,
      handleMilestonePress,
      handleFeaturePress,
    ],
  );

  const keyExtractor = React.useCallback(
    (item: RoadmapMilestone) => item.id,
    [],
  );

  const handleAdd = React.useCallback(() => {
    router.push("/roadmap/milestone/new");
  }, [router]);

  // Loading state
  if (!isLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
      </View>
    );
  }

  // Empty state
  if (milestones.length === 0) {
    return <RoadmapEmptyState onAdd={handleAdd} />;
  }

  return (
    <View
      style={[
        styles.outerContainer,
        { backgroundColor: theme.colors.groupped.background },
      ]}
    >
      <View style={styles.container}>
        <FlatList
          data={milestones}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create(() => ({
  outerContainer: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
  },
  container: {
    flex: 1,
    maxWidth: layout.maxWidth,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    paddingVertical: 4,
    paddingBottom: 24,
  },
}));
