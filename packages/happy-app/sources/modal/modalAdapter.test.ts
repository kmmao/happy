import { afterEach, describe, expect, it, vi } from "vitest";

// react-native's Platform.OS defaults to "ios" in the test env. The
// adapter selection test below switches it per case.
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Alert: {
    alert: vi.fn(),
    // Alert.prompt is iOS-only on real RN; in tests we just need a stub
    // we can assert was called with the right shape.
    prompt: vi.fn(),
  },
}));

vi.mock("@/text", () => ({
  t: (key: string) => key,
}));

import { Alert, Platform } from "react-native";

import {
  NativeModalAdapter,
  WebModalAdapter,
  selectModalAdapter,
  type ModalAdapter,
} from "./modalAdapter";

const platformMock = Platform as unknown as { OS: string };

afterEach(() => {
  vi.clearAllMocks();
});

// The web adapter is fully testable from a single stubbed showModalFn
// — no RN, no DOM, no resolver-side React. Pins the contract that
// every Modal call ends up as one showModalFn invocation with the
// correct type discriminator, and that the resolver maps round-trip.

describe("WebModalAdapter", () => {
  it("alert() dispatches showModalFn with type='alert' and default OK button", () => {
    const showModalFn = vi.fn(() => "id-1");
    const adapter = new WebModalAdapter(showModalFn);
    adapter.alert("Hi");
    expect(showModalFn).toHaveBeenCalledWith({
      type: "alert",
      title: "Hi",
      message: undefined,
      buttons: [{ text: "common.ok" }],
    });
  });

  it("alert() preserves caller-supplied buttons verbatim", () => {
    const showModalFn = vi.fn((_config: unknown) => "id-1");
    const adapter = new WebModalAdapter(showModalFn);
    adapter.alert("Hi", "msg", [{ text: "Yes" }, { text: "No" }]);
    expect(showModalFn.mock.calls[0]?.[0]).toMatchObject({
      buttons: [{ text: "Yes" }, { text: "No" }],
    });
  });

  it("confirm() returns a Promise that resolves via resolveConfirm", async () => {
    const showModalFn = vi.fn(() => "modal-A");
    const adapter = new WebModalAdapter(showModalFn);

    const promise = adapter.confirm("Sure?");
    adapter.resolveConfirm("modal-A", true);
    await expect(promise).resolves.toBe(true);
  });

  it("confirm() resolves to false when the user cancels", async () => {
    const showModalFn = vi.fn(() => "modal-B");
    const adapter = new WebModalAdapter(showModalFn);

    const promise = adapter.confirm("Sure?");
    adapter.resolveConfirm("modal-B", false);
    await expect(promise).resolves.toBe(false);
  });

  it("resolveConfirm() drops the resolver after firing (no double resolution)", async () => {
    const showModalFn = vi.fn(() => "modal-C");
    const adapter = new WebModalAdapter(showModalFn);

    const promise = adapter.confirm("Sure?");
    adapter.resolveConfirm("modal-C", true);
    // Second call must be a no-op — if the resolver lingered, the
    // promise would already have resolved so this is purely defensive
    // against future map-leak bugs.
    adapter.resolveConfirm("modal-C", false);
    await expect(promise).resolves.toBe(true);
  });

  it("prompt() returns a Promise that resolves via resolvePrompt", async () => {
    const showModalFn = vi.fn(() => "modal-D");
    const adapter = new WebModalAdapter(showModalFn);

    const promise = adapter.prompt("Name?", "Your name");
    adapter.resolvePrompt("modal-D", "Ada");
    await expect(promise).resolves.toBe("Ada");
  });

  it("prompt() resolves to null on user cancel", async () => {
    const showModalFn = vi.fn(() => "modal-E");
    const adapter = new WebModalAdapter(showModalFn);

    const promise = adapter.prompt("Name?");
    adapter.resolvePrompt("modal-E", null);
    await expect(promise).resolves.toBeNull();
  });

  it("prompt() forwards all options to showModalFn", () => {
    const showModalFn = vi.fn((_config: unknown) => "id");
    const adapter = new WebModalAdapter(showModalFn);
    adapter.prompt("Name?", "Your name", {
      placeholder: "Type here",
      defaultValue: "abc",
      cancelText: "Nope",
      confirmText: "Yep",
      inputType: "secure-text",
    });
    expect(showModalFn.mock.calls[0]?.[0]).toMatchObject({
      type: "prompt",
      placeholder: "Type here",
      defaultValue: "abc",
      cancelText: "Nope",
      confirmText: "Yep",
      inputType: "secure-text",
    });
  });
});

