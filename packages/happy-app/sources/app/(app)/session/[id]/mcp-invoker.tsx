/**
 * Full-screen MCP tool invoker page.
 *
 * Route: /session/{id}/mcp-invoker?tool={tool}
 *
 * Wraps the McpInvoker component using the same pattern as file-viewer.tsx.
 * The optional `tool` search param pre-fills the tool name field.
 */

import * as React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { McpInvoker } from "@/components/claudeControl/McpInvoker";

export default React.memo(function McpInvokerPage() {
    const { id: sessionId, tool } = useLocalSearchParams<{
        id: string;
        tool?: string;
    }>();
    const router = useRouter();

    const onClose = React.useCallback(() => {
        router.back();
    }, [router]);

    if (!sessionId) {
        return <View style={{ flex: 1 }} />;
    }

    return (
        <McpInvoker
            sessionId={sessionId}
            initialTool={tool ?? ""}
            onClose={onClose}
        />
    );
});
