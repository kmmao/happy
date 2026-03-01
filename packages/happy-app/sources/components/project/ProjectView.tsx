import * as React from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { create } from "zustand";
import {
  ProjectSegmentControl,
  type ProjectSegment,
} from "./ProjectSegmentControl";
import { KanbanViewWrapper } from "@/components/kanban/KanbanView";
import { IdeationView } from "@/components/ideation/IdeationView";
import { RoadmapView } from "@/components/roadmap/RoadmapView";

/** Tiny store to share current segment with HeaderRight imperatively */
const projectSegmentStore = create<{ segment: ProjectSegment }>(() => ({
  segment: "board",
}));

export function getProjectSegment(): ProjectSegment {
  return projectSegmentStore.getState().segment;
}

/**
 * Project tab container with segment control.
 * Switches between Ideas / Board / Roadmap views.
 */
export const ProjectView = React.memo(() => {
  const segment = projectSegmentStore((s) => s.segment);

  const handleSegmentChange = React.useCallback((seg: ProjectSegment) => {
    projectSegmentStore.setState({ segment: seg });
  }, []);

  return (
    <View style={styles.container}>
      <ProjectSegmentControl active={segment} onSelect={handleSegmentChange} />
      {segment === "ideas" && <IdeationView />}
      {segment === "board" && <KanbanViewWrapper />}
      {segment === "roadmap" && <RoadmapView />}
    </View>
  );
});

const styles = StyleSheet.create(() => ({
  container: {
    flex: 1,
  },
}));
