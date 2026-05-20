/**
 * StreamingTextView — ultra-lightweight text renderer for in-progress streaming messages.
 *
 * During streaming, each text-delta update causes a full MarkdownView re-parse of the
 * growing text (100% cache-miss, O(n²) total work). This component avoids that cost
 * by rendering raw text without Markdown parsing. Once streaming finishes, the parent
 * switches back to MarkdownView for full formatting.
 *
 * Visual design intentionally matches MarkdownView's base text style so the
 * transition is imperceptible for plain prose. Code blocks / lists will appear
 * unformatted during streaming and snap to Markdown on completion — acceptable
 * because the user is watching text arrive, not reading formatted output yet.
 */
import * as React from "react";
import { Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";

type Props = {
  text: string;
};

export const StreamingTextView = React.memo(({ text }: Props) => {
  const { theme } = useUnistyles();
  return (
    <Text
      style={[styles.text, { color: theme.colors.text }]}
      // Keep selectable so users can still long-press during streaming
      selectable={false}
    >
      {text}
    </Text>
  );
});

const styles = StyleSheet.create(() => ({
  text: {
    ...Typography.default(),
    fontSize: 15,
    lineHeight: 23,
    marginTop: 6,
    marginBottom: 6,
    fontWeight: "400",
  },
}));
