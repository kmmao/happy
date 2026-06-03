import * as React from "react";
import { View } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import TextareaAutosize from "react-textarea-autosize";
import { Typography } from "@/constants/Typography";
import { shouldCreatePasteBlock } from "./pasteBlock";
import { log } from "@/log";

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
  onLargeTextPaste?: (text: string) => void;
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
    onLargeTextPaste,
  } = props;

  const { theme } = useUnistyles();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const shiftPressedRef = React.useRef(false);

  // Convert maxHeight to approximate maxRows (assuming ~24px line height)
  const maxRows = Math.floor(maxHeight / 24);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      shiftPressedRef.current = e.shiftKey;
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

  const handleKeyUp = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      shiftPressedRef.current = e.shiftKey;
    },
    [],
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

  // Detect the programming/query language of code-like text for syntax highlighting.
  function detectLanguage(text: string): string | null {
    // SQL / MyBatis
    if (
      /\b(INSERT INTO|SELECT .+ FROM|UPDATE .+ SET|DELETE FROM|CREATE TABLE|DROP TABLE)\b/i.test(text) ||
      /==>?\s*(Preparing|Parameters):/.test(text) ||
      /\bSqlSession\b/.test(text)
    ) return 'sql';
    // Java stack traces and class paths
    if (
      /\bat (com|org|java|javax|sun|io|net)\.[.\w$]+\(/.test(text) ||
      /\b(NullPointerException|IllegalArgumentException|NestedServletException)\b/.test(text) ||
      /org\.(apache|springframework)|javax\.servlet/.test(text)
    ) return 'java';
    // Python tracebacks and source
    if (
      /^Traceback \(most recent call last\):/m.test(text) ||
      /^\s+File ".+", line \d+/m.test(text) ||
      /^(from \w+ import |import \w+\n)/m.test(text)
    ) return 'python';
    // TypeScript (check before JS — more specific)
    if (
      /^(interface |type \w+ =|export (interface|type|enum))/m.test(text) ||
      /: (string|number|boolean|void|any|never)\b/.test(text)
    ) return 'typescript';
    // JavaScript
    if (
      /^(const |let |var |function |import |export )/m.test(text) ||
      /require\(['"]|module\.exports/.test(text)
    ) return 'javascript';
    // Go
    if (/^(func |package \w|type \w+ struct|goroutine \d+)/m.test(text)) return 'go';
    // Rust
    if (
      /^(fn |use |impl |pub (fn|struct|enum)|let mut )/m.test(text) ||
      /error\[E\d{4}\]/.test(text)
    ) return 'rust';
    // Bash/Shell
    if (/^#!\/(bin|usr)/.test(text) || /^\$ /.test(text)) return 'bash';
    // Generic application log (ERROR/WARN/INFO with timestamp or MyBatis markers)
    if (
      /\b(ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/.test(text) ||
      /\d{2,4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(text) ||
      /(?:==>|<==)/.test(text)
    ) return 'log';
    return null;
  }

  // Detect whether pasted text looks like code or a log, to auto-wrap in fences.
  function looksLikeCode(text: string): boolean {
    const lines = text.split("\n");
    if (lines.length < 3) return false;
    if (text.startsWith("```") || text.includes("\n```")) return false;
    // Java/Kotlin/Python stack traces (with or without leading whitespace)
    if (/\bat [\w.$<>]+\([\w.]+:\d+\)/.test(text)) return true;
    // Exception/Error headers
    if (/\b(Exception|Error|Caused by|NestedServletException):/.test(text)) return true;
    // Log lines with severity (relaxed: no bracket requirement, covers "ERROR o.jeecg..." format)
    if (/\b(ERROR|WARN|INFO|DEBUG|TRACE)\s+[\w\[.(]/.test(text)) return true;
    // Timestamp prefix: YYYY-MM-DD or MM-DD (e.g. 05-08 03:47:03)
    if (/\d{2,4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(text)) return true;
    // Source code keywords at line start
    if (/^(import |package |public class |private |protected |#include|def |function |const |let |var |type |interface |class )/m.test(text)) return true;
    // JSON object/array
    if (/^\s*[{[]/.test(text) && text.includes('":')) return true;
    // XML/HTML
    if (/^\s*<\w+/.test(text) && text.includes("</")) return true;
    // Long average line length with no natural prose sentences → likely code/log
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    if (nonEmptyLines.length >= 3) {
      const avgLen = nonEmptyLines.reduce((s, l) => s + l.length, 0) / nonEmptyLines.length;
      const hasSentences = /[.!?]\s+[A-Z]/.test(text);
      if (avgLen >= 80 && !hasSentences) return true;
    }
    return false;
  }

  // Intercept clipboard paste to detect images/files and handle text explicitly
  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;

      // Check for file/image paste first
      if (items && (onImagePaste || onFilePaste)) {
        const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|bmp|heic|heif|svg)$/i;

        // Capture file items synchronously while clipboardData is still valid
        const capturedFiles: { file: File; isImage: boolean }[] = [];
        for (const item of Array.from(items)) {
          if (item.kind !== "file") continue;
          const file = item.getAsFile();
          if (!file) continue;
          capturedFiles.push({
            file,
            isImage: item.type.startsWith("image/") || IMAGE_EXTS.test(file.name),
          });
        }

        if (capturedFiles.length > 0) {
          e.preventDefault();

          log.log(
            `[paste] clipboardData files=${capturedFiles.length}, types=${capturedFiles.map((f) => `${f.file.type}/${f.file.size}B`).join(",")}`,
          );

          // Use navigator.clipboard.read() for fresh clipboard data.
          // Chrome may serve stale data in e.clipboardData.items when the
          // clipboard was updated (e.g. macOS screenshot) after the page
          // last gained focus. The modern Clipboard API can pull the
          // current OS clipboard — but only AFTER Chrome has finished its
          // internal OS-clipboard sync, which is asynchronous and not
          // guaranteed to complete before the paste handler fires. We
          // therefore (1) wait a short tick to give Chrome time to sync,
          // and (2) treat a same-size-as-fallback result as suspected
          // stale and retry once with a longer delay.
          if (typeof navigator?.clipboard?.read === "function" && onImagePaste) {
            const fallbackImage = capturedFiles.find((f) => f.isImage);
            const fallbackImageSize = fallbackImage?.file.size;

            const readClipboardImage = async (): Promise<Blob | null> => {
              try {
                const clipboardItems = await navigator.clipboard.read();
                for (const ci of clipboardItems) {
                  const imageType = ci.types.find((t: string) =>
                    t.startsWith("image/"),
                  );
                  if (imageType) {
                    return await ci.getType(imageType);
                  }
                }
              } catch (err) {
                log.log("[paste] clipboard.read() failed", err);
              }
              return null;
            };

            void (async () => {
              // Brief delay so Chrome can finish syncing the OS clipboard
              // after the page regained focus. 80ms is below the human
              // latency threshold (~100ms). Transient activation persists
              // 5s, so subsequent clipboard.read() calls remain allowed.
              await new Promise((resolve) => setTimeout(resolve, 80));
              let blob = await readClipboardImage();

              // Same size as the fallback file strongly suggests Chrome's
              // OS-clipboard sync hasn't caught up yet (both reads served
              // from the same stale snapshot). Retry once with a longer
              // delay before giving up.
              if (
                blob &&
                fallbackImageSize !== undefined &&
                blob.size === fallbackImageSize
              ) {
                log.log(
                  `[paste] clipboard.read() blob size matched fallback (${blob.size}B), retrying after 200ms`,
                );
                await new Promise((resolve) => setTimeout(resolve, 200));
                const retried = await readClipboardImage();
                if (retried) blob = retried;
              }

              if (blob) {
                log.log(`[paste] clipboard.read() image: ${blob.size}B`);
                onImagePaste(blob);
                return;
              }

              // Fallback: use synchronously captured file from clipboardData
              const first = capturedFiles[0];
              if (first.isImage && onImagePaste) {
                onImagePaste(first.file);
              } else if (!first.isImage && onFilePaste) {
                onFilePaste(first.file);
              }
            })();
            return;
          }

          // No modern Clipboard API — use legacy clipboardData directly
          const first = capturedFiles[0];
          if (first.isImage && onImagePaste) {
            onImagePaste(first.file);
            return;
          }
          if (!first.isImage && onFilePaste) {
            onFilePaste(first.file);
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

      if (!shiftPressedRef.current && onLargeTextPaste && shouldCreatePasteBlock(pastedText)) {
        onLargeTextPaste(pastedText);
        return;
      }

      const textToInsert = looksLikeCode(pastedText)
        ? `\`\`\`${detectLanguage(pastedText) ?? ""}\n${pastedText}\n\`\`\``
        : pastedText;

      const textarea = e.currentTarget;

      // Use execCommand to preserve browser undo/redo history and trigger
      // TextareaAutosize height recalculation via native input event.
      // execCommand is deprecated but is the only way to insert text while
      // preserving undo stack — still supported in all major browsers.
      textarea.focus();
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      document.execCommand("insertText", false, textToInsert);

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
    [onImagePaste, onFilePaste, onLargeTextPaste, onChangeText, onStateChange, onSelectionChange],
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
        onKeyUp={handleKeyUp}
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
