import { describe, expect, it } from "vitest";
import { getExpandedSidebarWidth } from "./sidebarDrawerWidth";

describe("getExpandedSidebarWidth", () => {
  it("gives foldable-width windows a meaningfully wider sidebar", () => {
    expect(getExpandedSidebarWidth(840)).toBe(352);
    expect(getExpandedSidebarWidth(960)).toBe(364);
  });

  it("keeps larger tablet and desktop widths bounded", () => {
    expect(getExpandedSidebarWidth(1280)).toBe(384);
    expect(getExpandedSidebarWidth(1800)).toBe(420);
  });

  it("enforces a usable minimum width", () => {
    expect(getExpandedSidebarWidth(700)).toBe(320);
    expect(getExpandedSidebarWidth(0)).toBe(320);
  });
});
