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
        onStateChange({ text: value, selection });
      }
    },
    [value, onSelectionChange, onStateChange],
  );

  // Intercept clipboard paste to detect images and files
  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onImagePaste && !onFilePaste) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        // Images handled by existing onImagePaste
        if (item.type.startsWith("image/") && onImagePaste) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            onImagePaste(blob);
          }
          return;
        }
        // Non-image files handled by onFilePaste
        if (item.kind === "file" && !item.type.startsWith("image/") && onFilePaste) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            onFilePaste(file);
          }
          return;
        }
      }
      // If no file found, let default text paste proceed
    },
    [onImagePaste, onFilePaste],
  );

  // Drag-and-drop support for images and files
  const [isDragging, setIsDragging] = React.useState(false);
  const dragCounterRef = React.useRef(0);

  const handleDragEnter = React.useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      dragCounterRef.current++;
      if (e.dataTransfer.types.includes("Files")) {
        setIsDragging(true);
      }
    },
    [],
  );

  const handleDragLeave = React.useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    },
    [],
  );

  const handleDragOver = React.useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      if (e.dataTransfer.types.includes("Files")) {
        e.dataTransfer.dropEffect = "copy";
      }
    },
    [],
  );

  const handleDrop = React.useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;

      for (const file of Array.from(files)) {
        if (file.type.startsWith("image/") && onImagePaste) {
          onImagePaste(file);
        } else if (onFilePaste) {
          onFilePaste(file);
        }
      }
    },
    [onImagePaste, onFilePaste],
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
          outline: isDragging ? `2px dashed ${theme.colors.success}` : "none",
          outlineOffset: isDragging ? "-2px" : undefined,
          borderRadius: isDragging ? "8px" : undefined,
          resize: "none" as const,
          backgroundColor: isDragging ? `${theme.colors.success}08` : "transparent",
          fontFamily: Typography.default().fontFamily,
          lineHeight: "1.4",
          scrollbarWidth: "none",
          paddingTop: props.paddingTop,
          paddingBottom: props.paddingBottom,
          paddingLeft: props.paddingLeft,
          paddingRight: props.paddingRight,
          transition: "background-color 0.15s, outline 0.15s",
        }}
        placeholder={isDragging ? "Drop files here..." : placeholder}
        value={value}
        onChange={handleChange}
        onSelect={handleSelect}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        maxRows={maxRows}
        autoCapitalize="sentences"
        autoCorrect="on"
        autoComplete="off"
      />
    </View>
  );
});

MultiTextInput.displayName = "MultiTextInput";
