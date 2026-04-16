import { describe, expect, it } from "vitest";

import { settingsDefaults, settingsParse } from "./settings";

describe("preview tab settings", () => {
  it("defaults preview tab experiment to disabled", () => {
    expect(settingsDefaults.enablePreviewTab).toBe(false);
  });

  it("fills missing preview tab experiment flag with false", () => {
    const parsed = settingsParse({
      experiments: true,
    });

    expect(parsed.enablePreviewTab).toBe(false);
  });
});
