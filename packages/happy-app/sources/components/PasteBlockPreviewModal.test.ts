import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/text", () => ({
  t: (key: string) => key,
}));

vi.mock("react-native", async () => {
  const React = await import("react");

  const createHost = (name: string) => {
    return ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement(name, props, children);
  };

  const AnimatedView = createHost("Animated.View");

  return {
    ActivityIndicator: createHost("ActivityIndicator"),
    Animated: { View: AnimatedView },
    Easing: {
      ease: (value: unknown) => value,
      inOut: (value: unknown) => value,
      out: (value: unknown) => value,
      quad: (value: unknown) => value,
    },
    Modal: createHost("Modal"),
    Platform: {
      OS: "web",
      select: <T,>(options: { default: T; ios?: T; android?: T; web?: T }) =>
        options.web ?? options.default,
    },
    Pressable: createHost("Pressable"),
    ScrollView: createHost("ScrollView"),
    Text: createHost("Text"),
    TouchableWithoutFeedback: createHost("TouchableWithoutFeedback"),
    View: createHost("View"),
    useWindowDimensions: () => ({ width: 1024, height: 768, scale: 1, fontScale: 1 }),
  };
});

vi.mock("react-native-unistyles", () => ({
  useUnistyles: () => ({
    theme: {
      colors: {
        surface: "#fff",
        divider: "#ddd",
        text: "#111",
        textSecondary: "#666",
        surfacePressed: "#f4f4f4",
        button: {
          primary: {
            background: "#111",
            tint: "#fff",
          },
        },
      },
    },
  }),
}));

vi.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

import { PasteBlockPreviewModal } from "./PasteBlockPreviewModal";

const block = {
  id: "paste-1",
  text: "line 1\nline 2\nline 3",
  summary: "line 1 · 3 lines",
  lineCount: 3,
  charCount: 19,
};

describe("PasteBlockPreviewModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows content and expands the selected paste block", () => {
    const events: string[] = [];
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        React.createElement(PasteBlockPreviewModal, {
          visible: true,
          block,
          onClose: () => events.push("close"),
          onExpand: (id) => events.push(`expand:${id}`),
        }),
      );
    });

    expect(
      renderer.root.findAllByProps({ accessibilityLabel: "session.appendToInput" }),
    ).toHaveLength(2);

    act(() => {
      const expandButton = renderer.root.findByProps({
        accessibilityLabel: "session.appendToInput",
      }) as unknown as { props: { onPress: () => void } };
      expandButton.props.onPress();
    });

    expect(events).toEqual(["close", "expand:paste-1"]);
  });

  it("removes the block from the preview modal", () => {
    const events: string[] = [];
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        React.createElement(PasteBlockPreviewModal, {
          visible: true,
          block,
          onClose: () => events.push("close"),
          onExpand: (id) => events.push(`expand:${id}`),
          onRemove: (id) => events.push(`remove:${id}`),
        }),
      );
    });

    act(() => {
      const removeButton = renderer.root.findByProps({
        accessibilityLabel: "common.remove",
      }) as unknown as { props: { onPress: () => void } };
      removeButton.props.onPress();
    });

    expect(events).toEqual(["close", "remove:paste-1"]);
  });
});
