import * as React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons, Octicons } from "@expo/vector-icons";
import { getToolViewComponent } from "./views/_all";
import { Message, ToolCall } from "@/sync/typesMessage";
import { AgentEvent } from "@/sync/typesRaw";
import { CodeView } from "../CodeView";
import { ToolSectionView } from "./ToolSectionView";
import { useElapsedTime } from "@/hooks/useElapsedTime";
import { ToolError } from "./ToolError";
import {
  knownTools,
  sessionCompactToolNames,
} from "@/components/tools/knownTools";
import { getCodexPatchEntries } from "./codexPatchUtils";
import { Metadata } from "@/sync/storageTypes";
import { useRouter } from "expo-router";
import { parseToolUseError } from "@/utils/toolErrorParser";
import { formatMCPTitle } from "./views/MCPToolView";
import { useSetting } from "@/sync/storage";
import { t } from "@/text";
import { DiffStatsBar } from "@/components/diff/DiffStatsBar";
import {
  buildToolCardTheme,
} from "@/components/tools/toolChromeTheme";
import { getToolProvider } from "@/components/tools/toolProvider";
import * as Clipboard from "expo-clipboard";
import { Modal } from "@/modal/ModalManager";
import { sessionAllow } from "@/sync/ops";
import { PermissionFooter } from "./PermissionFooter";
import { shouldAutoApprove } from "@/utils/shouldAutoApprove";
import { log } from '@/log';
import {
  getCodexCommandText,
  getCodexParsedCommandSummary,
} from "./codexCommandUtils";
import { getCodexBashIconName } from "./codexBashPresentation";
import { shouldHideToolCall } from "./shouldHideToolCall";

interface ToolViewProps {
  metadata: Metadata | null;
  tool: ToolCall;
  messages?: Message[];
  onPress?: () => void;
  sessionId?: string;
  messageId?: string;
  permissionModeKey?: string | null;
}

