import { describe, expect, it } from "vitest";

import type { GitStatus } from "@/sync/storageTypes";
import type { SubmoduleInfo } from "@/sync/projectManager";
import {
    gitStatusEqualsIgnoringTimestamp,
    submodulesEqualIgnoringTimestamp,
} from "./gitStatusUtils";

function makeStatus(overrides: Partial<GitStatus> = {}): GitStatus {
    return {
        branch: "main",
        upstreamBranch: "origin/main",
        remoteUrl: "git@example.com:repo.git",
        aheadCount: 0,
        behindCount: 0,
        isDirty: false,
        stagedCount: 0,
        modifiedCount: 0,
        untrackedCount: 0,
        stashCount: 0,
        stagedLinesAdded: 0,
        stagedLinesRemoved: 0,
        unstagedLinesAdded: 0,
        unstagedLinesRemoved: 0,
        linesAdded: 0,
        linesRemoved: 0,
        linesChanged: 0,
        lastUpdatedAt: 1_000,
        ...overrides,
    };
}

describe("gitStatusEqualsIgnoringTimestamp", () => {
    it("returns true for the same reference", () => {
        const a = makeStatus();
        expect(gitStatusEqualsIgnoringTimestamp(a, a)).toBe(true);
    });

    it("returns true when only lastUpdatedAt differs", () => {
        const a = makeStatus({ lastUpdatedAt: 1_000 });
        const b = makeStatus({ lastUpdatedAt: 2_000 });
        expect(gitStatusEqualsIgnoringTimestamp(a, b)).toBe(true);
    });

    it("returns false when any tracked content field differs", () => {
        const a = makeStatus({ unstagedLinesAdded: 5 });
        const b = makeStatus({ unstagedLinesAdded: 6 });
        expect(gitStatusEqualsIgnoringTimestamp(a, b)).toBe(false);
    });

    it("returns false for null vs object", () => {
        expect(gitStatusEqualsIgnoringTimestamp(null, makeStatus())).toBe(false);
        expect(gitStatusEqualsIgnoringTimestamp(makeStatus(), null)).toBe(false);
    });

    it("returns true for null vs null", () => {
        expect(gitStatusEqualsIgnoringTimestamp(null, null)).toBe(true);
    });

    it("distinguishes branch and remoteUrl changes", () => {
        const base = makeStatus();
        expect(
            gitStatusEqualsIgnoringTimestamp(base, makeStatus({ branch: "dev" })),
        ).toBe(false);
        expect(
            gitStatusEqualsIgnoringTimestamp(
                base,
                makeStatus({ remoteUrl: "git@example.com:other.git" }),
            ),
        ).toBe(false);
    });
});

describe("submodulesEqualIgnoringTimestamp", () => {
    function makeSubmodule(
        path: string,
        status: GitStatus | null = makeStatus(),
    ): SubmoduleInfo {
        return { path, gitStatus: status };
    }

    it("returns true for matching arrays even when each gitStatus has a different timestamp", () => {
        const a = [
            makeSubmodule("vendor/a", makeStatus({ lastUpdatedAt: 1 })),
            makeSubmodule("vendor/b", makeStatus({ lastUpdatedAt: 2 })),
        ];
        const b = [
            makeSubmodule("vendor/a", makeStatus({ lastUpdatedAt: 10 })),
            makeSubmodule("vendor/b", makeStatus({ lastUpdatedAt: 20 })),
        ];
        expect(submodulesEqualIgnoringTimestamp(a, b)).toBe(true);
    });

    it("returns false when paths differ", () => {
        const a = [makeSubmodule("vendor/a")];
        const b = [makeSubmodule("vendor/b")];
        expect(submodulesEqualIgnoringTimestamp(a, b)).toBe(false);
    });

    it("returns false when array length differs", () => {
        expect(
            submodulesEqualIgnoringTimestamp(
                [makeSubmodule("vendor/a")],
                [makeSubmodule("vendor/a"), makeSubmodule("vendor/b")],
            ),
        ).toBe(false);
    });

    it("returns false when any submodule's content changed", () => {
        const a = [makeSubmodule("vendor/a", makeStatus({ unstagedLinesAdded: 1 }))];
        const b = [makeSubmodule("vendor/a", makeStatus({ unstagedLinesAdded: 2 }))];
        expect(submodulesEqualIgnoringTimestamp(a, b)).toBe(false);
    });

    it("treats undefined and empty array as different", () => {
        expect(submodulesEqualIgnoringTimestamp(undefined, [])).toBe(false);
        expect(submodulesEqualIgnoringTimestamp([], undefined)).toBe(false);
    });

    it("treats two undefineds as equal", () => {
        expect(submodulesEqualIgnoringTimestamp(undefined, undefined)).toBe(true);
    });
});
