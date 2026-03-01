import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import {
  type RoadmapFeature,
  type RoadmapFeatureStatus,
  type RoadmapMoscow,
  ROADMAP_FEATURE_STATUS_LABELS,
  ROADMAP_MOSCOW_LABELS,
} from "@/sync/roadmapTypes";

interface RoadmapFeatureItemProps {
  feature: RoadmapFeature;
  onPress: (featureId: string) => void;
  showDivider?: boolean;
}

const STATUS_ICONS: Record<RoadmapFeatureStatus, string> = {
  planned: "time-outline",
  in_progress: "play-circle-outline",
  completed: "checkmark-circle",
  cancelled: "close-circle-outline",
};

const STATUS_COLORS: Record<RoadmapFeatureStatus, string> = {
  planned: "#6B7280",
  in_progress: "#3B82F6",
  completed: "#10B981",
  cancelled: "#9CA3AF",
};

const MOSCOW_COLORS: Record<RoadmapMoscow, string> = {
  must_have: "#EF4444",
  should_have: "#F59E0B",
  could_have: "#3B82F6",
  wont_have: "#6B7280",
};

export const RoadmapFeatureItem = React.memo(
  ({ feature, onPress, showDivider = true }: RoadmapFeatureItemProps) => {
    const { theme } = useUnistyles();
    const statusColor = STATUS_COLORS[feature.status];
    const moscowColor = MOSCOW_COLORS[feature.moscow];
    const dimmed =
      feature.status === "completed" || feature.status === "cancelled";

    return (
      <Pressable
        onPress={() => onPress(feature.id)}
        style={({ pressed }) => [
          styles.container,
          {
            opacity: dimmed ? (pressed ? 0.4 : 0.6) : pressed ? 0.7 : 1,
          },
        ]}
      >
        <View style={styles.row}>
          <Ionicons
            name={
              STATUS_ICONS[feature.status] as keyof typeof Ionicons.glyphMap
            }
            size={16}
            color={statusColor}
          />
          <Text
            style={[styles.title, { color: theme.colors.text }]}
            numberOfLines={1}
          >
            {feature.title}
          </Text>
          <View
            style={[
              styles.moscowBadge,
              {
                backgroundColor: `${moscowColor}20`,
              },
            ]}
          >
            <Text style={[styles.moscowText, { color: moscowColor }]}>
              {t(ROADMAP_MOSCOW_LABELS[feature.moscow])}
            </Text>
          </View>
        </View>
        {showDivider && (
          <View
            style={[
              styles.divider,
              {
                backgroundColor: theme.colors.divider,
              },
            ]}
          />
        )}
      </Pressable>
    );
  },
);

const styles = StyleSheet.create(() => ({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 14,
    ...Typography.default(),
  },
  moscowBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  moscowText: {
    fontSize: 10,
    ...Typography.default("semiBold"),
  },
  divider: {
    height: 0.5,
    marginLeft: 24,
    marginTop: 10,
  },
}));
