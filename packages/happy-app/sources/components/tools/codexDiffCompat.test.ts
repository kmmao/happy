import { describe, expect, it } from "vitest";
import { parseLegacyCodexDiffPreview } from "./codexDiffCompat";

describe("parseLegacyCodexDiffPreview", () => {
  it("extracts diff preview and keeps surrounding markdown", () => {
    const parsed = parseLegacyCodexDiffPreview(`- intro

Latest diff preview:

\`\`\`diff
--- a/file.ts
+++ b/file.ts
@@
-old
+new
\`\`\`

tail`);

    expect(parsed).toEqual({
      prefixMarkdown: "- intro\n\ntail",
      unifiedDiff: "--- a/file.ts\n+++ b/file.ts\n@@\n-old\n+new",
    });
  });

  it("returns null for non-diff markdown", () => {
    expect(parseLegacyCodexDiffPreview("plain text")).toBeNull();
  });
});
