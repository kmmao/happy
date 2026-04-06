/**
 * Project Management System
 * Groups sessions by machine ID and path to create project entities.
 * Hybrid mode: in-memory cache + optional server-side persistence.
 */

import { Session, MachineMetadata, GitStatus } from "./storageTypes";
import { ServerProject } from "./apiProjects";

/**
 * Unique project identifier based on machine ID and path
 */
export interface ProjectKey {
  machineId: string;
  path: string;
}

/**
 * Git submodule info: path + standard GitStatus
 */
export interface SubmoduleInfo {
  /** Relative path from project root (e.g. "vendor/lib") */
  path: string;
  /** Git status for this submodule (null if not initialized) */
  gitStatus: GitStatus | null;
}

/**
 * Project entity that groups sessions by location
 */
export interface Project {
  /** Unique internal ID (not stable between app restarts) */
  id: string;
  /** Server-side persistent ID (null if not yet synced) */
  serverId?: string | null;
  /** Project identifier */
  key: ProjectKey;
  /** List of active session IDs in this project */
  sessionIds: string[];
  /** Optional machine metadata */
  machineMetadata?: MachineMetadata | null;
  /** Git status for this project (shared across all sessions) */
  gitStatus?: GitStatus | null;
  /** Timestamp when git status was last updated */
  lastGitStatusUpdate?: number;
  /** Git submodules (undefined=not checked, []=no submodules) */
  submodules?: SubmoduleInfo[];
  /** Timestamp when submodule status was last updated */
  submodulesLastUpdatedAt?: number;
  /** Whether the project is archived on the server */
  archived?: boolean;
  /** Server-side encrypted metadata */
  serverMetadata?: string | null;
  /** Server-side metadata version */
  serverMetadataVersion?: number;
  /** Supervisor config JSON (encrypted on server) */
  supervisorConfig?: string | null;
  /** Supervisor config version */
  supervisorConfigVersion?: number;
  /** Supervisor mode (plaintext, synced from server) */
  supervisorMode?: string | null;
  /** Whether scheduled scanning is enabled */
  supervisorScheduleEnabled?: boolean;
  /** Schedule interval in hours */
  supervisorScheduleIntervalHours?: number | null;
  /** Comma-separated enabled analysis dimensions */
  supervisorEnabledDimensions?: string | null;
  /** Whether push-triggered incremental scans are enabled */
  supervisorPushTriggerEnabled?: boolean;
  /** User-defined custom analysis rules */
  supervisorCustomRules?: string | null;
  /** Project narrative / vision (World Model) */
  narrative?: string | null;
  /** Project laws JSON array (World Model) */
  laws?: string | null;
  /** Project creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * In-memory project manager
 */
class ProjectManager {
  private projects: Map<string, Project> = new Map();
  private projectKeyToId: Map<string, string> = new Map();
  private sessionToProject: Map<string, string> = new Map();
  private nextProjectId = 1;

  /**
   * Generate a unique key string from machine ID and path
   */
  private getProjectKeyString(key: ProjectKey): string {
    return `${key.machineId}:${key.path}`;
  }

  /**
   * Generate a new unique project ID
   */
  private generateProjectId(): string {
    return `project_${this.nextProjectId++}`;
  }

  /**
   * Get or create a project for the given key
   */
  private getOrCreateProject(
    key: ProjectKey,
    machineMetadata?: MachineMetadata | null,
  ): Project {
    const keyString = this.getProjectKeyString(key);
    let projectId = this.projectKeyToId.get(keyString);

    if (!projectId) {
      // Create new project
      projectId = this.generateProjectId();
      const now = Date.now();

      const project: Project = {
        id: projectId,
        key,
        sessionIds: [],
        machineMetadata,
        createdAt: now,
        updatedAt: now,
      };

      this.projects.set(projectId, project);
      this.projectKeyToId.set(keyString, projectId);

      return project;
    }

    const project = this.projects.get(projectId)!;

    // Update machine metadata if provided and different
    if (machineMetadata && project.machineMetadata !== machineMetadata) {
      project.machineMetadata = machineMetadata;
      project.updatedAt = Date.now();
    }

    return project;
  }

