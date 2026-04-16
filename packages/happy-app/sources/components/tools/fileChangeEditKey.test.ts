import { describe, expect, it } from "vitest";

import {
    createFileChangeEditEntry,
    getFileChangeEditKey,
} from "./fileChangeEditKey";

describe("fileChangeEditKey", () => {
    it("builds a stable key from tool message identity and edit index", () => {
        const edit = createFileChangeEditEntry("msg-1", "Edit", "before", "after", 2);

        expect(getFileChangeEditKey(edit)).toBe("msg-1:2");
    });

    it("keeps keys unique for multiple edits from the same tool call", () => {
        const firstEdit = createFileChangeEditEntry("msg-1", "MultiEdit", "a", "b", 0);
        const secondEdit = createFileChangeEditEntry("msg-1", "MultiEdit", "c", "d", 1);

        expect(getFileChangeEditKey(firstEdit)).not.toBe(getFileChangeEditKey(secondEdit));
    });

    it("falls back to content-derived key when message id is missing", () => {
        const edit = createFileChangeEditEntry(null, "Write", "", "hello", 0);

        expect(getFileChangeEditKey(edit)).toBe("Write::hello:0");
    });
});
