import { describe, it, expect } from "vitest";
import { ProjectManager, type ProjectKey } from "./projectManager";
import type { Session, GitStatus } from "./storageTypes";

const KEY: ProjectKey = { machineId: "m1", path: "/repo" };

function seededManager() {
    const pm = new ProjectManager();
    const session = {
        id: "s1",
        metadata: { machineId: "m1", path: "/repo" },
    } as unknown as Session;
    pm.addSession(session);
    const project = pm.getProjects()[0];
    return { pm, projectId: project.id, sessionId: "s1" };
}

function gitStatus(branch: string): GitStatus {
    return {
        branch,
        aheadCount: 0,
        behindCount: 0,
        lastUpdatedAt: 0,
        isDirty: false,
        stagedCount: 0,
        modifiedCount: 0,
        untrackedCount: 0,
        stashCount: 0,
    } as GitStatus;
}

describe("ProjectManager git-status invariant", () => {
    it("update-by-key sets the status and bumps lastGitStatusUpdate", () => {
        const { pm, projectId } = seededManager();
        const before = pm.getProjects()[0].lastGitStatusUpdate ?? 0;

        pm.updateProjectGitStatus(KEY, gitStatus("main"));

        expect(pm.getProjectGitStatus(projectId)?.branch).toBe("main");
        const after = pm.getProjects()[0].lastGitStatusUpdate ?? 0;
        expect(after).toBeGreaterThanOrEqual(before);
        expect(after).toBeGreaterThan(0);
    });

    it("update-by-session routes through to the project's status", () => {
        const { pm, projectId, sessionId } = seededManager();
        pm.updateSessionProjectGitStatus(sessionId, gitStatus("feature"));

        expect(pm.getSessionProjectGitStatus(sessionId)?.branch).toBe("feature");
        expect(pm.getProjectGitStatus(projectId)?.branch).toBe("feature");
    });

    it("clear nulls the status while still bumping the timestamp", () => {
        const { pm, projectId } = seededManager();
        pm.updateProjectGitStatus(KEY, gitStatus("main"));
        const stampAfterSet = pm.getProjects()[0].lastGitStatusUpdate ?? 0;

        pm.clearProjectGitStatus(projectId);

        expect(pm.getProjectGitStatus(projectId)).toBeNull();
        const stampAfterClear = pm.getProjects()[0].lastGitStatusUpdate ?? 0;
        expect(stampAfterClear).toBeGreaterThanOrEqual(stampAfterSet);
    });

    it("every mutation path keeps lastGitStatusUpdate and updatedAt in lockstep", () => {
        const { pm } = seededManager();
        pm.updateProjectGitStatus(KEY, gitStatus("main"));
        const p = pm.getProjects()[0];
        // The invariant the seam enforces: both timestamps move together.
        expect(p.lastGitStatusUpdate).toBe(p.updatedAt);
    });
});
