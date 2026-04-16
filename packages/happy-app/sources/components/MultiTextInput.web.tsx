import * as React from "react";
import { View } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import TextareaAutosize from "react-textarea-autosize";
import { Typography } from "@/constants/Typography";

export type SupportedKey =
  | "Enter"
  | "Escape"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Tab";

export interface KeyPressEvent {
  key: SupportedKey;
  shiftKey: boolean;
}

export type OnKeyPressCallback = (event: KeyPressEvent) => boolean;

export interface TextInputState {
  text: string;
  selection: {
    start: number;
    end: number;
  };
}

export interface MultiTextInputHandle {
  setTextAndSelection: (
    text: string,
    selection: { start: number; end: number },
  ) => void;
  focus: () => void;
  blur: () => void;
}

interface MultiTextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  editable?: boolean;
  maxHeight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  onKeyPress?: OnKeyPressCallback;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onStateChange?: (state: TextInputState) => void;
  onImagePaste?: (blob: Blob) => void;
  onFilePaste?: (file: File) => void;
}

export const MultiTextInput = React.forwardRef<
  MultiTextInputHandle,
  MultiTextInputProps
>((props, ref) => {
  const {
    value,
    onChangeText,
    placeholder,
    editable = true,
    maxHeight = 120,
    onKeyPress,
    onSelectionChange,
    onStateChange,
    onImagePaste,
    onFilePaste,
  } = props;

  const { theme } = useUnistyles();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Convert maxHeight to approximate maxRows (assuming ~24px line height)
  const maxRows = Math.floor(maxHeight / 24);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!onKeyPress) return;

      const isComposing =
        e.nativeEvent.isComposing ||
        (e.nativeEvent as any).isComposing ||
        e.keyCode === 229;
      if (isComposing) {
        return;
      }

      const key = e.key;

      // Map browser key names to our normalized format
      let normalizedKey: SupportedKey | null = null;

      switch (key) {
        case "Enter":
          normalizedKey = "Enter";
          break;
        case "Escape":
          normalizedKey = "Escape";
          break;
        case "ArrowUp":
          normalizedKey = "ArrowUp";
          break;
        case "ArrowDown":
          normalizedKey = "ArrowDown";
          break;
        case "ArrowLeft":
          normalizedKey = "ArrowLeft";
          break;
        case "ArrowRight":
          normalizedKey = "ArrowRight";
          break;
        case "Tab":
          normalizedKey = "Tab";
          break;
      }

      if (normalizedKey) {
        const keyEvent: KeyPressEvent = {
          key: normalizedKey,
          shiftKey: e.shiftKey,
        };

        const handled = onKeyPress(keyEvent);
        if (handled) {
          e.preventDefault();
        }
      }
    },
    [onKeyPress],
  );

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      const selection = {
        start: e.target.selectionStart,
        end: e.target.selectionEnd,
      };

      onChangeText(text);

      if (onStateChange) {
        onStateChange({ text, selection });
      }
      if (onSelectionChange) {
        onSelectionChange(selection);
      }
    },
    [onChangeText, onStateChange, onSelectionChange],
  );

  const handleSelect = React.useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const target = e.target as HTMLTextAreaElement;
      const selection = {
        start: target.selectionStart,
        end: target.selectionEnd,
      };

      if (onSelectionChange) {
        onSelectionChange(selection);
      }
      if (onStateChange) {
        // Read text from DOM directly to avoid stale closure on `value` prop
        // which can lag behind during paste operations
        onStateChange({ text: target.value, selection });
      }
    },
    [onSelectionChange, onStateChange],
  );

  // Intercept clipboard paste to detect images/files and handle text explicitly
  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;

      // Check for file/image paste first
      if (items && (onImagePaste || onFilePaste)) {
        const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|bmp|heic|heif|svg)$/i;

        for (const item of Array.from(items)) {
          if (item.kind !== "file") continue;
          const file = item.getAsFile();
          if (!file) continue;

          const isImage = item.type.startsWith("image/") || IMAGE_EXTS.test(file.name);

          if (isImage && onImagePaste) {
            e.preventDefault();
            onImagePaste(file);
            return;
          }
          if (!isImage && onFilePaste) {
            e.preventDefault();
            onFilePaste(file);
            return;
          }
        }
      }

      // Explicitly handle text paste to avoid browser/React controlled-component
      // race condition where stale value prop overwrites pasted content.
      // All clipboardData reads must happen synchronously (before any await).
      const pastedText =
        e.clipboardData?.getData("text/plain") ||
        e.clipboardData?.getData("text/html")?.replace(/<[^>]*>/g, "") ||
        "";

      e.preventDefault();

      if (!pastedText) return;

      const textarea = e.currentTarget;

      // Use execCommand to preserve browser undo/redo history and trigger
      // TextareaAutosize height recalculation via native input event.
      // execCommand is deprecated but is the only way to insert text while
      // preserving undo stack — still supported in all major browsers.
      textarea.focus();
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      document.execCommand("insertText", false, pastedText);

      // Sync React state with the DOM result
      const newValue = textarea.value;
      const newCursorPos = textarea.selectionStart;
      onChangeText(newValue);

      const selection = { start: newCursorPos, end: newCursorPos };
      if (onStateChange) {
        onStateChange({ text: newValue, selection });
      }
      if (onSelectionChange) {
        onSelectionChange(selection);
      }
    },
    [onImagePaste, onFilePaste, onChangeText, onStateChange, onSelectionChange],
  );

  // Imperative handle for direct control
  React.useImperativeHandle(
    ref,
    () => ({
      setTextAndSelection: (
        text: string,
        selection: { start: number; end: number },
      ) => {
        if (textareaRef.current) {
          // Directly set value and selection on DOM element
          textareaRef.current.value = text;
          textareaRef.current.setSelectionRange(selection.start, selection.end);

          // Trigger React's onChange by dispatching an input event
          const event = new Event("input", { bubbles: true });
          textareaRef.current.dispatchEvent(event);

          // Also call callbacks directly for immediate update
          onChangeText(text);
          if (onStateChange) {
            onStateChange({ text, selection });
          }
          if (onSelectionChange) {
            onSelectionChange(selection);
          }
        }
      },
      focus: () => {
        textareaRef.current?.focus();
      },
      blur: () => {
        textareaRef.current?.blur();
      },
    }),
    [onChangeText, onStateChange, onSelectionChange],
  );

  return (
    <View style={{ width: "100%" }}>
      <TextareaAutosize
        ref={textareaRef}
        style={{
          width: "100%",
          padding: "0",
          fontSize: "16px",
          color: theme.colors.input.text,
          border: "none",
          outline: "none",
          resize: "none" as const,
          backgroundColor: "transparent",
          fontFamily: Typography.default().fontFamily,
          lineHeight: "1.4",
          scrollbarWidth: "none",
          opacity: editable ? 1 : 0.55,
          cursor: editable ? "text" : "not-allowed",
          paddingTop: props.paddingTop,
          paddingBottom: props.paddingBottom,
          paddingLeft: props.paddingLeft,
          paddingRight: props.paddingRight,
        }}
        placeholder={placeholder}
        value={value}
        disabled={!editable}
        onChange={handleChange}
        onSelect={handleSelect}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        maxRows={maxRows}
        autoCapitalize="sentences"
        autoCorrect="on"
        autoComplete="off"
      />
    </View>
  );
});

MultiTextInput.displayName = "MultiTextInput";
