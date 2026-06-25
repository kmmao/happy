import { describe, it, expect } from "vitest";
import { parsePsEtimeSeconds } from "./startDaemonSessionRecovery";

// `ps -o etime=` is the cross-platform field we settled on because BSD ps
// (macOS) rejects `etimes`. These tests pin the format `[[DD-]HH:]MM:SS` so
// any future drift from real ps output gets caught.
describe("parsePsEtimeSeconds", () => {
  it("parses MM:SS", () => {
    expect(parsePsEtimeSeconds("01:23")).toBe(83);
    expect(parsePsEtimeSeconds("00:01")).toBe(1);
    expect(parsePsEtimeSeconds("59:59")).toBe(3599);
  });

  it("parses HH:MM:SS", () => {
    expect(parsePsEtimeSeconds("12:34:56")).toBe(12 * 3600 + 34 * 60 + 56);
    expect(parsePsEtimeSeconds("01:00:00")).toBe(3600);
  });

  it("parses DD-HH:MM:SS (long-running processes)", () => {
    expect(parsePsEtimeSeconds("1-02:03:04")).toBe(
      86400 + 2 * 3600 + 3 * 60 + 4,
    );
    expect(parsePsEtimeSeconds("7-00:00:00")).toBe(7 * 86400);
  });

  it("tolerates leading/trailing whitespace from ps", () => {
    // BSD ps right-pads the etime field, callers may or may not trim
    expect(parsePsEtimeSeconds("  05:00 ")).toBe(300);
  });

  it("parses bare seconds (defensive — not standard ps output)", () => {
    expect(parsePsEtimeSeconds("42")).toBe(42);
  });

  it("returns 0 on empty / malformed input rather than throwing", () => {
    expect(parsePsEtimeSeconds("")).toBe(0);
    expect(parsePsEtimeSeconds("abc")).toBe(0);
    expect(parsePsEtimeSeconds("1:2:3:4")).toBe(0); // 4 colon-parts — not a valid etime
    expect(parsePsEtimeSeconds("xx-01:02:03")).toBe(0); // bad days prefix
  });
});
