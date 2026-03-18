/**
 * Reactive hook for project list.
 * Subscribes to the zustand session store so that
 * project list updates whenever sessions change.
 */

import * as React from "react";
import { storage } from "@/sync/storage";
import { projectManager, Project } from "@/sync/projectManager";

/**
 * Returns the current list of projects sorted by most recently updated.
 * Re-renders when sessions change or when projects are manually added/deleted.
 */
export function useProjects(): Project[] {
    // Subscribe to session changes as a trigger for re-render
    const sessions = storage((s) => s.sessions);
    // Subscribe to manual project changes (add/delete)
    const projectVersion = storage((s) => s.projectVersion);

    return React.useMemo(() => {
        // projectManager is already kept in sync by sync.ts
        return projectManager.getProjects();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessions, projectVersion]);
}

/**
 * Returns a single project by ID, or null if not found.
 */
export function useProject(projectId: string): Project | null {
    const sessions = storage((s) => s.sessions);
    const projectVersion = storage((s) => s.projectVersion);

    return React.useMemo(() => {
        return projectManager.getProject(projectId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, sessions, projectVersion]);
}
