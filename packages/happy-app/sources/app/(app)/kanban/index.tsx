import * as React from "react";
import { KanbanViewWrapper } from "@/components/kanban/KanbanView";

/**
 * Standalone kanban page route.
 * The primary kanban view is rendered in the tab via MainView,
 * but this route exists for deep-linking and navigation.
 */
const KanbanPage = React.memo(() => {
    return <KanbanViewWrapper />;
});

export default KanbanPage;
