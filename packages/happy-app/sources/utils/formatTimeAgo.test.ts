import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { formatTimeAgo } from "./formatTimeAgo";

// `t()` returns either a literal string or, for plural keys, a function that
// receives the count. Pin a deterministic fake so the unit test asserts on
// the buckets without dragging in the real translation registry.
vi.mock("@/text", () => ({
  t: (key: string, arg?: unknown) => {
    if (key === "timeline.justNow") return "just now";
    if (key === "timeline.minutesAgo") return `${arg as number}m ago`;
    if (key === "timeline.hoursAgo") return `${arg as number}h ago`;
    if (key === "timeline.daysAgo") return `${arg as number}d ago`;
    return key;
  },
}));

describe("formatTimeAgo", () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps under a minute ago", () => {
    expect(formatTimeAgo(NOW - 30_000)).toBe("just now");
  });

  it("treats future timestamps as 'just now' (clock skew safety)", () => {
    expect(formatTimeAgo(NOW + 5_000)).toBe("just now");
  });

  it("renders minutes for the 1m..59m bucket", () => {
    expect(formatTimeAgo(NOW - 60_000)).toBe("1m ago");
    expect(formatTimeAgo(NOW - 30 * 60_000)).toBe("30m ago");
    expect(formatTimeAgo(NOW - 59 * 60_000)).toBe("59m ago");
  });

  it("renders hours for the 1h..23h bucket", () => {
    expect(formatTimeAgo(NOW - 60 * 60_000)).toBe("1h ago");
    expect(formatTimeAgo(NOW - 12 * 60 * 60_000)).toBe("12h ago");
  });

  it("renders days for ≥24h", () => {
    expect(formatTimeAgo(NOW - 24 * 60 * 60_000)).toBe("1d ago");
    expect(formatTimeAgo(NOW - 7 * 24 * 60 * 60_000)).toBe("7d ago");
  });

  it("crosses the minute/hour boundary cleanly at exactly 60 minutes", () => {
    // 59m59s → still minutes bucket
    expect(formatTimeAgo(NOW - (60 * 60_000 - 1))).toBe("59m ago");
    // 60m → hours bucket
    expect(formatTimeAgo(NOW - 60 * 60_000)).toBe("1h ago");
  });
});
