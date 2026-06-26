/**
 * Path security — keeps RPC file operations confined to allowed directories.
 *
 * Extracted from `registerHandlers.ts`, where it was a private function buried
 * in a ~985-line file and reached by eight handlers (bash cwd, readFile,
 * writeFile, listDirectory, …). Being private and un-exported, this
 * security-critical check had no test surface: exercising a directory-traversal
 * or symlink-escape case meant standing up the whole RpcHandlerManager.
 *
 * As its own module the policy is a deep seam — eight call sites, one
 * implementation — and the traversal / symlink / allowlist-boundary rules can be
 * tested directly.
 *
 * The check resolves the target against the working directory, follows symlinks
 * via realpath (so a symlink pointing outside the allowlist is rejected on its
 * real location, not its link path), and accepts only paths inside the working
 * directory or an explicitly allowed extra directory.
 */

import { resolve } from "path";
import { realpathSync } from "fs";

export interface PathValidationResult {
    valid: boolean;
    error?: string;
}

export function validatePath(
    targetPath: string,
    workingDirectory: string,
    additionalAllowedDirs?: string[],
): PathValidationResult {
    const resolvedTarget = resolve(workingDirectory, targetPath);

    let realTarget: string;
    try {
        realTarget = realpathSync(resolvedTarget);
    } catch {
        // Target doesn't exist yet (e.g. a writeFile creating a new file).
        // Resolve the real parent and re-attach the leaf so a symlinked parent
        // still can't escape the allowlist.
        const parentDir = resolve(resolvedTarget, "..");
        try {
            realTarget = realpathSync(parentDir) + "/" + resolvedTarget.split("/").pop();
        } catch {
            realTarget = resolvedTarget;
        }
    }

    const allowedDirs = [workingDirectory, ...(additionalAllowedDirs ?? [])].map((d) => {
        const resolved = resolve(d);
        try {
            return realpathSync(resolved);
        } catch {
            return resolved;
        }
    });

    for (const dir of allowedDirs) {
        if (realTarget.startsWith(dir + "/") || realTarget === dir) {
            return { valid: true };
        }
    }

    return {
        valid: false,
        error: `Access denied: Path '${targetPath}' is outside the allowed directories`,
    };
}
