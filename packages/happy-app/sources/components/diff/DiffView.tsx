import React, { useMemo, useState, useCallback } from "react";
import { View, Text, Pressable, ViewStyle } from "react-native";
import {
  calculateUnifiedDiff,
  splitDiffLines,
  DiffToken,
  DiffLine,
} from "@/components/diff/calculateDiff";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import {
  tokenizeLine,
  getSyntaxColor,
  SyntaxToken,
} from "@/components/diff/syntaxTokenizer";

interface DiffViewProps {
  oldText: string;
  newText: string;
  contextLines?: number;
  showLineNumbers?: boolean;
  showPlusMinusSymbols?: boolean;
  showDiffStats?: boolean;
  oldTitle?: string;
  newTitle?: string;
  style?: ViewStyle;
  maxHeight?: number;
  wrapLines?: boolean;
  fontScaleX?: number;
  collapsible?: boolean;
  language?: string | null;
  viewMode?: "unified" | "split";
  expandedContext?: boolean;
}

export const DiffView: React.FC<DiffViewProps> = ({
  oldText,
  newText,
  contextLines = 3,
  showLineNumbers = true,
  showPlusMinusSymbols = true,
  wrapLines = false,
  style,
  fontScaleX = 1,
  collapsible = false,
  language = null,
  viewMode = "unified",
  expandedContext = false,
}) => {
  // Always use light theme colors
  const { theme } = useUnistyles();
  const colors = theme.colors.diff;

  // Collapsible hunk state
  const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(new Set());

  const toggleHunk = useCallback((hunkIndex: number) => {
    setCollapsedHunks((prev) => {
      const next = new Set(prev);
      if (next.has(hunkIndex)) {
        next.delete(hunkIndex);
      } else {
        next.add(hunkIndex);
      }
      return next;
    });
  }, []);

  // Calculate diff with inline highlighting
  const effectiveContextLines = expandedContext ? 999999 : contextLines;
  const { hunks } = useMemo(() => {
    return calculateUnifiedDiff(oldText, newText, effectiveContextLines);
  }, [oldText, newText, effectiveContextLines]);

  // Styles
  const containerStyle: ViewStyle = {
    backgroundColor: theme.colors.surface,
    borderWidth: 0,
    flex: 1,
    ...style,
  };

  // Helper function to format line content
  const formatLineContent = (content: string) => {
    // Just trim trailing spaces, we'll handle leading spaces in rendering
    return content.trimEnd();
  };

  // Helper function to render syntax-highlighted content (no inline diff tokens)
  const renderSyntaxContent = (
    content: string,
    syntaxTokens: SyntaxToken[],
  ) => {
    const formatted = formatLineContent(content);
    if (!formatted) return null;

    // Process leading spaces from the first token
    let processedLeadingSpaces = false;

    return syntaxTokens.map((token, idx) => {
      const tokenColor = getSyntaxColor(token.type, token.nestLevel, theme);

      if (!processedLeadingSpaces && token.text) {
        const leadingMatch = token.text.match(/^( +)/);
        if (leadingMatch) {
          processedLeadingSpaces = true;
          const leadingDots = "\u00b7".repeat(leadingMatch[0].length);
          const restOfToken = token.text.slice(leadingMatch[0].length);
          return (
            <Text key={idx}>
              <Text style={{ color: colors.leadingSpaceDot }}>
                {leadingDots}
              </Text>
              <Text style={{ color: tokenColor }}>{restOfToken}</Text>
            </Text>
          );
        }
        processedLeadingSpaces = true;
      }

      return (
        <Text key={idx} style={{ color: tokenColor }}>
          {token.text}
        </Text>
      );
    });
  };

  // Helper function to render line content with styled leading space dots and inline highlighting
  const renderLineContent = (
    content: string,
    baseColor: string,
    tokens?: DiffToken[],
    syntaxTokens?: SyntaxToken[],
  ) => {
    const formatted = formatLineContent(content);

    if (tokens && tokens.length > 0) {
      // Render with inline highlighting (diff tokens take priority over syntax)
      let processedLeadingSpaces = false;

      return tokens.map((token, idx) => {
        // Process leading spaces in the first token only
        if (!processedLeadingSpaces && token.value) {
          const leadingMatch = token.value.match(/^( +)/);
          if (leadingMatch) {
            processedLeadingSpaces = true;
            const leadingDots = "\u00b7".repeat(leadingMatch[0].length);
            const restOfToken = token.value.slice(leadingMatch[0].length);

            if (token.added || token.removed) {
              return (
                <Text key={idx}>
                  <Text style={{ color: colors.leadingSpaceDot }}>
                    {leadingDots}
                  </Text>
                  <Text
                    style={{
                      backgroundColor: token.added
                        ? colors.inlineAddedBg
                        : colors.inlineRemovedBg,
                      color: token.added
                        ? colors.inlineAddedText
                        : colors.inlineRemovedText,
                    }}
                  >
                    {restOfToken}
                  </Text>
                </Text>
              );
            }
            return (
              <Text key={idx}>
                <Text style={{ color: colors.leadingSpaceDot }}>
                  {leadingDots}
                </Text>
                <Text style={{ color: baseColor }}>{restOfToken}</Text>
              </Text>
            );
          }
          processedLeadingSpaces = true;
        }

        if (token.added || token.removed) {
          return (
            <Text
              key={idx}
              style={{
                backgroundColor: token.added
                  ? colors.inlineAddedBg
                  : colors.inlineRemovedBg,
                color: token.added
                  ? colors.inlineAddedText
                  : colors.inlineRemovedText,
              }}
            >
              {token.value}
            </Text>
          );
        }
        return (
          <Text key={idx} style={{ color: baseColor }}>
            {token.value}
          </Text>
        );
      });
    }

    // Syntax-highlighted rendering (no inline diff tokens)
    if (syntaxTokens && syntaxTokens.length > 0) {
      return renderSyntaxContent(content, syntaxTokens);
    }

    // Regular rendering without tokens
    const leadingSpaces = formatted.match(/^( +)/);
    const leadingDots = leadingSpaces
      ? "\u00b7".repeat(leadingSpaces[0].length)
      : "";
    const mainContent = leadingSpaces
      ? formatted.slice(leadingSpaces[0].length)
      : formatted;

    return (
      <>
        {leadingDots && (
          <Text style={{ color: colors.leadingSpaceDot }}>{leadingDots}</Text>
        )}
        <Text style={{ color: baseColor }}>{mainContent}</Text>
      </>
    );
  };

  // Render diff content as separate lines to prevent wrapping
  const renderDiffContent = () => {
    const lines: React.ReactNode[] = [];

    const canCollapse = collapsible && hunks.length > 1;

    hunks.forEach((hunk, hunkIndex) => {
      // Add hunk header for non-first hunks
      if (hunkIndex > 0) {
        const isCollapsed = collapsedHunks.has(hunkIndex);
        const headerText = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;

        const headerContent = (
          <View
            key={`hunk-header-${hunkIndex}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: colors.hunkHeaderBg,
              paddingVertical: 8,
              paddingHorizontal: 12,
            }}
          >
            {canCollapse && (
              <Ionicons
                name={isCollapsed ? "chevron-forward" : "chevron-down"}
                size={12}
                color={colors.hunkHeaderText}
                style={{ marginRight: 4 }}
              />
            )}
            <Text
              numberOfLines={wrapLines ? undefined : 1}
              style={{
                ...Typography.mono(),
                fontSize: 12,
                color: colors.hunkHeaderText,
                transform: [{ scaleX: fontScaleX }],
              }}
            >
              {headerText}
            </Text>
          </View>
        );

        if (canCollapse) {
          lines.push(
            <Pressable
              key={`hunk-pressable-${hunkIndex}`}
              onPress={() => toggleHunk(hunkIndex)}
            >
              {headerContent}
            </Pressable>,
          );
        } else {
          lines.push(headerContent);
        }
      }

      // Skip hunk lines if collapsed
      if (canCollapse && collapsedHunks.has(hunkIndex)) {
        return;
      }

      hunk.lines.forEach((line, lineIndex) => {
        const isAdded = line.type === "add";
        const isRemoved = line.type === "remove";
        const textColor = isAdded
          ? colors.addedText
          : isRemoved
            ? colors.removedText
            : colors.contextText;
        const bgColor = isAdded
          ? colors.addedBg
          : isRemoved
            ? colors.removedBg
            : colors.contextBg;

        // Compute syntax tokens only when language is set and line has no inline diff tokens
        const hasDiffTokens = line.tokens && line.tokens.length > 0;
        const syntaxTokens =
          language && !hasDiffTokens
            ? tokenizeLine(line.content, language)
            : undefined;

        // Render complete line in a single Text element
        lines.push(
          <Text
            key={`line-${hunkIndex}-${lineIndex}`}
            numberOfLines={wrapLines ? undefined : 1}
            style={{
              ...Typography.mono(),
              fontSize: 13,
              lineHeight: 20,
              backgroundColor: bgColor,
              transform: [{ scaleX: fontScaleX }],
              paddingLeft: 8,
              paddingRight: 8,
            }}
          >
            {showLineNumbers && (
              <Text
                style={{
                  color: colors.lineNumberText,
                  backgroundColor: colors.lineNumberBg,
                }}
              >
                {String(
                  line.type === "remove"
                    ? line.oldLineNumber
                    : line.type === "add"
                      ? line.newLineNumber
                      : line.oldLineNumber,
                ).padStart(3, " ")}
              </Text>
            )}
            {showPlusMinusSymbols && (
              <Text style={{ color: textColor }}>
                {` ${isAdded ? "+" : isRemoved ? "-" : " "} `}
              </Text>
            )}
            {renderLineContent(
              line.content,
              textColor,
              line.tokens,
              syntaxTokens,
            )}
          </Text>,
        );
      });
    });

    return lines;
  };

  // Render a single side of a split row
  const renderSplitSide = (
    line: DiffLine | undefined,
    side: "left" | "right",
    rowIndex: number,
  ) => {
    if (!line) {
      // Empty placeholder
      return (
        <View
          key={`${side}-${rowIndex}`}
          style={{
            flex: 1,
            backgroundColor: colors.contextBg,
            opacity: 0.5,
            minHeight: 20,
          }}
        />
      );
    }

    const isAdded = line.type === "add";
    const isRemoved = line.type === "remove";
    const textColor = isAdded
      ? colors.addedText
      : isRemoved
        ? colors.removedText
        : colors.contextText;
    const bgColor = isAdded
      ? colors.addedBg
      : isRemoved
        ? colors.removedBg
        : colors.contextBg;

    const hasDiffTokens = line.tokens && line.tokens.length > 0;
    const syntaxTokens =
      language && !hasDiffTokens
        ? tokenizeLine(line.content, language)
        : undefined;

    const lineNum = side === "left" ? line.oldLineNumber : line.newLineNumber;

    return (
      <Text
        key={`${side}-${rowIndex}`}
        style={{
          flex: 1,
          ...Typography.mono(),
          fontSize: 13,
          lineHeight: 20,
          backgroundColor: bgColor,
          transform: [{ scaleX: fontScaleX }],
          paddingLeft: 4,
          paddingRight: 4,
        }}
      >
        {showLineNumbers && lineNum != null && (
          <Text
            style={{
              color: colors.lineNumberText,
              backgroundColor: colors.lineNumberBg,
            }}
          >
            {String(lineNum).padStart(3, " ")}
          </Text>
        )}
        <Text style={{ color: textColor }}>
          {` ${isAdded ? "+" : isRemoved ? "-" : " "} `}
        </Text>
        {renderLineContent(line.content, textColor, line.tokens, syntaxTokens)}
      </Text>
    );
  };

  // Render split (side-by-side) diff content
  const renderSplitContent = () => {
    const rows: React.ReactNode[] = [];

    const canCollapse = collapsible && hunks.length > 1;

    hunks.forEach((hunk, hunkIndex) => {
      // Hunk header
      if (hunkIndex > 0) {
        const isCollapsed = collapsedHunks.has(hunkIndex);
        const headerText = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;

        const headerContent = (
          <View
            key={`split-hunk-header-${hunkIndex}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: colors.hunkHeaderBg,
              paddingVertical: 8,
              paddingHorizontal: 12,
            }}
          >
            {canCollapse && (
              <Ionicons
                name={isCollapsed ? "chevron-forward" : "chevron-down"}
                size={12}
                color={colors.hunkHeaderText}
                style={{ marginRight: 4 }}
              />
            )}
            <Text
              numberOfLines={1}
              style={{
                ...Typography.mono(),
                fontSize: 12,
                color: colors.hunkHeaderText,
                transform: [{ scaleX: fontScaleX }],
              }}
            >
              {headerText}
            </Text>
          </View>
        );

        if (canCollapse) {
          rows.push(
            <Pressable
              key={`split-hunk-pressable-${hunkIndex}`}
              onPress={() => toggleHunk(hunkIndex)}
            >
              {headerContent}
            </Pressable>,
          );
        } else {
          rows.push(headerContent);
        }
      }

      if (canCollapse && collapsedHunks.has(hunkIndex)) {
        return;
      }

      // Convert hunk lines to split rows
      const splitRows = splitDiffLines(hunk.lines);

      splitRows.forEach((row, rowIndex) => {
        rows.push(
          <View
            key={`split-row-${hunkIndex}-${rowIndex}`}
            style={{ flexDirection: "row" }}
          >
            {renderSplitSide(row.left, "left", rowIndex)}
            <View
              style={{
                width: 1,
                backgroundColor: colors.outline,
              }}
            />
            {renderSplitSide(row.right, "right", rowIndex)}
          </View>,
        );
      });
    });

    return rows;
  };

  return (
    <View style={[containerStyle, { overflow: "hidden" }]}>
      {viewMode === "split" ? renderSplitContent() : renderDiffContent()}
    </View>
  );

  // return (
  //     <View style={containerStyle}>
  //         {/* Header */}
  //         <View style={headerStyle}>
  //             <Text style={titleStyle}>
  //                 {`${oldTitle} → ${newTitle}`}
  //             </Text>

  //             {showDiffStats && (
  //                 <View style={{ flexDirection: 'row', gap: 8 }}>
  //                     <Text style={[statsStyle, { color: colors.success }]}>
  //                         +{stats.additions}
  //                     </Text>
  //                     <Text style={[statsStyle, { color: colors.error }]}>
  //                         -{stats.deletions}
  //                     </Text>
  //                 </View>
  //             )}
  //         </View>

  //         {/* Diff content */}
  //         <ScrollView
  //             style={{ flex: 1 }}
  //             nestedScrollEnabled
  //             showsVerticalScrollIndicator={true}
  //         >
  //             <ScrollView
  //                 ref={scrollRef}
  //                 horizontal={!wrapLines}
  //                 showsHorizontalScrollIndicator={!wrapLines}
  //                 contentContainerStyle={{ flexGrow: 1 }}
  //             >
  //                 {content}
  //             </ScrollView>
  //         </ScrollView>
  //     </View>
  // );
};