export const ToolView = React.memo<ToolViewProps>((props) => {
  const { tool, onPress, sessionId, messageId } = props;
  const router = useRouter();
  const { theme } = useUnistyles();
  const showAgentActivity = useSetting("showAgentActivity");
  const SpecificToolView = getToolViewComponent(tool.name);
  const patchEntryCount = React.useMemo(
    () =>
      tool.name === "CodexPatch"
        ? getCodexPatchEntries(tool.input?.changes).length
        : 0,
    [tool.name, tool.input?.changes],
  );
  const subAgentModel = React.useMemo(() => {
    if (
      (tool.name !== "Agent" && tool.name !== "Task") ||
      !props.messages?.length
    ) {
      return null;
    }
    for (const m of props.messages) {
      if (m.kind === "agent-event") {
        const evt = m.event as AgentEvent;
        if ("model" in evt && evt.model) {
          return (evt.model as string).replace(/-\d{8}$/, "");
        }
      }
    }
    return null;
  }, [tool.name, props.messages]);

  const useMergedInlineToolView =
    tool.name === "CodexDiff" ||
    (tool.name === "CodexPatch" && patchEntryCount === 1);
  const toolProvider = getToolProvider({
    toolName: tool.name,
    metadata: props.metadata,
  });
  const cardTheme = buildToolCardTheme(toolProvider, theme);

  // Create default onPress handler for navigation
  const handlePress = React.useCallback(() => {
    if (onPress) {
      onPress();
    } else if (sessionId && messageId) {
      router.push(`/session/${sessionId}/message/${messageId}`);
    }
  }, [onPress, sessionId, messageId, router]);

  // Enable pressable if either onPress is provided or we have navigation params
  const isPressable = !!(onPress || (sessionId && messageId));

  // Long-press context menu
  const handleLongPress = React.useCallback(() => {
    const buttons: Array<{ text: string; onPress?: () => void }> = [];

    // Copy file path
    const filePath = tool.input?.file_path;
    if (filePath && typeof filePath === "string") {
      buttons.push({
        text: t("tools.contextMenu.copyPath"),
        onPress: () => {
          Clipboard.setStringAsync(filePath);
        },
      });
    }

    // Copy command
    const command = getCodexCommandText(tool.input?.command);
    if (command) {
      buttons.push({
        text: t("tools.contextMenu.copyCommand"),
        onPress: () => {
          Clipboard.setStringAsync(command);
        },
      });
    }

    // Copy output
    if (tool.state === "completed" && tool.result) {
      const resultText =
        typeof tool.result === "string"
          ? tool.result
          : JSON.stringify(tool.result, null, 2);
      buttons.push({
        text: t("tools.contextMenu.copyOutput"),
        onPress: () => {
          Clipboard.setStringAsync(resultText);
        },
      });
    }

    if (buttons.length === 0) return;

    buttons.push({ text: t("common.cancel") });
    Modal.alert(tool.name, undefined, buttons);
  }, [tool]);

  // Auto-approve tool permissions based on permission mode.
  // In default mode: never auto-approve — show PermissionFooter for manual review.
  // In other modes: auto-approve per shouldAutoApprove() with fallback on failure.
  const [autoApproveFailed, setAutoApproveFailed] = React.useState(false);
  const willAutoApprove = shouldAutoApprove(props.permissionModeKey, tool.name);
  const hideToolCall = shouldHideToolCall(tool);

  React.useEffect(() => {
    if (
      hideToolCall ||
      !sessionId ||
      tool.permission?.status !== "pending" ||
      !tool.permission?.id ||
      !willAutoApprove
    ) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await sessionAllow(sessionId, tool.permission!.id);
      } catch (error) {
        log.error("Auto-approve failed, falling back to manual review:", error);
        if (!cancelled) {
          setAutoApproveFailed(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [
    sessionId,
    tool.permission?.status,
    tool.permission?.id,
    willAutoApprove,
    hideToolCall,
  ]);

  if (hideToolCall) {
    return null;
  }

  let knownTool = knownTools[tool.name as keyof typeof knownTools] as any;
  const isSessionCompact = sessionCompactToolNames.has(tool.name);

  // Internal Claude Code tools (e.g. ToolSearch) are completely hidden from the UI
  if (knownTool?.hidden) {
    return null;
  }

  let description: string | null = null;
  let status: string | null = null;
  let minimal = false;
  let icon = (
    <Ionicons
      name="construct-outline"
      size={18}
      color={theme.colors.textSecondary}
    />
  );
  let noStatus = false;
  let hideDefaultError = false;

  // For Gemini: unknown tools should be rendered as minimal (hidden)
  // This prevents showing raw INPUT/OUTPUT for internal Gemini tools
  // that we haven't explicitly added to knownTools
  const isGemini = props.metadata?.flavor === "gemini";
  if (!knownTool && isGemini) {
    minimal = true;
  }

  // Extract status first to potentially use as title
  if (knownTool && typeof knownTool.extractStatus === "function") {
    const state = knownTool.extractStatus({ tool, metadata: props.metadata });
    if (typeof state === "string" && state) {
      status = state;
    }
  }

  // Handle optional title and function type
  let toolTitle = tool.name;

  // Special handling for MCP tools
  if (tool.name.startsWith("mcp__") && !knownTool) {
    toolTitle = formatMCPTitle(tool.name);
    icon = (
      <Ionicons
        name="extension-puzzle-outline"
        size={18}
        color={theme.colors.textSecondary}
      />
    );
    minimal = true;
  } else if (knownTool?.title) {
    if (typeof knownTool.title === "function") {
      toolTitle = knownTool.title({ tool, metadata: props.metadata });
    } else {
      toolTitle = knownTool.title;
    }
  }

  if (
    knownTool &&
    typeof knownTool.extractSubtitle === "function" &&
    !isSessionCompact
  ) {
    const subtitle = knownTool.extractSubtitle({
      tool,
      metadata: props.metadata,
    });
    if (typeof subtitle === "string" && subtitle) {
      description = subtitle;
    }
  }

  // For Task tool: derive subtitle from the currently running child tool
  // This provides real-time feedback about what the subagent is doing
  if (
    (tool.name === "Task" || tool.name === "Agent") &&
    !description &&
    props.messages
  ) {
    for (let i = props.messages.length - 1; i >= 0; i--) {
      const m = props.messages[i];
      if (m.kind === "tool-call" && m.tool.state === "running") {
        const childKnown = knownTools[
          m.tool.name as keyof typeof knownTools
        ] as any;
        let childTitle = m.tool.name;
        if (childKnown) {
          if (
            "extractDescription" in childKnown &&
            typeof childKnown.extractDescription === "function"
          ) {
            childTitle = childKnown.extractDescription({
              tool: m.tool,
              metadata: props.metadata,
            });
          } else if (typeof childKnown.title === "function") {
            childTitle = childKnown.title({
              tool: m.tool,
              metadata: props.metadata,
            });
          } else if (childKnown.title) {
            childTitle = childKnown.title;
          }
        }
        description = childTitle;
        break;
      }
    }
  }

  // When showAgentActivity is enabled and tool is running without a subtitle,
  // show tool.description or extract a brief description from tool.input
  // (skip for Task tool to avoid repeating the title)
  if (
    showAgentActivity &&
    tool.state === "running" &&
    !description &&
    tool.name !== "Task" &&
    tool.name !== "Agent" &&
    !isSessionCompact
  ) {
    if (tool.description) {
      description = tool.description;
    } else if (
      tool.input?.description &&
      typeof tool.input.description === "string"
    ) {
      description = tool.input.description;
    } else if (tool.input?.command && typeof tool.input.command === "string") {
      description = tool.input.command.slice(0, 80);
    } else if (
      tool.input?.file_path &&
      typeof tool.input.file_path === "string"
    ) {
      description = tool.input.file_path;
    } else if (tool.input?.pattern && typeof tool.input.pattern === "string") {
      description = tool.input.pattern;
    }
  }

  if (knownTool && knownTool.minimal !== undefined) {
    if (typeof knownTool.minimal === "function") {
      minimal = knownTool.minimal({
        tool,
        metadata: props.metadata,
        messages: props.messages,
      });
    } else {
      minimal = knownTool.minimal;
    }
  }
  if (isSessionCompact) {
    minimal = true;
  }

  // Special handling for CodexBash to determine icon from semantic summary
  if (tool.name === "CodexBash") {
    const parsedSummary = getCodexParsedCommandSummary(
      tool.input,
      props.metadata,
    );
    if (parsedSummary) {
      icon = (
        <Octicons
          name={getCodexBashIconName(parsedSummary) as any}
          size={18}
          color={cardTheme.iconColor}
        />
      );
    }
  } else if (knownTool && typeof knownTool.icon === "function") {
    icon = knownTool.icon(18, cardTheme.iconColor);
  }

  if (knownTool && typeof knownTool.noStatus === "boolean") {
    noStatus = knownTool.noStatus;
  }
  if (knownTool && typeof knownTool.hideDefaultError === "boolean") {
    hideDefaultError = knownTool.hideDefaultError;
  }

  // Calculate diff stats for Edit/Write/MultiEdit tools
  const diffStats = React.useMemo(() => {
    if (knownTool && typeof knownTool.extractStats === "function") {
      return knownTool.extractStats({ tool, metadata: props.metadata });
    }
    return null;
  }, [knownTool, tool, props.metadata]);

  let statusIcon = null;

  let isToolUseError = false;
  if (
    tool.state === "error" &&
    tool.result &&
    parseToolUseError(tool.result).isToolUseError
  ) {
    isToolUseError = true;
    log.log("isToolUseError", tool.result);
  }

  // Check permission status first for denied/canceled states
  if (
    tool.permission &&
    (tool.permission.status === "denied" ||
      tool.permission.status === "canceled")
  ) {
    statusIcon = (
      <Ionicons
        name="remove-circle-outline"
        size={20}
        color={cardTheme.mutedStatusColor}
      />
    );
  } else if (isToolUseError) {
    statusIcon = (
      <Ionicons
        name="remove-circle-outline"
        size={20}
        color={cardTheme.mutedStatusColor}
      />
    );
    hideDefaultError = true;
    minimal = true;
  } else {
    switch (tool.state) {
      case "running":
        if (!noStatus && !isSessionCompact) {
          statusIcon = (
            <ActivityIndicator
              size="small"
              color={cardTheme.runningColor}
              style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
            />
          );
        }
        break;
      case "completed":
        break;
      case "error":
        statusIcon = (
          <Ionicons
            name="alert-circle-outline"
            size={20}
            color={cardTheme.errorColor}
          />
        );
        break;
    }
  }

  const statsBar =
    diffStats && (tool.state !== "running" || isSessionCompact) ? (
      <DiffStatsBar
        additions={diffStats.additions}
        deletions={diffStats.deletions}
        provider={toolProvider}
      />
    ) : null;

  if (useMergedInlineToolView && SpecificToolView) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: cardTheme.containerBackground,
            borderRadius: cardTheme.borderRadius,
            borderColor: cardTheme.borderColor ?? undefined,
            borderWidth: cardTheme.borderWidth,
          },
        ]}
      >
        <View style={styles.mergedToolContent}>
          <SpecificToolView
            tool={tool}
            metadata={props.metadata}
            messages={props.messages ?? []}
            sessionId={sessionId}
          />
        </View>
        {sessionId &&
          tool.permission &&
          tool.permission.status === "pending" &&
          tool.name !== "AskUserQuestion" &&
          (!willAutoApprove || autoApproveFailed) && (
            <PermissionFooter
              permission={tool.permission}
              sessionId={sessionId}
              toolName={tool.name}
              toolInput={tool.input}
              metadata={props.metadata}
            />
          )}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: cardTheme.containerBackground,
          borderRadius: cardTheme.borderRadius,
          borderColor: cardTheme.borderColor ?? undefined,
          borderWidth: cardTheme.borderWidth,
        },
      ]}
    >
      {isPressable ? (
        <TouchableOpacity
          style={[
            styles.header,
            { backgroundColor: cardTheme.headerBackground },
          ]}
          onPress={handlePress}
          onLongPress={handleLongPress}
          activeOpacity={0.8}
        >
          <View style={styles.headerLeft}>
            <View style={styles.iconContainer}>{icon}</View>
            <View style={styles.titleContainer}>
              <Text style={[styles.toolName, { color: cardTheme.titleColor }]}>
                {toolTitle}
                {status ? (
                  <Text style={styles.status}>{` ${status}`}</Text>
                ) : null}
              </Text>
              {description && (
                <Text
                  style={[
                    styles.toolDescription,
                    { color: cardTheme.subtitleColor },
                  ]}
                >
                  {description}
                </Text>
              )}
            </View>
            {subAgentModel ? (
              <View style={styles.subAgentModelBadge}>
                <Text style={styles.subAgentModelText}>{subAgentModel}</Text>
              </View>
            ) : null}
            {statsBar}
            {tool.state === "running" ? (
              <View style={styles.elapsedContainer}>
                <ElapsedView
                  from={tool.createdAt}
                  color={cardTheme.elapsedColor}
                />
              </View>
            ) : tool.completedAt ? (
              <View style={styles.elapsedContainer}>
                <CompletedDurationView
                  from={tool.createdAt}
                  to={tool.completedAt}
                  color={cardTheme.elapsedColor}
                />
              </View>
            ) : null}
            {statusIcon}
          </View>
        </TouchableOpacity>
      ) : (
        <Pressable
          style={[
            styles.header,
            { backgroundColor: cardTheme.headerBackground },
          ]}
          onLongPress={handleLongPress}
        >
          <View style={styles.headerLeft}>
            <View style={styles.iconContainer}>{icon}</View>
            <View style={styles.titleContainer}>
              <Text style={[styles.toolName, { color: cardTheme.titleColor }]}>
                {toolTitle}
                {status ? (
                  <Text style={styles.status}>{` ${status}`}</Text>
                ) : null}
              </Text>
              {description && (
                <Text
                  style={[
                    styles.toolDescription,
                    { color: cardTheme.subtitleColor },
                  ]}
                >
                  {description}
                </Text>
              )}
            </View>
            {subAgentModel ? (
              <View style={styles.subAgentModelBadge}>
                <Text style={styles.subAgentModelText}>{subAgentModel}</Text>
              </View>
            ) : null}
            {statsBar}
            {tool.state === "running" ? (
              <View style={styles.elapsedContainer}>
                <ElapsedView
                  from={tool.createdAt}
                  color={cardTheme.elapsedColor}
                />
              </View>
            ) : tool.completedAt ? (
              <View style={styles.elapsedContainer}>
                <CompletedDurationView
                  from={tool.createdAt}
                  to={tool.completedAt}
                  color={cardTheme.elapsedColor}
                />
              </View>
            ) : null}
            {statusIcon}
          </View>
        </Pressable>
      )}

      {/* Content area - either custom children or tool-specific view */}
      {(() => {
        // Check if minimal first - minimal tools don't show content
        if (minimal) {
          return null;
        }

        // Try to use a specific tool view component first
        if (SpecificToolView) {
          return (
            <View style={styles.content}>
              <SpecificToolView
                tool={tool}
                metadata={props.metadata}
                messages={props.messages ?? []}
                sessionId={sessionId}
              />
              {tool.state === "error" &&
                tool.result &&
                !(
                  tool.permission &&
                  (tool.permission.status === "denied" ||
                    tool.permission.status === "canceled")
                ) &&
                !hideDefaultError && (
                  <ToolError message={String(tool.result)} />
                )}
            </View>
          );
        }

        // Show error state if present (but not for denied/canceled permissions and not when hideDefaultError is true)
        if (
          tool.state === "error" &&
          tool.result &&
          !(
            tool.permission &&
            (tool.permission.status === "denied" ||
              tool.permission.status === "canceled")
          ) &&
          !isToolUseError
        ) {
          return (
            <View style={styles.content}>
              <ToolError message={String(tool.result)} />
            </View>
          );
        }

        // Fall back to default view
        return (
          <View style={styles.content}>
            {/* Default content when no custom view available */}
            {tool.input &&
              !(
                typeof tool.input === "object" &&
                Object.keys(tool.input).length === 0
              ) && (
                <ToolSectionView
                  title={t("toolView.input")}
                  provider={toolProvider}
                >
                  <CodeView code={JSON.stringify(tool.input, null, 2)} />
                </ToolSectionView>
              )}

            {tool.state === "completed" && tool.result && (
              <ToolSectionView
                title={t("toolView.output")}
                provider={toolProvider}
              >
                <CodeView
                  code={
                    typeof tool.result === "string"
                      ? tool.result
                      : JSON.stringify(tool.result, null, 2)
                  }
                />
              </ToolSectionView>
            )}
          </View>
        );
      })()}

      {/* Permission footer — shown when manual review is needed or auto-approve failed.
         AskUserQuestion has its own submit UI (AskUserQuestionView) that sends answers
         via sessionAllow, so it should never show the generic permission footer. */}
      {sessionId &&
        tool.permission &&
        tool.permission.status === "pending" &&
        tool.name !== "AskUserQuestion" &&
        (!willAutoApprove || autoApproveFailed) && (
        <PermissionFooter
          permission={tool.permission}
          sessionId={sessionId}
          toolName={tool.name}
          toolInput={tool.input}
          metadata={props.metadata}
        />
      )}
    </View>
  );
});

