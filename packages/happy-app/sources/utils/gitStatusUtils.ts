import { GitStatus } from "@/sync/storageTypes";
import { SubmoduleInfo } from "@/sync/projectManager";

/**
 * Aggregate unstaged line changes from main repo + all submodules
 */
export function aggregateLineChanges(
    gitStatus: GitStatus,
    submodules: SubmoduleInfo[] | undefined,
): { totalAdded: number; totalRemoved: number } {
    let totalAdded = gitStatus.unstagedLinesAdded;
    let totalRemoved = gitStatus.unstagedLinesRemoved;
    if (submodules) {
        for (const sub of submodules) {
            if (sub.gitStatus) {
                totalAdded += sub.gitStatus.unstagedLinesAdded;
                totalRemoved += sub.gitStatus.unstagedLinesRemoved;
            }
        }
    }
    return { totalAdded, totalRemoved };
}

/**
 * Check if main repo or any submodule has meaningful line changes
 */
export function hasMeaningfulLineChanges(
    status: GitStatus,
    submodules: SubmoduleInfo[] | undefined,
): boolean {
    if (
        status.lastUpdatedAt > 0 &&
        status.isDirty &&
        (status.unstagedLinesAdded > 0 || status.unstagedLinesRemoved > 0)
    ) {
        return true;
    }
    if (submodules) {
        for (const sub of submodules) {
            if (
                sub.gitStatus &&
                (sub.gitStatus.unstagedLinesAdded > 0 ||
                    sub.gitStatus.unstagedLinesRemoved > 0)
            ) {
                return true;
            }
        }
    }
    return false;
}
