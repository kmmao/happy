import * as React from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  ProjectSegmentControl,
  type ProjectSegment,
} from "./ProjectSegmentControl";
import { KanbanViewWrapper } from "@/components/kanban/KanbanView";
import { IdeationView } from "@/components/ideation/IdeationView";
import { RoadmapView } from "@/components/roadmap/RoadmapView";

/** Current segment, shared with HeaderRight via getter */
let currentSegment: ProjectSegment = "board";
export function getProjectSegment(): ProjectSegment {
  return currentSegment;
}

/**
 * Project tab container with segment control.
 * Switches between Ideas / Board / Roadmap views.
 */
export const ProjectView = React.memo(() => {
  const [segment, setSegment] = React.useState<ProjectSegment>("board");

  const handleSegmentChange = React.useCallback((seg: ProjectSegment) => {
    currentSegment = seg;
    setSegment(seg);
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
