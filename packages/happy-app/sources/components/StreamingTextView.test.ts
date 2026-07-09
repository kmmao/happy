import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-native", async () => {
  const React = await import("react");
  const createHost = (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement(name, props, children);
  return { Text: createHost("Text") };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (styles: unknown) =>
      typeof styles === "function" ? (styles as () => unknown)() : styles,
  },
  useUnistyles: () => ({ theme: { colors: { text: "#111" } } }),
}));

vi.mock("@/constants/Typography", () => ({
  Typography: { default: () => ({}) },
}));

import { StreamingTextView } from "./StreamingTextView";

// A controllable requestAnimationFrame: callbacks are captured, not run, so the
// typewriter never auto-advances and every assertion is deterministic. Tests
// flush frames explicitly via `flushFrames`.
let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  rafQueue = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function flushFrames(n: number): void {
  for (let i = 0; i < n; i++) {
    const cbs = rafQueue;
    rafQueue = [];
    act(() => {
      cbs.forEach((cb) => cb(0));
    });
  }
}

function renderedText(renderer: ReactTestRenderer): string {
  return renderer.root.findAllByType("Text")[0].props.children as string;
}

describe("StreamingTextView (typewriter reveal)", () => {
  it("reveals a complete (non-streamed) message in full on mount — no truncation", () => {
    // Mirrors the real bug: a high-effort turn delivers its whole answer in one
    // envelope (textStreamed=false). There is nothing to type, so the reveal
    // must start at full length, not animate up from zero.
    const full =
      "## 诊断结论\n\n第一段正文。\n第二段正文。\n第三段包含较多文字，用于验证不会被截断到首行。";
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(StreamingTextView, { text: full }));
    });

    expect(renderedText(renderer)).toBe(full);
    // Already fully revealed on mount ⇒ no animation frame was ever scheduled.
    expect(rafQueue.length).toBe(0);
  });

  it("stays full across a remount (windowed FlatList recycling) instead of dropping to a prefix", () => {
    const full = "完整内容一二三四五六七八九十，验证重挂载不会回退到前缀。";
    let r1!: ReactTestRenderer;
    act(() => {
      r1 = create(React.createElement(StreamingTextView, { text: full }));
    });
    expect(renderedText(r1)).toBe(full);
    act(() => {
      r1.unmount();
    });

    // A fresh component instance — exactly what a recycled list cell produces.
    // With the old `useState(0)` seed this restarted the reveal at zero and the
    // message froze at its first characters; it must now show everything at once.
    let r2!: ReactTestRenderer;
    act(() => {
      r2 = create(React.createElement(StreamingTextView, { text: full }));
    });
    expect(renderedText(r2)).toBe(full);
    expect(rafQueue.length).toBe(0);
  });

  it("still typewriter-animates text that grows after mount (genuine streaming preserved)", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(StreamingTextView, { text: "AB" }));
    });
    // Opening chunk shown as-is (nothing to catch up on yet).
    expect(renderedText(renderer)).toBe("AB");

    // A later delta grows the text. Without advancing frames it must NOT jump
    // straight to the full string — the growth is what gets animated.
    act(() => {
      renderer.update(React.createElement(StreamingTextView, { text: "ABCDEFGHIJ" }));
    });
    expect(renderedText(renderer)).toBe("AB");
    expect(rafQueue.length).toBeGreaterThan(0);

    // Running frames reveals the appended characters, converging to the full text.
    flushFrames(20);
    expect(renderedText(renderer)).toBe("ABCDEFGHIJ");
  });
});
