import { describe, expect, it } from "vitest";

import { buildFileReferenceText } from "./sessionSidePanelReference";

describe("buildFileReferenceText", () => {
    it("为文件引用追加空格", () => {
        expect(buildFileReferenceText("docs/plans/agent-loop-system.md")).toBe("@docs/plans/agent-loop-system.md ");
    });

    it("保留原始相对路径内容", () => {
        expect(buildFileReferenceText("src/index.ts")).toBe("@src/index.ts ");
    });
});