function ElapsedView(props: { from: number; color: string }) {
  const { from, color } = props;
  const elapsed = useElapsedTime(from);
  return <Text style={[styles.elapsedText, { color }]}>{elapsed.toFixed(1)}s</Text>;
}

function CompletedDurationView(props: { from: number; to: number; color: string }) {
  const seconds = (props.to - props.from) / 1000;
  const text =
    seconds < 1
      ? `${Math.round(seconds * 1000)}ms`
      : seconds < 60
        ? `${seconds.toFixed(1)}s`
        : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return <Text style={[styles.elapsedText, { color: props.color }]}>{text}</Text>;
}

const styles = StyleSheet.create((_theme) => ({
  container: {
    marginVertical: 4,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  iconContainer: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  titleContainer: {
    flex: 1,
  },
  elapsedContainer: {
    marginLeft: 8,
  },
  elapsedText: {
    fontSize: 13,
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },
  toolName: {
    fontSize: 14,
    fontWeight: "500",
  },
  status: {
    fontWeight: "400",
    opacity: 0.3,
    fontSize: 15,
  },
  toolDescription: {
    fontSize: 13,
    marginTop: 2,
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 8,
    overflow: "visible",
  },
  mergedToolContent: {
    paddingHorizontal: 12,
    paddingTop: 0,
    overflow: "visible",
  },
  subAgentModelBadge: {
    backgroundColor: _theme.colors.accentTeal + "15",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 4,
  },
  subAgentModelText: {
    fontSize: 10,
    fontWeight: "500",
    color: _theme.colors.accentTeal,
  },
}));
