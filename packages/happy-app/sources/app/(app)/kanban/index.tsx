import * as React from "react";
import { ProjectView } from "@/components/project/ProjectView";

/**
 * Project page route.
 * On phone, the primary project view is rendered in the tab via MainView.
 * On tablet/web, this route is used from the sidebar project icon.
 */
const ProjectPage = React.memo(() => {
  return <ProjectView />;
});

export default ProjectPage;
