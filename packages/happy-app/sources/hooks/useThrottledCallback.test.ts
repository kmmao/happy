import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrailingThrottle } from "./useThrottledCallback";

describe("createTrailingThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("第一次触发立即执行", () => {
    const fn = vi.fn();
    const { trigger } = createTrailingThrottle(fn, 1000);
    trigger();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("窗口内多次触发合并为一次尾部调用", () => {
    const fn = vi.fn();
    const { trigger } = createTrailingThrottle(fn, 1000);

    trigger(); // t=0 立即
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    trigger(); // 排队
    vi.advanceTimersByTime(100);
    trigger(); // 排队
    vi.advanceTimersByTime(100);
    trigger(); // 排队
    expect(fn).toHaveBeenCalledTimes(1);

    // 推进到窗口末尾
    vi.advanceTimersByTime(700);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("窗口结束后再次触发立即执行", () => {
    const fn = vi.fn();
    const { trigger } = createTrailingThrottle(fn, 1000);

    trigger(); // t=0 立即
    vi.advanceTimersByTime(1500); // 远超窗口
    trigger(); // 立即（新窗口）
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("持续高频触发只产生节流频率的调用", () => {
    const fn = vi.fn();
    const { trigger } = createTrailingThrottle(fn, 1000);

    // 模拟 5 秒内每 50ms 触发一次（共 100 次触发）
    for (let i = 0; i < 100; i++) {
      trigger();
      vi.advanceTimersByTime(50);
    }
    // 窗口末尾排队的最后一次
    vi.advanceTimersByTime(1000);

    // 5 秒 / 1 秒窗口 = 5-6 次（首次 + 每个窗口尾 1 次）
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(7);
  });

  it("cancel 之后排队的尾部调用不会执行", () => {
    const fn = vi.fn();
    const { trigger, cancel } = createTrailingThrottle(fn, 1000);

    trigger(); // 立即
    vi.advanceTimersByTime(100);
    trigger(); // 排队尾部调用
    expect(fn).toHaveBeenCalledTimes(1);

    cancel();
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("仅一次触发应只执行一次（无幻影尾部调用）", () => {
    const fn = vi.fn();
    const { trigger } = createTrailingThrottle(fn, 1000);

    trigger();
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
