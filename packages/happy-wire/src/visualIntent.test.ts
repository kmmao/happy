import { describe, it, expect } from "vitest";
import {
  formatVisualIntentRef,
  parseVisualIntentRefs,
} from "./visualIntent";

describe("visualIntent", () => {
  it("formats HTML drafts as [design: …]", () => {
    expect(
      formatVisualIntentRef({ kind: "html", path: "/tmp/proto.html" }),
    ).toBe("[design: /tmp/proto.html]");
  });

  it("formats image drafts as [image: …] for backward compatibility", () => {
    expect(
      formatVisualIntentRef({ kind: "image", path: "/tmp/shot.jpg" }),
    ).toBe("[image: /tmp/shot.jpg]");
  });

  it("round-trips design refs out of a message", () => {
    const msg = "Rebuild this screen\n[design: /a/b.html]\n[design: /c/d.html]";
    expect(parseVisualIntentRefs(msg)).toEqual(["/a/b.html", "/c/d.html"]);
  });

  it("returns empty when there are no design refs", () => {
    expect(parseVisualIntentRefs("just text [image: /x.jpg]")).toEqual([]);
  });
});