// The native adapter is tested against the RN.Alert mock. The Alert
// call shape (button order, styles, cancelable: false) is the contract
// users depend on — a regression in any of those is a UX regression.

describe("NativeModalAdapter (iOS path)", () => {
  it("alert() calls Alert.alert with the same arguments", () => {
    const fallback = new WebModalAdapter(() => "");
    const adapter = new NativeModalAdapter(fallback);

    adapter.alert("Title", "Message");
    expect(Alert.alert).toHaveBeenCalledWith("Title", "Message", undefined);
  });

  it("confirm() wires cancel/confirm buttons + resolves via onPress", async () => {
    const fallback = new WebModalAdapter(() => "");
    const adapter = new NativeModalAdapter(fallback);

    const promise = adapter.confirm("Sure?", "msg", {
      cancelText: "Stop",
      confirmText: "Go",
      destructive: true,
    });

    // Drive the cancel button.
    const call = (Alert.alert as ReturnType<typeof vi.fn>).mock.calls[0];
    const buttons = call?.[2] as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.text).toBe("Stop");
    expect(buttons[0]?.style).toBe("cancel");
    expect(buttons[1]?.text).toBe("Go");
    expect(buttons[1]?.style).toBe("destructive");
    // cancelable:false is the load-bearing UX detail.
    expect(call?.[3]).toEqual({ cancelable: false });

    buttons[1]?.onPress?.();
    await expect(promise).resolves.toBe(true);
  });

  it("prompt() uses Alert.prompt on iOS with no custom inputType", async () => {
    platformMock.OS = "ios";
    const fallback = new WebModalAdapter(() => "");
    const adapter = new NativeModalAdapter(fallback);

    const promise = adapter.prompt("Name?", "Your name", {
      defaultValue: "abc",
    });

    expect(Alert.prompt).toHaveBeenCalled();
    const call = (Alert.prompt as ReturnType<typeof vi.fn>).mock.calls[0];
    const buttons = call?.[2] as Array<{ text: string; onPress?: any }>;
    buttons[1]?.onPress("hello");
    await expect(promise).resolves.toBe("hello");
  });

  it("prompt() falls back to the web adapter when inputType is set (iOS)", async () => {
    platformMock.OS = "ios";
    const showModalFn = vi.fn(() => "fallback-id");
    const fallback = new WebModalAdapter(showModalFn);
    const adapter = new NativeModalAdapter(fallback);

    const promise = adapter.prompt("PIN", "your pin", {
      inputType: "secure-text",
    });
    expect(showModalFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "prompt",
        inputType: "secure-text",
      }),
    );
    fallback.resolvePrompt("fallback-id", "1234");
    await expect(promise).resolves.toBe("1234");
  });

  it("prompt() always falls back to the web adapter on Android", async () => {
    platformMock.OS = "android";
    const showModalFn = vi.fn(() => "android-id");
    const fallback = new WebModalAdapter(showModalFn);
    const adapter = new NativeModalAdapter(fallback);

    const promise = adapter.prompt("Name?");
    expect(showModalFn).toHaveBeenCalled();
    fallback.resolvePrompt("android-id", "Ada");
    await expect(promise).resolves.toBe("Ada");
  });
});

describe("selectModalAdapter", () => {
  it("returns the web adapter on web", () => {
    platformMock.OS = "web";
    const showModalFn = vi.fn(() => "");
    const { adapter, webAdapter } = selectModalAdapter({ showModalFn });
    expect(adapter).toBe(webAdapter);
  });

  it("returns the native adapter on non-web", () => {
    platformMock.OS = "ios";
    const showModalFn = vi.fn(() => "");
    const { adapter, webAdapter } = selectModalAdapter({ showModalFn });
    expect(adapter).not.toBe(webAdapter);
    // Sanity: the selected adapter still satisfies the contract.
    const _typed: ModalAdapter = adapter;
    expect(typeof _typed.alert).toBe("function");
  });
});
