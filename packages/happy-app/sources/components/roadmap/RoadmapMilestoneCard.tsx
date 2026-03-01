import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import {
  type RoadmapMilestone,
  type RoadmapFeature,
  featuresForMilestone,
  milestoneProgress,
} from "@/sync/roadmapTypes";
import { RoadmapProgressBar } from "./RoadmapProgressBar";
import { RoadmapFeatureItem } from "./RoadmapFeatureItem";

interface RoadmapMilestoneCardProps {
  milestone: RoadmapMilestone;
  features: ReadonlyArray<RoadmapFeature>;
  isExpanded: boolean;
  onToggle: (milestoneId: string) => void;
  onMilestonePress: (milestoneId: string) => void;
  onFeaturePress: (featureId: string) => void;
}

export const RoadmapMilestoneCard = React.memo(
  ({
    milestone,
    features,
    isExpanded,
    onToggle,
    onMilestonePress,
    onFeaturePress,
  }: RoadmapMilestoneCardProps) => {
    const { theme } = useUnistyles();

    const milestoneFeatures = React.useMemo(
      () => featuresForMilestone(features, milestone.id),
      [features, milestone.id],
    );

    const progress = React.useMemo(
      () => milestoneProgress(features, milestone.id),
      [features, milestone.id],
    );

    const targetDateStr = React.useMemo(() => {
      if (!milestone.targetDate) return null;
      return new Date(milestone.targetDate).toLocaleDateString();
    }, [milestone.targetDate]);

    return (
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        {/* Header row: toggle + title + edit */}
        <Pressable
          onPress={() => onToggle(milestone.id)}
          accessibilityRole="button"
          accessibilityLabel={milestone.title}
          accessibilityState={{ expanded: isExpanded }}
          style={({ pressed }) => [styles.header, pressed && { opacity: 0.7 }]}
        >
          <Ionicons
            name={isExpanded ? "chevron-down" : "chevron-forward"}
            size={18}
            color={theme.colors.textSecondary}
          />
          <View style={styles.headerContent}>
            <Text
              style={[styles.title, { color: theme.colors.text }]}
              numberOfLines={1}
            >
              {milestone.title}
            </Text>
            {targetDateStr && (
              <Text
                style={[
                  styles.targetDate,
                  {
                    color: theme.colors.textSecondary,
                  },
                ]}
              >
                {targetDateStr}
              </Text>
            )}
          </View>
          <Pressable
            onPress={() => onMilestonePress(milestone.id)}
            accessibilityRole="button"
            accessibilityLabel={t("roadmap.milestoneOptions")}
            hitSlop={10}
            style={styles.editButton}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={18}
              color={theme.colors.textSecondary}
            />
          </Pressable>
        </Pressable>

        {/* Progress bar */}
        <View style={styles.progressRow}>
          <RoadmapProgressBar
            completed={progress.completed}
            total={progress.total}
          />
        </View>

        {/* Expanded feature list */}
        {isExpanded && (
          <View style={styles.featureList}>
            <View
              style={[
                styles.featureDivider,
                {
                  backgroundColor: theme.colors.divider,
                },
              ]}
            />
            {milestoneFeatures.length === 0 ? (
              <Text
                style={[
                  styles.noFeatures,
                  {
                    color: theme.colors.textSecondary,
                  },
                ]}
              >
                {t("roadmap.noFeatures")}
              </Text>
            ) : (
              milestoneFeatures.map((feature, idx) => (
                <RoadmapFeatureItem
                  key={feature.id}
                  feature={feature}
                  onPress={onFeaturePress}
                  showDivider={idx !== milestoneFeatures.length - 1}
                />
              ))
            )}
          </View>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create(() => ({
  card: {
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 8,
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    ...Typography.default("semiBold"),
  },
  targetDate: {
    fontSize: 12,
    marginTop: 2,
    ...Typography.default(),
  },
  editButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  progressRow: {
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  featureList: {
    paddingBottom: 4,
  },
  featureDivider: {
    height: 0.5,
    marginHorizontal: 14,
  },
  noFeatures: {
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 16,
    ...Typography.default(),
  },
}));