  /**
   * Add or update a session in the project system
   */
  addSession(session: Session, machineMetadata?: MachineMetadata | null): void {
    // Session must have metadata with machineId and path
    if (!session.metadata?.machineId || !session.metadata?.path) {
      return;
    }

    const projectKey: ProjectKey = {
      machineId: session.metadata.machineId,
      // Worktree sessions belong to the parent project, not the worktree path
      path: session.metadata.worktree?.parentRepoPath || session.metadata.path,
    };

    const project = this.getOrCreateProject(projectKey, machineMetadata);

    // Remove session from previous project if it was in one
    const previousProjectId = this.sessionToProject.get(session.id);
    if (previousProjectId && previousProjectId !== project.id) {
      const previousProject = this.projects.get(previousProjectId);
      if (previousProject) {
        const index = previousProject.sessionIds.indexOf(session.id);
        if (index !== -1) {
          previousProject.sessionIds.splice(index, 1);
          previousProject.updatedAt = Date.now();

          // Remove empty projects only if they have no server backing
          if (previousProject.sessionIds.length === 0 && !previousProject.serverId) {
            this.removeProject(previousProjectId);
          }
        }
      }
    }

    // Add session to new project if not already there
    if (!project.sessionIds.includes(session.id)) {
      project.sessionIds.push(session.id);
      project.updatedAt = Date.now();
    }

    this.sessionToProject.set(session.id, project.id);
  }

  /**
   * Remove a session from the project system
   */
  removeSession(sessionId: string): void {
    const projectId = this.sessionToProject.get(sessionId);
    if (!projectId) {
      return;
    }

    const project = this.projects.get(projectId);
    if (!project) {
      this.sessionToProject.delete(sessionId);
      return;
    }

    // Remove session from project
    const index = project.sessionIds.indexOf(sessionId);
    if (index !== -1) {
      project.sessionIds.splice(index, 1);
      project.updatedAt = Date.now();
    }

    this.sessionToProject.delete(sessionId);

    // Remove empty projects only if they have no server backing
    if (project.sessionIds.length === 0 && !project.serverId) {
      this.removeProject(projectId);
    }
  }

  /**
   * Remove a project completely
   */
  private removeProject(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project) {
      return;
    }

    // Clean up all references
    const keyString = this.getProjectKeyString(project.key);
    this.projectKeyToId.delete(keyString);
    this.projects.delete(projectId);

    // Remove session mappings
    for (const sessionId of project.sessionIds) {
      this.sessionToProject.delete(sessionId);
    }
  }

  /**
   * Get all projects
   */
  getProjects(): Project[] {
    return Array.from(this.projects.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    ); // Most recently updated first
  }

  /**
   * Get project by ID
   */
  getProject(projectId: string): Project | null {
    return this.projects.get(projectId) || null;
  }

  /**
   * Get project for a session
   */
  getProjectForSession(sessionId: string): Project | null {
    const projectId = this.sessionToProject.get(sessionId);
    if (!projectId) {
      return null;
    }
    return this.projects.get(projectId) || null;
  }

  /**
   * Get sessions for a project
   */
  getProjectSessions(projectId: string): string[] {
    const project = this.projects.get(projectId);
    return project ? [...project.sessionIds] : [];
  }

  /**
   * Update multiple sessions at once (for bulk operations)
   */
  updateSessions(
    sessions: Session[],
    machineMetadataMap?: Map<string, MachineMetadata>,
  ): void {
    // Track which sessions are still active
    const activeSessionIds = new Set(sessions.map((s) => s.id));

    // Remove sessions that are no longer in the list
    const currentSessionIds = new Set(this.sessionToProject.keys());
    for (const sessionId of currentSessionIds) {
      if (!activeSessionIds.has(sessionId)) {
        this.removeSession(sessionId);
      }
    }

    // Add or update all current sessions
    for (const session of sessions) {
      const machineMetadata = session.metadata?.machineId
        ? machineMetadataMap?.get(session.metadata.machineId)
        : undefined;
      this.addSession(session, machineMetadata);
    }
  }

