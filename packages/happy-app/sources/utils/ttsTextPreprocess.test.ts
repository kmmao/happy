import { describe, it, expect } from "vitest";
import { preprocessTtsText } from "./ttsTextPreprocess";

describe("preprocessTtsText", () => {
    it("returns empty string for empty input", () => {
        expect(preprocessTtsText("")).toBe("");
        expect(preprocessTtsText("   ")).toBe("");
    });

    it("passes through plain text unchanged", () => {
        expect(preprocessTtsText("Hello, world!")).toBe("Hello, world!");
    });

    it("removes fenced code blocks", () => {
        const input = "Here is some code:\n```javascript\nconst x = 1;\nconsole.log(x);\n```\nThat was the code.";
        expect(preprocessTtsText(input)).toBe("Here is some code: That was the code.");
    });

    it("removes multiple fenced code blocks", () => {
        const input = "First:\n```\ncode1\n```\nMiddle.\n```python\ncode2\n```\nEnd.";
        expect(preprocessTtsText(input)).toBe("First: Middle. End.");
    });

    it("returns empty string when input is only code blocks", () => {
        const input = "```\nconst x = 1;\n```";
        expect(preprocessTtsText(input)).toBe("");
    });

    it("preserves inline code content but removes backticks", () => {
        expect(preprocessTtsText("Use the `useState` hook")).toBe("Use the useState hook");
    });

    it("removes HTTP URLs", () => {
        expect(preprocessTtsText("Visit https://example.com for more")).toBe("Visit for more");
    });

    it("removes file URLs", () => {
        expect(preprocessTtsText("Open file:///tmp/test.txt")).toBe("Open");
    });

    it("removes Unix file paths", () => {
        expect(preprocessTtsText("Edit /src/components/App.tsx")).toBe("Edit");
    });

    it("removes Windows file paths", () => {
        expect(preprocessTtsText("Open C:\\Users\\foo\\bar.ts")).toBe("Open");
    });

    it("removes Markdown headers", () => {
        expect(preprocessTtsText("# Title\n## Subtitle\nBody text")).toBe("Title Subtitle Body text");
    });

    it("removes bold markers but keeps text", () => {
        expect(preprocessTtsText("This is **bold** text")).toBe("This is bold text");
    });

    it("removes italic markers but keeps text", () => {
        expect(preprocessTtsText("This is *italic* text")).toBe("This is italic text");
    });

    it("removes strikethrough markers but keeps text", () => {
        expect(preprocessTtsText("This is ~~deleted~~ text")).toBe("This is deleted text");
    });

    it("removes unordered list markers", () => {
        expect(preprocessTtsText("- Item one\n- Item two")).toBe("Item one Item two");
    });

    it("removes ordered list markers", () => {
        expect(preprocessTtsText("1. First\n2. Second\n3. Third")).toBe("First Second Third");
    });

    it("removes Markdown links but keeps link text", () => {
        expect(preprocessTtsText("See [the docs](https://docs.example.com) for details"))
            .toBe("See the docs for details");
    });

    it("removes Markdown images", () => {
        expect(preprocessTtsText("Here is ![screenshot](https://img.example.com/pic.png) an image"))
            .toBe("Here is an image");
    });

    it("removes blockquotes", () => {
        expect(preprocessTtsText("> This is a quote\n> Second line"))
            .toBe("This is a quote Second line");
    });

    it("removes horizontal rules", () => {
        expect(preprocessTtsText("Above\n---\nBelow")).toBe("Above Below");
    });

    it("removes table formatting", () => {
        const input = "Name | Age\n|---|---|\nAlice | 30";
        expect(preprocessTtsText(input)).toBe("Name Age Alice 30");
    });

    it("collapses multiple whitespace into single space", () => {
        expect(preprocessTtsText("Hello    world\n\n\nfoo")).toBe("Hello world foo");
    });

    it("handles real Claude Code response with mixed content", () => {
        const input = `## Summary

I've updated the **authentication** module. Here are the changes:

1. Added JWT token refresh in \`auth.ts\`
2. Fixed the login flow

\`\`\`typescript
export function refreshToken(token: string): Promise<string> {
  return fetch('/api/refresh', { headers: { Authorization: token } })
}
\`\`\`

See [the PR](https://github.com/org/repo/pull/123) for details.

The file is at \`/src/auth/auth.ts\`.`;

        const result = preprocessTtsText(input);
        expect(result).toBe(
            "Summary I've updated the authentication module. Here are the changes: Added JWT token refresh in auth.ts Fixed the login flow See the PR for details. The file is at ."
        );
    });

    it("handles Chinese text correctly", () => {
        const input = "## 更新说明\n\n我已经修改了 **认证** 模块。\n\n```\nconst x = 1;\n```";
        expect(preprocessTtsText(input)).toBe("更新说明 我已经修改了 认证 模块。");
    });
});
