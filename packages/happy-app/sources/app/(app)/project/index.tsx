import * as React from "react";
import { ProjectListView } from "@/components/project/ProjectListView";

function ProjectIndexScreen() {
    return <ProjectListView />;
}

export default React.memo(ProjectIndexScreen);