  /**
   * Update git status for a project (identified by project key)
   */
  updateProjectGitStatus(
    projectKey: ProjectKey,
    gitStatus: GitStatus | null,
  ): void {
    const keyString = this.getProjectKeyString(projectKey);
    const projectId = this.projectKeyToId.get(keyString);

    if (!projectId) {
      // No project exists for this key, skip update
      return;
    }

    const project = this.projects.get(projectId);
    if (!project) {
      return;
    }

    // Update git status and timestamp
    project.gitStatus = gitStatus;
    project.lastGitStatusUpdate = Date.now();
    project.updatedAt = Date.now();
  }

  /**
   * Update git status for a project (identified by project ID)
   */
  updateProjectGitStatusById(
    projectId: string,
    gitStatus: GitStatus | null,
  ): void {
    const project = this.projects.get(projectId);
    if (!project) {
      return;
    }

    project.gitStatus = gitStatus;
    project.lastGitStatusUpdate = Date.now();
    project.updatedAt = Date.now();
  }

  /**
   * Get git status for a project
   */
  getProjectGitStatus(projectId: string): GitStatus | null {
    const project = this.projects.get(projectId);
    return project?.gitStatus || null;
  }

  /**
   * Clear git status for a project
   */
  clearProjectGitStatus(projectId: string): void {
    const project = this.projects.get(projectId);
    if (project) {
      project.gitStatus = null;
      project.lastGitStatusUpdate = Date.now();
      project.updatedAt = Date.now();
    }
  }

  /**
   * Get git status for a session via its project
   */
  getSessionProjectGitStatus(sessionId: string): GitStatus | null {
    const project = this.getProjectForSession(sessionId);
    return project?.gitStatus || null;
  }

  /**
   * Update git status for a session's project
   */
  updateSessionProjectGitStatus(
    sessionId: string,
    gitStatus: GitStatus | null,
  ): void {
    const project = this.getProjectForSession(sessionId);
    if (project) {
      this.updateProjectGitStatusById(project.id, gitStatus);
    }
  }

  /**
   * Update submodule statuses for a project (identified by project key)
   */
  updateProjectSubmodules(
    projectKey: ProjectKey,
    submodules: SubmoduleInfo[],
  ): void {
    const keyString = this.getProjectKeyString(projectKey);
    const projectId = this.projectKeyToId.get(keyString);

    if (!projectId) {
      return;
    }

    const project = this.projects.get(projectId);
    if (!project) {
      return;
    }

    project.submodules = submodules;
    project.submodulesLastUpdatedAt = Date.now();
    project.updatedAt = Date.now();
  }

  /**
   * Clear the submodule refresh throttle so the next refresh is immediate.
   * Used after git remote operations (fetch/pull/push) to ensure fresh data.
   */
  clearSubmodulesLastUpdated(projectKey: ProjectKey): void {
    const keyString = this.getProjectKeyString(projectKey);
    const projectId = this.projectKeyToId.get(keyString);
    if (!projectId) return;

    const project = this.projects.get(projectId);
    if (!project) return;

    project.submodulesLastUpdatedAt = undefined;
  }

  /**
   * Get submodule statuses for a project
   */
  getProjectSubmodules(projectId: string): SubmoduleInfo[] | undefined {
    const project = this.projects.get(projectId);
    return project?.submodules;
  }

  /**
   * Get submodule statuses for a session via its project
   */
  getSessionProjectSubmodules(sessionId: string): SubmoduleInfo[] | undefined {
    const project = this.getProjectForSession(sessionId);
    return project?.submodules;
  }

  /**
   * Delete a project by its internal ID (for manual deletion).
   * Returns true if the project was found and removed.
   */
  deleteProjectById(projectId: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) {
      return false;
    }

    // Clean up all references
    const keyString = this.getProjectKeyString(project.key);
    this.projectKeyToId.delete(keyString);
    this.projects.delete(projectId);

    // Remove session mappings
    for (const sessionId of project.sessionIds) {
      this.sessionToProject.delete(sessionId);
    }

