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
 * Re-renders when sessions change (which triggers projectManager updates).
 */
export function useProjects(): Project[] {
    // Subscribe to session changes as a trigger for re-render
    const sessions = storage((s) => s.sessions);

    return React.useMemo(() => {
        // projectManager is already kept in sync by sync.ts
        return projectManager.getProjects();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessions]);
}

/**
 * Returns a single project by ID, or null if not found.
 */
export function useProject(projectId: string): Project | null {
    const sessions = storage((s) => s.sessions);

    return React.useMemo(() => {
        return projectManager.getProject(projectId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, sessions]);
}
