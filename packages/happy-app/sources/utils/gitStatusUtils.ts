import { GitStatus } from "@/sync/storageTypes";
import { SubmoduleInfo } from "@/sync/projectManager";

// Fields that describe the actual repo state. `lastUpdatedAt` (and the legacy
// `ahead`/`behind`/`hasUncommittedChanges`/`lastCheckedAt` shape) are excluded
// so that an identical-content refresh can reuse the previous object reference.
const GIT_STATUS_CONTENT_KEYS = [
    "branch",
    "upstreamBranch",
    "remoteUrl",
    "aheadCount",
    "behindCount",
    "isDirty",
    "stagedCount",
    "modifiedCount",
    "untrackedCount",
    "stashCount",
    "stagedLinesAdded",
    "stagedLinesRemoved",
    "unstagedLinesAdded",
    "unstagedLinesRemoved",
    "linesAdded",
    "linesRemoved",
    "linesChanged",
] as const satisfies readonly (keyof GitStatus)[];

/**
 * True when two GitStatus objects describe the same repo state. Ignores
 * `lastUpdatedAt` so that a refresh that produced identical content can keep
 * the previous reference and short-circuit downstream useShallow selectors.
 */
export function gitStatusEqualsIgnoringTimestamp(
    a: GitStatus | null,
    b: GitStatus | null,
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    for (const k of GIT_STATUS_CONTENT_KEYS) {
        if (a[k] !== b[k]) return false;
    }
    return true;
}

/**
 * Same dedup check, but for the full submodule array. Returns true when both
 * arrays have the same paths in the same order and each pair of GitStatus
 * objects is content-equal — letting the caller reuse the previous reference.
 */
export function submodulesEqualIgnoringTimestamp(
    a: SubmoduleInfo[] | undefined,
    b: SubmoduleInfo[] | undefined,
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].path !== b[i].path) return false;
        if (!gitStatusEqualsIgnoringTimestamp(a[i].gitStatus, b[i].gitStatus)) {
            return false;
        }
    }
    return true;
}

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
