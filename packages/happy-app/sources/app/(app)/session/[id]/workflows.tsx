/**
 * Dynamic Workflows viewer route (Phase 5). Thin wrapper around WorkflowsView,
 * which is also embedded in the project detail "Workflows" tab.
 *
 * Route: /session/{id}/workflows
 */
import * as React from "react";
import { useLocalSearchParams } from "expo-router";
import { WorkflowsView } from "@/components/workflow/WorkflowsView";

export default React.memo(function WorkflowsPage() {
    const { id: sessionId } = useLocalSearchParams<{ id: string }>();
    return <WorkflowsView sessionId={sessionId} />;
});
