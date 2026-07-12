/**
 * Project detail "Workflows" tab (Phase 5).
 *
 * Dynamic Workflows are project-scoped (persisted under `<project>/.happy/
 * workflows/`), so their natural home is the project — not a single session.
 * Reading/triggering them still needs a live session RPC channel, so this tab
 * routes through the project's active session; when none is online it prompts
 * the user to start one.
 */
import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { Project } from "@/sync/projectManager";
import { storage } from "@/sync/storage";
import { WorkflowsView } from "@/components/workflow/WorkflowsView";
import { t } from "@/text";

export const ProjectWorkflowsTab = React.memo<{ project: Project }>(({ project }) => {
    const sessions = storage.getState().sessions;
    const activeSessionId = project.sessionIds.find((id) => sessions[id]?.active);

    if (!activeSessionId) {
        return (
            <View style={styles.center}>
                <Text style={styles.empty}>{t("dynamicWorkflows.noSession")}</Text>
            </View>
        );
    }

    return <WorkflowsView sessionId={activeSessionId} />;
});

const styles = StyleSheet.create((theme) => ({
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    empty: { color: theme.colors.textSecondary, textAlign: "center" },
}));