    return true;
  }

  /**
   * Add a manually created project from a server response.
   * Returns the new or existing Project object.
   */
  addManualProject(serverProject: ServerProject): Project {
    const key: ProjectKey = {
      machineId: serverProject.machineId,
      path: serverProject.path,
    };
    const keyString = this.getProjectKeyString(key);
    const existingId = this.projectKeyToId.get(keyString);

    if (existingId) {
      const existing = this.projects.get(existingId)!;
      existing.serverId = serverProject.id;
      existing.archived = serverProject.archived;
      existing.serverMetadata = serverProject.metadata;
      existing.serverMetadataVersion = serverProject.metadataVersion;
      existing.supervisorConfig = serverProject.supervisorConfig;
      existing.supervisorConfigVersion = serverProject.supervisorConfigVersion;
      existing.supervisorMode = serverProject.supervisorMode;
      existing.supervisorScheduleEnabled = serverProject.supervisorScheduleEnabled;
      existing.supervisorScheduleIntervalHours = serverProject.supervisorScheduleIntervalHours;
      existing.supervisorEnabledDimensions = serverProject.supervisorEnabledDimensions;
      existing.supervisorPushTriggerEnabled = serverProject.supervisorPushTriggerEnabled;
      existing.supervisorCustomRules = serverProject.supervisorCustomRules;
      existing.narrative = serverProject.narrative;
      existing.laws = serverProject.laws;
      existing.updatedAt = Date.now();
      return existing;
    }

    const projectId = this.generateProjectId();
    const project: Project = {
      id: projectId,
      serverId: serverProject.id,
      key,
      sessionIds: [],
      archived: serverProject.archived,
      serverMetadata: serverProject.metadata,
      serverMetadataVersion: serverProject.metadataVersion,
      supervisorConfig: serverProject.supervisorConfig,
      supervisorConfigVersion: serverProject.supervisorConfigVersion,
      supervisorMode: serverProject.supervisorMode,
      supervisorScheduleEnabled: serverProject.supervisorScheduleEnabled,
      supervisorScheduleIntervalHours: serverProject.supervisorScheduleIntervalHours,
      supervisorEnabledDimensions: serverProject.supervisorEnabledDimensions,
      supervisorPushTriggerEnabled: serverProject.supervisorPushTriggerEnabled,
      supervisorCustomRules: serverProject.supervisorCustomRules,
      narrative: serverProject.narrative,
      laws: serverProject.laws,
      createdAt: serverProject.createdAt,
      updatedAt: serverProject.updatedAt,
    };

    this.projects.set(projectId, project);
    this.projectKeyToId.set(keyString, projectId);

    return project;
  }

  /**
   * Clear all projects (useful for testing or resetting state)
   */
  clear(): void {
    this.projects.clear();
    this.projectKeyToId.clear();
    this.sessionToProject.clear();
    this.nextProjectId = 1;
  }

  /**
   * Get statistics about the project system
   */
  getStats(): {
    projectCount: number;
    sessionCount: number;
    avgSessionsPerProject: number;
  } {
    const projectCount = this.projects.size;
    const sessionCount = this.sessionToProject.size;
    const avgSessionsPerProject =
      projectCount > 0 ? sessionCount / projectCount : 0;

    return {
      projectCount,
      sessionCount,
      avgSessionsPerProject: Math.round(avgSessionsPerProject * 100) / 100,
    };
  }

  // === Server Sync Methods ===

  /**
   * Merge server projects into the in-memory cache.
   * Server projects without matching local sessions are kept as "server-only"
   * so they appear in the project list even with 0 active sessions.
   */
  mergeServerProjects(serverProjects: ServerProject[]): void {
    for (const sp of serverProjects) {
      // Skip worktree-path projects — these should belong to the parent project
      if (sp.path.includes(".dev/worktree/")) {
        continue;
      }

      const keyString = this.getProjectKeyString({
        machineId: sp.machineId,
        path: sp.path,
      });
      const existingId = this.projectKeyToId.get(keyString);

      if (existingId) {
        // Merge server data into existing in-memory project
        const project = this.projects.get(existingId);
        if (project) {
          project.serverId = sp.id;
          project.archived = sp.archived;
          project.serverMetadata = sp.metadata;
          project.serverMetadataVersion = sp.metadataVersion;
          project.supervisorConfig = sp.supervisorConfig;
          project.supervisorConfigVersion = sp.supervisorConfigVersion;
          project.supervisorMode = sp.supervisorMode;
          project.supervisorScheduleEnabled = sp.supervisorScheduleEnabled;
          project.supervisorScheduleIntervalHours = sp.supervisorScheduleIntervalHours;
          project.supervisorEnabledDimensions = sp.supervisorEnabledDimensions;
          project.supervisorPushTriggerEnabled = sp.supervisorPushTriggerEnabled;
          project.supervisorCustomRules = sp.supervisorCustomRules;
          project.narrative = sp.narrative;
          project.laws = sp.laws;
        }
      } else {
        // Server-only project (no active sessions locally)
        const projectId = this.generateProjectId();
        const project: Project = {
          id: projectId,
          serverId: sp.id,
          key: { machineId: sp.machineId, path: sp.path },
          sessionIds: [],
          archived: sp.archived,
          serverMetadata: sp.metadata,
          serverMetadataVersion: sp.metadataVersion,
          supervisorConfig: sp.supervisorConfig,
          supervisorConfigVersion: sp.supervisorConfigVersion,
          supervisorMode: sp.supervisorMode,
          supervisorScheduleEnabled: sp.supervisorScheduleEnabled,
          supervisorScheduleIntervalHours: sp.supervisorScheduleIntervalHours,
          supervisorEnabledDimensions: sp.supervisorEnabledDimensions,
          supervisorPushTriggerEnabled: sp.supervisorPushTriggerEnabled,
          supervisorCustomRules: sp.supervisorCustomRules,
          narrative: sp.narrative,
          laws: sp.laws,
          createdAt: sp.createdAt,
          updatedAt: sp.updatedAt,
        };
        this.projects.set(projectId, project);
        this.projectKeyToId.set(keyString, projectId);
      }
    }
  }

  /**
   * Get all projects that need to be synced to the server
   * (have sessions but no serverId)
   */
  getUnsyncedProjects(): Project[] {
    return Array.from(this.projects.values()).filter(
      (p) => !p.serverId && p.sessionIds.length > 0,
    );
  }

  /**
   * Set the server ID for a project identified by its key
   */
  setServerId(key: ProjectKey, serverId: string): void {
    const keyString = this.getProjectKeyString(key);
    const projectId = this.projectKeyToId.get(keyString);
    if (!projectId) return;

    const project = this.projects.get(projectId);
    if (project) {
      project.serverId = serverId;
    }
  }

  /**
   * Get project by server ID
   */
  getProjectByServerId(serverId: string): Project | null {
    for (const project of this.projects.values()) {
      if (project.serverId === serverId) {
        return project;
      }
    }
    return null;
  }

  /**
   * Check if any projects need migration (have sessions but no server ID)
   */
  needsMigration(): boolean {
    return this.getUnsyncedProjects().length > 0;
  }
}

// Singleton instance
export const projectManager = new ProjectManager();

/**
 * Helper function to create a project key
 */
export function createProjectKey(machineId: string, path: string): ProjectKey {
  return { machineId, path };
}

/**
 * Helper function to get project display name
 */
export function getProjectDisplayName(project: Project): string {
  // Prefer alias from serverMetadata
  if (project.serverMetadata) {
    try {
      const meta = JSON.parse(project.serverMetadata);
      if (meta.alias) return meta.alias;
    } catch {
      // ignore parse errors
    }
  }

  // Try to extract folder name from path
  const pathParts = project.key.path.split("/").filter(Boolean);
  const folderName = pathParts[pathParts.length - 1];

  if (folderName) {
    return folderName;
  }

  // Fallback to path
  return project.key.path || "Unknown Project";
}

/**
 * Helper function to get project full path display
 */
export function getProjectFullPath(project: Project): string {
  const machineName =
    project.machineMetadata?.displayName ||
    project.machineMetadata?.host ||
    project.key.machineId;
  return `${machineName}: ${project.key.path}`;
}
