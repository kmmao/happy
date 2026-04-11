import { describe, expect, it } from "vitest";

import { getSessionContentMaxWidth } from "./sessionContentWidth";

describe("getSessionContentMaxWidth", () => {
  it("uses available full width on web", () => {
    expect(
      getSessionContentMaxWidth({
        platform: "web",
        defaultMaxWidth: 1000,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps default max width on native platforms", () => {
    expect(
      getSessionContentMaxWidth({
        platform: "ios",
        defaultMaxWidth: 1000,
      }),
    ).toBe(1000);
  });

  it("stays scoped to session-specific callers instead of changing the default width value", () => {
    const defaultMaxWidth = 1000;

    const sessionWidth = getSessionContentMaxWidth({
      platform: "web",
      defaultMaxWidth,
    });

    expect(defaultMaxWidth).toBe(1000);
    expect(sessionWidth).toBe(Number.POSITIVE_INFINITY);
  });
});
