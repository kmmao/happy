/**
 * Safe remote file viewer using the claude-control `read_file` RPC.
 *
 * Unlike `session/[id]/file.tsx` (which reads via `sessionReadFile` without
 * the Read-tool permission + blacklist enforcement), this page goes through
 * the CLI safety layer: path blacklist, SDK permission gating, 1 MiB cap.
 *
 * Route: /session/{id}/file-viewer?path={path}
 */

import * as React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FileViewer } from "@/components/claudeControl/FileViewer";

export default React.memo(function FileViewerPage() {
    const { id: sessionId, path } = useLocalSearchParams<{
        id: string;
        path: string;
    }>();
    const router = useRouter();

    const onClose = React.useCallback(() => {
        router.back();
    }, [router]);

    if (!sessionId || !path) {
        return <View style={{ flex: 1 }} />;
    }

    return (
        <FileViewer
            sessionId={sessionId}
            path={path}
            onClose={onClose}
        />
    );
});
