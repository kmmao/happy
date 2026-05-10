import * as React from "react";
import { useLocalSearchParams } from "expo-router";
import { WorldShell } from "@/components/world/WorldShell";
import type { WorldFilter } from "@/components/world/worldTypes";

export default React.memo(function WorldScreen() {
    const params = useLocalSearchParams<{ projectId?: string; machineId?: string }>();

    const initialFilter = React.useMemo((): WorldFilter => {
        if (params.projectId) return { projectId: params.projectId };
        if (params.machineId) return { machineId: params.machineId };
        return {};
    }, [params.projectId, params.machineId]);

    return <WorldShell initialFilter={initialFilter} />;
});
