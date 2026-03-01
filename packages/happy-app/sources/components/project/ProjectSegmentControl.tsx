import * as React from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";

export type ProjectSegment = "ideas" | "board" | "roadmap";

const SEGMENTS = [
  { key: "ideas", label: "project.segments.ideas" },
  { key: "board", label: "project.segments.board" },
  { key: "roadmap", label: "project.segments.roadmap" },
] as const;

interface ProjectSegmentControlProps {
  active: ProjectSegment;
  onSelect: (segment: ProjectSegment) => void;
}

export const ProjectSegmentControl = React.memo(
  ({ active, onSelect }: ProjectSegmentControlProps) => {
    const { theme } = useUnistyles();

    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.colors.groupped.background },
        ]}
      >
        <View style={[styles.track, { backgroundColor: theme.colors.surface }]}>
          {SEGMENTS.map((seg) => {
            const isActive = seg.key === active;
            return (
              <Pressable
                key={seg.key}
                onPress={() => onSelect(seg.key)}
                accessibilityRole="tab"
                accessibilityLabel={t(seg.label)}
                accessibilityState={{ selected: isActive }}
                style={[
                  styles.segment,
                  isActive && {
                    backgroundColor: theme.colors.text,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    {
                      color: isActive
                        ? theme.colors.surface
                        : theme.colors.textSecondary,
                    },
                  ]}
                >
                  {t(seg.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create(() => ({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  track: {
    flexDirection: "row",
    borderRadius: 20,
    padding: 3,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 18,
  },
  segmentText: {
    fontSize: 13,
    ...Typography.default("semiBold"),
  },
}));
