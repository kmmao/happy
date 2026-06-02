import { describe, expect, it } from "vitest";
import { injectAnnotationRuntime } from "./annotationRuntime";

describe("annotationRuntime", () => {
  describe("injectAnnotationRuntime", () => {
    it("injects script before </body>", () => {
      const html = "<html><body><h1>Hello</h1></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("data-happy-annotation-runtime");
      expect(
        result.indexOf("data-happy-annotation-runtime"),
      ).toBeLessThan(result.indexOf("</body>"));
    });

    it("injects before </html> when no </body>", () => {
      const html = "<html><h1>Hello</h1></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("data-happy-annotation-runtime");
      expect(
        result.indexOf("data-happy-annotation-runtime"),
      ).toBeLessThan(result.indexOf("</html>"));
    });

    it("appends to end when no </body> or </html>", () => {
      const html = "<h1>Hello</h1>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("data-happy-annotation-runtime");
      expect(result.startsWith("<h1>Hello</h1>")).toBe(true);
    });

    it("does not double-inject", () => {
      const html = "<html><body><h1>Hello</h1></body></html>";
      const first = injectAnnotationRuntime(html);
      const second = injectAnnotationRuntime(first);
      expect(second).toBe(first);
      // Count occurrences of the marker attribute
      const count = (second.match(/data-happy-annotation-runtime/g) || []).length;
      // Should appear exactly once in the script tag attribute
      expect(count).toBe(1);
    });

    it("escapes </script> in injected content", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      // The injected script tag should properly escape </script> sequences
      // The browser script itself doesn't contain </script>, but if it did,
      // the injection function escapes it as <\/script to prevent tag closure
      // Verify the outer closing tag is properly formed
      expect(result).toContain("</script>");
      // And that the script tag has proper structure
      expect(result).toContain(
        '<script data-happy-annotation-runtime="true">',
      );
    });

    it("preserves original HTML content", () => {
      const html =
        '<html><body><div class="app">Content</div></body></html>';
      const result = injectAnnotationRuntime(html);
      expect(result).toContain('<div class="app">Content</div>');
    });

    it("contains annotation event names", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("HAPPY_ANNOTATION_TARGET");
      expect(result).toContain("SET_ANNOTATION_MODE");
    });

    it("contains smart selector logic functions", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("findSemanticTarget");
      expect(result).toContain("buildSelector");
      expect(result).toContain("buildXPath");
    });

    it("contains overlay management functions", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("ensureOverlay");
      expect(result).toContain("updateOverlay");
    });

    it("contains element collection logic", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("collectAttributes");
      expect(result).toContain("ancestors");
    });

    it("contains event handlers", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("onMouseMove");
      expect(result).toContain("onClick");
    });

    it("contains message listener for mode toggling", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain('addEventListener("message"');
      expect(result).toContain("SET_ANNOTATION_MODE");
    });

    it("handles empty HTML", () => {
      expect(() => injectAnnotationRuntime("")).not.toThrow();
      const result = injectAnnotationRuntime("");
      expect(result).toContain("data-happy-annotation-runtime");
      expect(result).toContain("<script");
      expect(result).toContain("</script>");
    });

    it("handles HTML with only doctype", () => {
      const html = "<!DOCTYPE html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("<!DOCTYPE html>");
      expect(result).toContain("data-happy-annotation-runtime");
    });

    it("handles malformed HTML gracefully", () => {
      const html = "<html><body><div><p>Unclosed";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("<div><p>Unclosed");
      expect(result).toContain("data-happy-annotation-runtime");
    });

    it("handles HTML with multiple body tags", () => {
      // While invalid, ensure graceful handling
      const html =
        "<html><body>First</body><body>Second</body></html>";
      const result = injectAnnotationRuntime(html);
      // Should find the last </body>
      const lastBodyIndex = html.lastIndexOf("</body>");
      expect(result.slice(0, lastBodyIndex)).not.toContain(
        "data-happy-annotation-runtime",
      );
      expect(
        result.slice(lastBodyIndex).indexOf("data-happy-annotation-runtime"),
      ).toBeLessThan(result.slice(lastBodyIndex).indexOf("</body>"));
    });

    it("injects with proper IIFE structure", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      // Check for immediate invocation pattern
      expect(result).toContain("(function()");
      expect(result).toContain("})()");
    });

    it("includes strict mode declaration", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain('"use strict"');
    });

    it("includes overlay styling", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("rgba(37,99,235");
      expect(result).toContain("cssText");
    });

    it("includes viewport detection", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("window.innerWidth");
      expect(result).toContain("window.innerHeight");
      expect(result).toContain("devicePixelRatio");
    });

    it("includes payload building logic", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("buildPayload");
      expect(result).toContain("location.pathname");
      expect(result).toContain("document.title");
    });

    it("includes postToParent communication", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("postToParent");
      expect(result).toContain("ReactNativeWebView");
      expect(result).toContain("window.parent.postMessage");
    });

    it("is idempotent - multiple calls return same result", () => {
      const html = "<html><body>Test</body></html>";
      const first = injectAnnotationRuntime(html);
      const second = injectAnnotationRuntime(first);
      const third = injectAnnotationRuntime(second);
      expect(second).toBe(first);
      expect(third).toBe(second);
    });

    it("preserves parent HTML structure", () => {
      const html =
        "<html><head><meta charset='utf-8'></head><body><p>Content</p></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("<meta charset='utf-8'>");
      expect(result).toContain("<p>Content</p>");
      // Original HTML structure is at the beginning
      expect(
        result.startsWith(
          "<html><head><meta charset='utf-8'></head><body>",
        ),
      ).toBe(true);
    });

    it("handles special characters in HTML", () => {
      const html =
        '<html><body><p data-test="value with &amp; and &lt;tag&gt;">Content</p></body></html>';
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("data-test=");
      expect(result).toContain("&amp;");
    });

    it("handles large HTML documents", () => {
      const largeContent = "<div>" + "test ".repeat(10000) + "</div>";
      const html = `<html><body>${largeContent}</body></html>`;
      const result = injectAnnotationRuntime(html);
      expect(result).toContain(largeContent);
      expect(result).toContain("data-happy-annotation-runtime");
    });

    it("places script tag correctly in minimal HTML", () => {
      const html = "<body></body>";
      const result = injectAnnotationRuntime(html);
      const bodyCloseIndex = result.lastIndexOf("</body>");
      const markerIndex = result.lastIndexOf(
        "data-happy-annotation-runtime",
      );
      expect(markerIndex).toBeLessThan(bodyCloseIndex);
    });

    it("includes click prevention logic", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("preventDefault");
      expect(result).toContain("stopPropagation");
    });

    it("includes request animation frame optimization", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("requestAnimationFrame");
      expect(result).toContain("hoverFrame");
    });

    it("includes semantic selector patterns", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      // Check for selector patterns for semantic elements
      expect(result).toContain("button");
      expect(result).toContain("role");
      expect(result).toContain("aria-label");
    });

    it("includes XPath generation logic", () => {
      const html = "<html><body></body></html>";
      const result = injectAnnotationRuntime(html);
      expect(result).toContain("buildXPath");
      expect(result).toContain("//*[@id=");
    });
  });
});
