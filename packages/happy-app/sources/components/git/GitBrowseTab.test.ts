import { describe, expect, it } from "vitest";

import { getFavoriteItemActions } from "./gitBrowseTabFavorites";

describe("getFavoriteItemActions", () => {
    it("有引用能力时在收藏区包含 @ 按钮", () => {
        expect(getFavoriteItemActions(true)).toEqual(["reference", "remove"]);
    });

    it("没有引用能力时只保留移除按钮", () => {
        expect(getFavoriteItemActions(false)).toEqual(["remove"]);
    });
});
