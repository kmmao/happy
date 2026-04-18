import * as React from "react";
import { View } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { useProjectForSession, useSession } from "@/sync/storage";
import { SessionKnowledgeSheet } from "@/components/knowledge/SessionKnowledgeSheet";

interface SidePanelSummaryTabProps {
    sessionId: string;
}

/**
 * Knowledge tab body. Renders the inline knowledge view (3 sub-tabs:
 * Changes / References / Archive) occupying the full panel.
 *
 * The previous session meta block (working directory, branch, git status,
 * project, CLI version) has been removed per product direction — the tab is
 * knowledge-only now.
 */
export const SidePanelSummaryTab = React.memo<SidePanelSummaryTabProps>(
    function SidePanelSummaryTab({ sessionId }) {
        const { theme } = useUnistyles();
        const session = useSession(sessionId);
        const project = useProjectForSession(sessionId);
        const projectServerId = project?.serverId ?? undefined;

        if (!session) return null;

        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
                <SessionKnowledgeSheet
                    inline
                    visible
                    onClose={() => undefined}
                    projectServerId={projectServerId}
                    sessionId={sessionId}
                />
            </View>
        );
    },
);
