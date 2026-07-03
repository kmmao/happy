import * as React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { ToolViewProps } from "./_all";
import { CodeView } from "@/components/CodeView";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { knownTools } from "../knownTools";
import { toolFullViewStyles } from "../ToolFullView";
import { buildToolFullViewTheme } from "../toolChromeTheme";
import { summarizeToolResult } from "../summarizeToolResult";
import { getToolProvider } from "../toolProvider";
import { t } from "@/text";

/**
 * Full-screen view for Skill tool invocations. Mirrors the inline SkillView's
 * intent — render the human-readable `args` as Markdown instead of dumping raw
 * `{ skill, args }` JSON — while still preserving the output/error sections
 * that the generic full-view fallback would otherwise provide (the skill's
 * result text is meaningful, unlike e.g. Edit).
 */
export const SkillViewFull = React.memo<ToolViewProps>(({ tool, metadata }) => {
  const { theme } = useUnistyles();
  const toolProvider = getToolProvider({ toolName: tool.name, metadata });
  const fullViewTheme = buildToolFullViewTheme(toolProvider, theme);
  const styles = toolFullViewStyles;

  const parsed = knownTools.Skill.input.safeParse(tool.input);
  const args =
    parsed.success && typeof parsed.data.args === "string"
      ? parsed.data.args.trim()
      : "";

  // Anything beyond the known skill/args keys is rare; surface it as JSON.
  const rest: Record<string, unknown> = {};
  if (tool.input && typeof tool.input === "object") {
    for (const [key, value] of Object.entries(
      tool.input as Record<string, unknown>,
    )) {
      if (key !== "skill" && key !== "args") rest[key] = value;
    }
  }
  const hasRest = Object.keys(rest).length > 0;

  return (
    <>
      {/* Arguments (rendered as Markdown instead of raw JSON) */}
      {!!args && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="log-in" size={20} color={fullViewTheme.inputIconColor} />
            <Text
              style={[styles.sectionTitle, { color: fullViewTheme.sectionTitleColor }]}
            >
              {t("toolView.arguments")}
            </Text>
          </View>
          <MarkdownView markdown={args} />
        </View>
      )}

      {/* Unexpected extra keys fall back to JSON */}
      {hasRest && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="log-in" size={20} color={fullViewTheme.inputIconColor} />
            <Text
              style={[styles.sectionTitle, { color: fullViewTheme.sectionTitleColor }]}
            >
              {t("tools.fullView.inputParams")}
            </Text>
          </View>
          <CodeView code={JSON.stringify(rest, null, 2)} />
        </View>
      )}

      {/* Result / Output */}
      {tool.state === "completed" && tool.result && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="log-out" size={20} color={fullViewTheme.outputIconColor} />
            <Text
              style={[styles.sectionTitle, { color: fullViewTheme.sectionTitleColor }]}
            >
              {t("tools.fullView.output")}
            </Text>
          </View>
          <CodeView code={summarizeToolResult(tool.result)} />
        </View>
      )}

      {/* Error details */}
      {tool.state === "error" && tool.result && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="close-circle" size={20} color={fullViewTheme.errorIconColor} />
            <Text
              style={[styles.sectionTitle, { color: fullViewTheme.sectionTitleColor }]}
            >
              {t("tools.fullView.error")}
            </Text>
          </View>
          <View
            style={[
              styles.errorContainer,
              {
                backgroundColor: fullViewTheme.errorBackground,
                borderColor: fullViewTheme.errorBorder,
              },
            ]}
          >
            <Text style={[styles.errorText, { color: fullViewTheme.errorText }]}>
              {String(tool.result)}
            </Text>
          </View>
        </View>
      )}

      {/* Completed with no output */}
      {tool.state === "completed" && !tool.result && (
        <View style={styles.section}>
          <View style={styles.emptyOutputContainer}>
            <Ionicons
              name="checkmark-circle-outline"
              size={48}
              color={fullViewTheme.emptyIconColor}
            />
            <Text
              style={[styles.emptyOutputText, { color: fullViewTheme.sectionTitleColor }]}
            >
              {t("tools.fullView.completed")}
            </Text>
            <Text
              style={[styles.emptyOutputSubtext, { color: fullViewTheme.descriptionColor }]}
            >
              {t("tools.fullView.noOutput")}
            </Text>
          </View>
        </View>
      )}
    </>
  );
});
