/**
 * Reactive hook for project list.
 * Subscribes to the zustand session store so that
 * project list updates whenever sessions change.
 *
 * projectManager mutates Project objects in-place, so we must return
 * shallow copies to break reference equality and trigger React.memo
 * re-renders in child components (e.g. ProjectGitTab).
 */

import * as React from "react";
import { storage } from "@/sync/storage";
import { projectManager, Project } from "@/sync/projectManager";

/**
 * Returns the current list of projects sorted by most recently updated.
 * Re-renders when sessions change, projects are manually added/deleted,
 * or git status updates.
 */
export function useProjects(): Project[] {
    // Subscribe to session changes as a trigger for re-render
    const sessions = storage((s) => s.sessions);
    // Subscribe to manual project changes (add/delete)
    const projectVersion = storage((s) => s.projectVersion);
    // Subscribe to git status changes so project.gitStatus is reactive
    const sessionGitStatus = storage((s) => s.sessionGitStatus);

    return React.useMemo(() => {
        // Shallow-copy each project so React.memo children see new references
        return projectManager.getProjects().map((p) => ({ ...p }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessions, projectVersion, sessionGitStatus]);
}

/**
 * Returns a single project by ID, or null if not found.
 */
export function useProject(projectId: string): Project | null {
    const sessions = storage((s) => s.sessions);
    const projectVersion = storage((s) => s.projectVersion);
    // Subscribe to git status changes so project.gitStatus is reactive
    const sessionGitStatus = storage((s) => s.sessionGitStatus);

    return React.useMemo(() => {
        const project = projectManager.getProject(projectId);
        // Shallow-copy so React.memo children see a new reference
        return project ? { ...project } : null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, sessions, projectVersion, sessionGitStatus]);
}
