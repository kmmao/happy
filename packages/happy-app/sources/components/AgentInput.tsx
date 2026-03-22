import { Ionicons, Octicons } from "@expo/vector-icons";
import * as React from "react";
import {
  View,
  Platform,
  useWindowDimensions,
  Text,
  ActivityIndicator,
  TouchableWithoutFeedback,
  Pressable,
  ScrollView,
  Modal as RNModal,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { layout } from "./layout";
import { MultiTextInput, KeyPressEvent } from "./MultiTextInput";
import { Typography } from "@/constants/Typography";
import { PermissionMode } from "./PermissionModeSelector";
import { hapticsLight, hapticsError } from "./haptics";
import { Shaker, ShakeInstance } from "./Shaker";
import { StatusDot } from "./StatusDot";
import { useActiveWord } from "./autocomplete/useActiveWord";
import { useActiveSuggestions } from "./autocomplete/useActiveSuggestions";
import { AgentInputAutocomplete } from "./AgentInputAutocomplete";
import { FloatingOverlay } from "./FloatingOverlay";
import { QuickCommandsPanel } from "./QuickCommandsPanel";
import { CommandListPopover } from "./CommandListPopover";
import { TextInputState, MultiTextInputHandle } from "./MultiTextInput";
import { applySuggestion } from "./autocomplete/applySuggestion";
import { useUserMessageHistory } from "@/hooks/useUserMessageHistory";
import { useUnistyles } from "react-native-unistyles";
import {
  useSetting,
  useSettingMutable,
  useLocalSettingMutable,
} from "@/sync/storage";
import { hackMode, hackModes } from "@/sync/modeHacks";
import { getAllCommands } from "@/sync/suggestionCommands";
import { t } from "@/text";
import { getBuiltInProfile } from "@/sync/profileUtils";
import { AnimatedTokensCost } from "./AnimatedTokensCost";
import { SttWaveIndicator } from "./SttWaveIndicator";
import { SttProgressLine } from "./SttProgressLine";
import { GitBrowseTab } from "./git/GitBrowseTab";

import type { AgentInputProps } from "./AgentInputTypes";
import { stylesheet, FAVORITE_CHIP_GRADIENTS } from "./AgentInputStyles";
import { getContextWarning, ContextProgressBar } from "./ContextProgressBar";
import { ImagePickButton } from "./ImagePickButton";
import { GitStatusButton } from "./GitStatusButton";
import { AgentInputSettingsOverlay } from "./AgentInputSettingsOverlay";

export type {
  ReasoningProps,
  SttProps,
  ImageProps,
  CommandProps,
  AgentInputProps,
} from "./AgentInputTypes";

export const AgentInput = React.memo(
  React.forwardRef<MultiTextInputHandle, AgentInputProps>((props, ref) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const screenWidth = useWindowDimensions().width;

    const hasText = props.value.trim().length > 0;
    const hasImages = (props.images?.imagePaths?.length ?? 0) > 0;
    const canSend = hasText || hasImages;

    // Lightbox state for full-screen image preview
    const [previewUri, setPreviewUri] = React.useState<string | null>(null);

    // Check if this is a Codex or Gemini session
    // Use metadata.flavor for existing sessions, agentType prop for new sessions
    const isCodex =
      props.metadata?.flavor === "codex" || props.agentType === "codex";
    const isGemini =
      props.metadata?.flavor === "gemini" || props.agentType === "gemini";
    const displayPermissionMode = React.useMemo(
      () => (props.permissionMode ? hackMode(props.permissionMode) : null),
      [props.permissionMode],
    );
    const permissionModeKey = displayPermissionMode?.key ?? "default";
    const availableModes = React.useMemo(
      () => hackModes(props.availableModes ?? []),
      [props.availableModes],
    );
    const availableModels = props.availableModels ?? [];
    const isSandboxEnabled = React.useMemo(() => {
      const sandbox = props.metadata?.sandbox as unknown;
      if (!sandbox) {
        return false;
      }
      if (
        typeof sandbox === "object" &&
        sandbox !== null &&
        "enabled" in sandbox
      ) {
        return Boolean((sandbox as { enabled?: unknown }).enabled);
      }
      return true;
    }, [props.metadata?.sandbox]);
    const isSandboxedYoloMode =
      isSandboxEnabled &&
      (permissionModeKey === "bypassPermissions" ||
        permissionModeKey === "yolo");

    const withSandboxSuffix = React.useCallback(
      (label: string, modeKey?: string) => {
        if (!isSandboxEnabled) {
          return label;
        }
        if (modeKey === "bypassPermissions" || modeKey === "yolo") {
          return `${label} (sandboxed)`;
        }
        return label;
      },
      [isSandboxEnabled],
    );

    // Profile data
    const profiles = useSetting("profiles");
    const currentProfile = React.useMemo(() => {
      if (!props.profileId) return null;
      // Check custom profiles first
      const customProfile = profiles.find((p) => p.id === props.profileId);
      if (customProfile) return customProfile;
      // Check built-in profiles
      return getBuiltInProfile(props.profileId);
    }, [profiles, props.profileId]);

    // Calculate context warning
    const contextWarning = props.usageData?.contextSize
      ? getContextWarning(
          props.usageData.contextSize,
          props.alwaysShowContextSize ?? false,
          theme,
          props.usageData.totalInputTokens + props.usageData.totalOutputTokens,
          props.currentModelCode,
          props.usageData.contextWindow,
        )
      : null;

    const agentInputEnterToSend = useSetting("agentInputEnterToSend");

    // Abort button state
    const [isAborting, setIsAborting] = React.useState(false);
    const shakerRef = React.useRef<ShakeInstance>(null);
    const inputRef = React.useRef<MultiTextInputHandle>(null);

    // Forward ref to the MultiTextInput
    React.useImperativeHandle(ref, () => inputRef.current!, []);

    // Autocomplete state - track text and selection together
    const [inputState, setInputState] = React.useState<TextInputState>({
      text: props.value,
      selection: { start: 0, end: 0 },
    });

    // Handle combined text and selection state changes
    const handleInputStateChange = React.useCallback(
      (newState: TextInputState) => {
        // console.log('📝 Input state changed:', JSON.stringify(newState));
        setInputState(newState);
      },
      [],
    );

    // Use the tracked selection from inputState
    const activeWord = useActiveWord(
      inputState.text,
      inputState.selection,
      props.autocompletePrefixes,
    );
    // Using default options: clampSelection=true, autoSelectFirst=true, wrapAround=true
    // To customize: useActiveSuggestions(activeWord, props.autocompleteSuggestions, { clampSelection: false, wrapAround: false })
    const [suggestions, selected, moveUp, moveDown] = useActiveSuggestions(
      activeWord,
      props.autocompleteSuggestions,
      { clampSelection: true, wrapAround: true },
    );

    // User message history navigation
    const messageHistory = useUserMessageHistory(props.sessionId);

    // Handle suggestion selection
    const handleSuggestionSelect = React.useCallback(
      (index: number) => {
        if (!suggestions[index] || !inputRef.current) return;

        const suggestion = suggestions[index];

        // Apply the suggestion
        const result = applySuggestion(
          inputState.text,
          inputState.selection,
          suggestion.text,
          props.autocompletePrefixes,
          true, // add space after
        );

        // Use imperative API to set text and selection
        inputRef.current.setTextAndSelection(result.text, {
          start: result.cursorPosition,
          end: result.cursorPosition,
        });

        // Small haptic feedback
        hapticsLight();
      },
      [suggestions, inputState, props.autocompletePrefixes],
    );

    // Settings modal state
    const [showSettings, setShowSettings] = React.useState(false);
    const [showQuickCommands, setShowQuickCommands] = React.useState(false);
    const [showFileBrowser, setShowFileBrowser] = React.useState(false);

    // Favorite commands (synced Settings — for QuickCommandsPanel shell commands)
    const [favoriteCommands, setFavoriteCommands] =
      useSettingMutable("favoriteCommands");
    const handleToggleFavorite = React.useCallback(
      (command: string) => {
        const current = favoriteCommands ?? [];
        const next = current.includes(command)
          ? current.filter((c) => c !== command)
          : [...current, command];
        setFavoriteCommands(next);
      },
      [favoriteCommands, setFavoriteCommands],
    );

    // Favorite slash commands (local — for quick chips above input)
    // Only show favorites that exist in the current session's available commands
    const [rawFavoriteSlashCommands] = useLocalSettingMutable("favoriteCommands");
    const favoriteSlashCommands = React.useMemo(() => {
      if (rawFavoriteSlashCommands.length === 0) return rawFavoriteSlashCommands;
      const available = new Set(
        getAllCommands(props.sessionId ?? "").map((c) => c.command),
      );
      return rawFavoriteSlashCommands.filter((cmd) => available.has(cmd));
    }, [rawFavoriteSlashCommands, props.sessionId]);

    // Handle settings button press
    const handleSettingsPress = React.useCallback(() => {
      hapticsLight();
      setShowSettings((prev) => {
        if (!prev) {
          setShowQuickCommands(false);
          setShowFileBrowser(false);
        }
        return !prev;
      });
    }, []);

    // Handle settings selection
    const handleSettingsSelect = React.useCallback(
      (mode: PermissionMode) => {
        hapticsLight();
        props.onPermissionModeChange?.(mode);
        // Don't close the settings overlay - let users see the change and potentially switch again
      },
      [props.onPermissionModeChange],
    );

    // Handle abort button press — interrupt immediately without confirmation
    const handleAbortPress = React.useCallback(async () => {
      if (!props.onAbort) return;

      hapticsError();
      setIsAborting(true);
      const startTime = Date.now();

      try {
        await props.onAbort?.();

        // Ensure minimum 300ms loading time
        const elapsed = Date.now() - startTime;
        if (elapsed < 300) {
          await new Promise((resolve) => setTimeout(resolve, 300 - elapsed));
        }
      } catch (error) {
        // Shake on error
        shakerRef.current?.shake();
        console.error("Abort RPC call failed:", error);
      } finally {
        setIsAborting(false);
      }
    }, [props.onAbort]);

    // Handle keyboard navigation
    const handleKeyPress = React.useCallback(
      (event: KeyPressEvent): boolean => {
        // Autocomplete suggestions take priority over history navigation for arrow keys.
        // When suggestions are visible (user typed "/" etc.), arrow keys navigate the list.
        // History position is preserved so navigation can resume when suggestions disappear.
        if (suggestions.length > 0) {
          if (event.key === "ArrowUp") {
            moveUp();
            return true;
          } else if (event.key === "ArrowDown") {
            moveDown();
            return true;
          } else if (
            event.key === "Enter" ||
            (event.key === "Tab" && !event.shiftKey)
          ) {
            const indexToSelect = selected >= 0 ? selected : 0;
            handleSuggestionSelect(indexToSelect);
            return true;
          } else if (event.key === "Escape") {
            if (inputRef.current) {
              const cursorPos = inputState.selection.start;
              inputRef.current.setTextAndSelection(inputState.text, {
                start: cursorPos,
                end: cursorPos,
              });
            }
            return true;
          }
        }

        // History navigation when no autocomplete suggestions
        if (suggestions.length === 0) {
          if (event.key === "ArrowUp") {
            const historyText = messageHistory.navigateUp(props.value);
            if (historyText !== null) {
              props.onChangeText(historyText);
              inputRef.current?.setTextAndSelection(historyText, {
                start: historyText.length,
                end: historyText.length,
              });
              return true;
            }
          } else if (event.key === "ArrowDown") {
            const historyText = messageHistory.navigateDown();
            if (historyText !== null) {
              props.onChangeText(historyText);
              if (historyText.length > 0) {
                inputRef.current?.setTextAndSelection(historyText, {
                  start: historyText.length,
                  end: historyText.length,
                });
              }
              return true;
            }
          }
        }

        // Handle Escape: exit history navigation, restoring draft text
        if (event.key === "Escape" && messageHistory.isNavigating) {
          const draft = messageHistory.reset();
          props.onChangeText(draft);
          inputRef.current?.setTextAndSelection(draft, {
            start: draft.length,
            end: draft.length,
          });
          return true;
        }

        // Handle Escape for abort when no suggestions are visible
        if (
          event.key === "Escape" &&
          props.showAbortButton &&
          props.onAbort &&
          !isAborting
        ) {
          handleAbortPress();
          return true;
        }

        // Original key handling
        if (Platform.OS === "web") {
          if (
            agentInputEnterToSend &&
            event.key === "Enter" &&
            !event.shiftKey
          ) {
            if (canSend) {
              messageHistory.reset();
              props.onSend();
              return true; // Key was handled
            }
          }
          // Handle Shift+Tab for permission mode switching
          if (
            event.key === "Tab" &&
            event.shiftKey &&
            props.onPermissionModeChange &&
            availableModes.length > 0
          ) {
            const currentIndex = availableModes.findIndex(
              (mode) => mode.key === permissionModeKey,
            );
            const nextIndex =
              ((currentIndex >= 0 ? currentIndex : 0) + 1) %
              availableModes.length;
            props.onPermissionModeChange(availableModes[nextIndex]);
            hapticsLight();
            return true; // Key was handled, prevent default tab behavior
          }
        }
        return false; // Key was not handled
      },
      [
        suggestions,
        moveUp,
        moveDown,
        selected,
        handleSuggestionSelect,
        messageHistory,
        props.showAbortButton,
        props.onAbort,
        isAborting,
        handleAbortPress,
        agentInputEnterToSend,
        canSend,
        props.value,
        props.onChangeText,
        props.onSend,
        props.onPermissionModeChange,
        availableModes,
        permissionModeKey,
      ],
    );

    // Auto-focus input when window regains focus (web only)
    React.useEffect(() => {
      if (Platform.OS !== "web") return;

      const handleWindowFocus = () => {
        inputRef.current?.focus();
      };

      window.addEventListener("focus", handleWindowFocus);
      return () => {
        window.removeEventListener("focus", handleWindowFocus);
      };
    }, []);

    return (
      <View
        style={[
          styles.container,
          { paddingHorizontal: screenWidth > 700 ? 16 : 8 },
        ]}
      >
        <View style={[styles.innerContainer, { maxWidth: layout.maxWidth }]}>
          {/* Autocomplete suggestions overlay */}
          {suggestions.length > 0 && (
            <View
              style={[
                styles.autocompleteOverlay,
                { paddingHorizontal: screenWidth > 700 ? 0 : 8 },
              ]}
            >
              <AgentInputAutocomplete
                suggestions={suggestions.map((s) => {
                  const Component = s.component;
                  return <Component key={s.key} />;
                })}
                selectedIndex={selected}
                onSelect={handleSuggestionSelect}
                itemHeight={48}
              />
            </View>
          )}

          {/* Settings overlay */}
          <AgentInputSettingsOverlay
            visible={showSettings}
            onClose={() => setShowSettings(false)}
            screenWidth={screenWidth}
            availableModes={availableModes}
            permissionModeKey={permissionModeKey}
            handleSettingsSelect={handleSettingsSelect}
            availableModels={availableModels}
            modelMode={props.modelMode}
            onModelModeChange={props.onModelModeChange}
            reasoning={props.reasoning}
            metadata={props.metadata}
            isCodex={isCodex}
            isGemini={isGemini}
            withSandboxSuffix={withSandboxSuffix}
          />

          {/* Slash Command List - toggled by slash command button */}
          {props.commands?.showCommandList && (
            <>
              <TouchableWithoutFeedback
                onPress={() => props.commands?.onCommandListClose?.()}
              >
                <View style={styles.overlayBackdrop} />
              </TouchableWithoutFeedback>
              <View
                style={[
                  styles.commandsOverlay,
                  { paddingHorizontal: screenWidth > 700 ? 0 : 8 },
                ]}
              >
                <FloatingOverlay
                  maxHeight={420}
                  keyboardShouldPersistTaps="always"
                >
                  <CommandListPopover
                    visible={true}
                    sessionId={props.sessionId ?? ""}
                    onCommandSelect={(cmd) => props.commands?.onCommandSelect?.(cmd)}
                    onClose={() => props.commands?.onCommandListClose?.()}
                    inline
                  />
                </FloatingOverlay>
              </View>
            </>
          )}

          {/* Quick Commands Panel - toggled by terminal button */}
          {props.onShellCommand && showQuickCommands && (
            <>
              <TouchableWithoutFeedback
                onPress={() => setShowQuickCommands(false)}
              >
                <View style={styles.overlayBackdrop} />
              </TouchableWithoutFeedback>
              <View
                style={[
                  styles.commandsOverlay,
                  { paddingHorizontal: screenWidth > 700 ? 0 : 8 },
                ]}
              >
                <FloatingOverlay
                  maxHeight={400}
                  keyboardShouldPersistTaps="always"
                >
                  <QuickCommandsPanel
                    packageScripts={props.packageScripts}
                    favoriteCommands={favoriteCommands ?? []}
                    onCommandSelect={(command) => {
                      props.onChangeText(`$ ${command}`);
                      setShowQuickCommands(false);
                    }}
                    onToggleFavorite={handleToggleFavorite}
                  />
                </FloatingOverlay>
              </View>
            </>
          )}

          {/* File browser overlay */}
          {props.sessionId && showFileBrowser && (
            <>
              <TouchableWithoutFeedback
                onPress={() => setShowFileBrowser(false)}
              >
                <View style={styles.overlayBackdrop} />
              </TouchableWithoutFeedback>
              <View
                style={[
                  styles.fileBrowserOverlay,
                  { paddingHorizontal: screenWidth > 700 ? 0 : 8 },
                ]}
              >
                <View style={styles.fileBrowserContainer}>
                  <GitBrowseTab
                    sessionId={props.sessionId}
                    embedded
                    onFileOpen={() => setShowFileBrowser(false)}
                    onReference={(path) => {
                      const current = props.value;
                      const prefix = current.length > 0 && !current.endsWith(" ") ? " " : "";
                      props.onChangeText(`${current}${prefix}@${path} `);
                    }}
                  />
                </View>
              </View>
            </>
          )}

          {/* Connection status and permission mode */}
          {(props.connectionStatus ||
            displayPermissionMode ||
            props.modelMode) && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 16,
                paddingBottom: 4,
                minHeight: 20, // Fixed minimum height to prevent jumping
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flex: 1,
                  gap: 11,
                }}
              >
                {props.connectionStatus && (
                  <>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <StatusDot
                        color={props.connectionStatus.dotColor}
                        isPulsing={props.connectionStatus.isPulsing}
                        size={6}
                      />
                      <Text
                        style={{
                          fontSize: 11,
                          color: props.connectionStatus.color,
                          ...Typography.default(),
                        }}
                        numberOfLines={1}
                      >
                        {props.connectionStatus.text}
                        {props.usageData &&
                          props.usageData.totalInputTokens +
                            props.usageData.totalOutputTokens >
                            0 && (
                            <AnimatedTokensCost
                              totalTokens={
                                props.usageData.totalInputTokens +
                                props.usageData.totalOutputTokens
                              }
                              totalCostUsd={props.usageData.totalCostUsd}
                              totalDurationMs={props.totalDurationMs}
                              completedTurnsDurationMs={props.completedTurnsDurationMs}
                              isThinking={props.isThinking}
                              turnStartedAt={props.turnStartedAt}
                            />
                          )}
                      </Text>
                    </View>
                    {/* CLI Status - only shown when provided (wizard only) */}
                    {props.connectionStatus.cliStatus && (
                      <>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              color: props.connectionStatus.cliStatus.claude
                                ? theme.colors.success
                                : theme.colors.textDestructive,
                              ...Typography.default(),
                            }}
                          >
                            {props.connectionStatus.cliStatus.claude
                              ? "✓"
                              : "✗"}
                          </Text>
                          <Text
                            style={{
                              fontSize: 11,
                              color: props.connectionStatus.cliStatus.claude
                                ? theme.colors.success
                                : theme.colors.textDestructive,
                              ...Typography.default(),
                            }}
                          >
                            claude
                          </Text>
                        </View>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              color: props.connectionStatus.cliStatus.codex
                                ? theme.colors.success
                                : theme.colors.textDestructive,
                              ...Typography.default(),
                            }}
                          >
                            {props.connectionStatus.cliStatus.codex ? "✓" : "✗"}
                          </Text>
                          <Text
                            style={{
                              fontSize: 11,
                              color: props.connectionStatus.cliStatus.codex
                                ? theme.colors.success
                                : theme.colors.textDestructive,
                              ...Typography.default(),
                            }}
                          >
                            codex
                          </Text>
                        </View>
                        {props.connectionStatus.cliStatus.gemini !==
                          undefined && (
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                color: props.connectionStatus.cliStatus.gemini
                                  ? theme.colors.success
                                  : theme.colors.textDestructive,
                                ...Typography.default(),
                              }}
                            >
                              {props.connectionStatus.cliStatus.gemini
                                ? "✓"
                                : "✗"}
                            </Text>
                            <Text
                              style={{
                                fontSize: 11,
                                color: props.connectionStatus.cliStatus.gemini
                                  ? theme.colors.success
                                  : theme.colors.textDestructive,
                                ...Typography.default(),
                              }}
                            >
                              gemini
                            </Text>
                          </View>
                        )}
                      </>
                    )}
                  </>
                )}
              </View>
              <View
                style={{
                  flexDirection: "column",
                  alignItems: "flex-end",
                  minWidth: 150, // Fixed minimum width to prevent layout shift
                }}
              >
                {displayPermissionMode && (
                  <Text
                    style={{
                      fontSize: 11,
                      color: isSandboxedYoloMode
                        ? "#4169E1"
                        : permissionModeKey === "acceptEdits"
                          ? theme.colors.permission.acceptEdits
                          : permissionModeKey === "bypassPermissions"
                            ? theme.colors.permission.bypass
                            : permissionModeKey === "plan"
                              ? theme.colors.permission.plan
                              : permissionModeKey === "dontAsk"
                                ? theme.colors.permission.dontAsk
                                : permissionModeKey === "read-only"
                                  ? theme.colors.permission.readOnly
                                  : permissionModeKey === "safe-yolo"
                                    ? theme.colors.permission.safeYolo
                                    : permissionModeKey === "yolo"
                                      ? theme.colors.permission.yolo
                                      : theme.colors.textSecondary, // Use secondary text color for default
                      ...Typography.default(),
                    }}
                  >
                    {withSandboxSuffix(
                      displayPermissionMode.name,
                      permissionModeKey,
                    )}
                  </Text>
                )}
                {props.modelMode && (
                  <Text
                    style={{
                      fontSize: 11,
                      color: theme.colors.textSecondary,
                      ...Typography.default(),
                    }}
                  >
                    {[
                      props.effectiveModelLabel ?? props.modelMode.name,
                      ...(!isCodex && !isGemini
                        ? [
                            (props.reasoning?.effortLevel ?? "medium") === "low"
                              ? t("agentInput.effort.low")
                              : (props.reasoning?.effortLevel ?? "medium") === "high"
                                ? t("agentInput.effort.high")
                                : (props.reasoning?.effortLevel ?? "medium") === "max"
                                  ? t("agentInput.effort.max")
                                  : t("agentInput.effort.medium"),
                            (props.reasoning?.thinkingMode ?? "adaptive") === "enabled"
                              ? t("agentInput.thinking.enabled")
                              : (props.reasoning?.thinkingMode ?? "adaptive") ===
                                  "disabled"
                                ? t("agentInput.thinking.disabled")
                                : t("agentInput.thinking.adaptive"),
                          ]
                        : []),
                    ].join(" · ")}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Box 1: Context Information (Machine + Path) - Only show if either exists */}
          {(props.machineName !== undefined || props.currentPath) && (
            <View
              style={{
                backgroundColor: theme.colors.surfacePressed,
                borderRadius: 12,
                padding: 8,
                marginBottom: 8,
                gap: 4,
              }}
            >
              {/* Machine chip */}
              {props.machineName !== undefined && props.onMachineClick && (
                <Pressable
                  onPress={() => {
                    hapticsLight();
                    props.onMachineClick?.();
                  }}
                  hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                  style={(p) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    borderRadius: Platform.select({ default: 16, android: 20 }),
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    height: 32,
                    opacity: p.pressed ? 0.7 : 1,
                    gap: 6,
                  })}
                >
                  <Ionicons
                    name="desktop-outline"
                    size={14}
                    color={theme.colors.textSecondary}
                  />
                  <Text
                    style={{
                      fontSize: 13,
                      color: theme.colors.text,
                      fontWeight: "600",
                      ...Typography.default("semiBold"),
                    }}
                  >
                    {props.machineName === null
                      ? t("agentInput.noMachinesAvailable")
                      : props.machineName}
                  </Text>
                </Pressable>
              )}

              {/* Path chip */}
              {props.currentPath && props.onPathClick && (
                <Pressable
                  onPress={() => {
                    hapticsLight();
                    props.onPathClick?.();
                  }}
                  hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                  style={(p) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    borderRadius: Platform.select({ default: 16, android: 20 }),
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    height: 32,
                    opacity: p.pressed ? 0.7 : 1,
                    gap: 6,
                  })}
                >
                  <Ionicons
                    name="folder-outline"
                    size={14}
                    color={theme.colors.textSecondary}
                  />
                  <Text
                    style={{
                      fontSize: 13,
                      color: theme.colors.text,
                      fontWeight: "600",
                      ...Typography.default("semiBold"),
                    }}
                  >
                    {props.currentPath}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Box 2: Action Area (Input + Send) */}
          <View style={[styles.unifiedPanel, { position: "relative" }]}>
            {/* Context progress bar */}
            {props.usageData ? (
              <ContextProgressBar
                contextSize={props.usageData.contextSize}
                alwaysShow={props.alwaysShowContextSize ?? false}
                modelCode={props.currentModelCode}
                sdkContextWindow={props.usageData.contextWindow}
                theme={theme}
              />
            ) : null}

            {/* Image attachment chips */}
            {hasImages && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 8,
                  paddingTop: 10,
                  paddingBottom: 4,
                  gap: 8,
                }}
              >
                {(props.images?.imagePaths ?? []).map((path, index) => {
                  const uri = props.images?.imageUris?.[index];
                  return (
                    <View
                      key={path}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: theme.colors.surfacePressed,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: theme.colors.divider,
                        overflow: "hidden",
                        height: uri ? 52 : 36,
                      }}
                    >
                      {uri ? (
                        <Pressable
                          onPress={() => {
                            hapticsLight();
                            setPreviewUri(uri);
                          }}
                          style={({ pressed }) => ({
                            opacity: pressed ? 0.7 : 1,
                          })}
                        >
                          <Image
                            source={{ uri }}
                            style={{
                              width: 52,
                              height: 52,
                            }}
                            contentFit="cover"
                          />
                        </Pressable>
                      ) : (
                        <View
                          style={{
                            paddingLeft: 8,
                            paddingRight: props.images?.onImageRemove ? 2 : 8,
                            paddingVertical: 6,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <View
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 5,
                              backgroundColor: `${theme.colors.success}18`,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Ionicons
                              name="image"
                              size={13}
                              color={theme.colors.success}
                            />
                          </View>
                          <Text
                            style={{
                              fontSize: 13,
                              color: theme.colors.text,
                              ...Typography.default("semiBold"),
                            }}
                            numberOfLines={1}
                          >
                            {(props.images?.imagePaths ?? []).length === 1
                              ? t("session.imageAttached")
                              : t("session.imageLabel", { index: index + 1 })}
                          </Text>
                        </View>
                      )}
                      {props.images?.onImageRemove && (
                        <Pressable
                          onPress={() => {
                            hapticsLight();
                            props.images?.onImageRemove?.(path);
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                          style={({ pressed }) => ({
                            opacity: pressed ? 0.4 : 0.7,
                            padding: 4,
                            paddingRight: 6,
                          })}
                        >
                          <Ionicons
                            name="close-circle"
                            size={17}
                            color={theme.colors.textSecondary}
                          />
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}

            {/* Full-screen image preview lightbox */}
            <RNModal
              visible={previewUri !== null}
              transparent
              animationType="fade"
              onRequestClose={() => setPreviewUri(null)}
            >
              <Pressable
                style={{
                  flex: 1,
                  backgroundColor: "rgba(0,0,0,0.92)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onPress={() => setPreviewUri(null)}
              >
                {previewUri && (
                  <Image
                    source={{ uri: previewUri }}
                    style={{ width: "100%", height: "80%" }}
                    contentFit="contain"
                  />
                )}
              </Pressable>
            </RNModal>

            {/* Favorite slash command chips */}
            {favoriteSlashCommands.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{
                  paddingHorizontal: 8,
                  paddingTop: 6,
                  paddingBottom: 2,
                  gap: 6,
                }}
              >
                {favoriteSlashCommands.map((cmd, index) => (
                  <Pressable
                    key={cmd}
                    onPress={() => {
                      hapticsLight();
                      props.commands?.onCommandSelect?.(cmd);
                    }}
                    style={({ pressed }) => ({
                      borderRadius: 16,
                      overflow: "hidden",
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <LinearGradient
                      colors={
                        FAVORITE_CHIP_GRADIENTS[
                          index % FAVORITE_CHIP_GRADIENTS.length
                        ]
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 16,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          color: "#fff",
                          ...Typography.default("semiBold"),
                        }}
                        numberOfLines={1}
                      >
                        /{cmd.includes(":") ? cmd.split(":").pop() : cmd}
                      </Text>
                    </LinearGradient>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {/* Continue chip — shown when max turns reached and no prompt suggestion */}
            {props.needsContinue &&
              props.onContinuePress &&
              !props.promptSuggestion && (
                <Pressable
                  onPress={() => {
                    hapticsLight();
                    props.onContinuePress?.();
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    marginHorizontal: 8,
                    marginTop: 8,
                    marginBottom: 4,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    backgroundColor: pressed
                      ? theme.colors.surfacePressed
                      : `${theme.colors.permission.plan}10`,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: `${theme.colors.permission.plan}30`,
                    gap: 8,
                  })}
                >
                  <Ionicons
                    name="play-circle-outline"
                    size={14}
                    color={theme.colors.permission.plan}
                  />
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 13,
                      color: theme.colors.text,
                      ...Typography.default(),
                    }}
                    numberOfLines={1}
                  >
                    {t("agentInput.continue")}
                  </Text>
                  <Ionicons
                    name="arrow-up-circle"
                    size={18}
                    color={theme.colors.permission.plan}
                  />
                </Pressable>
              )}

            {/* Prompt suggestion chip */}
            {props.promptSuggestion && props.onPromptSuggestionPress && (
              <Pressable
                onPress={() => {
                  hapticsLight();
                  props.onPromptSuggestionPress?.(props.promptSuggestion!);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  marginHorizontal: 8,
                  marginTop: 8,
                  marginBottom: 4,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: pressed
                    ? theme.colors.surfacePressed
                    : `${theme.colors.textLink}10`,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: `${theme.colors.textLink}30`,
                  gap: 8,
                })}
              >
                <Ionicons
                  name="sparkles-outline"
                  size={14}
                  color={theme.colors.textLink}
                />
                <Text
                  style={{
                    flex: 1,
                    fontSize: 13,
                    color: theme.colors.text,
                    ...Typography.default(),
                  }}
                  numberOfLines={2}
                >
                  {props.promptSuggestion}
                </Text>
                <Ionicons
                  name="arrow-up-circle"
                  size={18}
                  color={theme.colors.textLink}
                />
              </Pressable>
            )}

            {/* Input field */}
            <View
              style={[
                styles.inputContainer,
                props.minHeight ? { minHeight: props.minHeight } : undefined,
              ]}
            >
              <MultiTextInput
                ref={inputRef}
                value={props.value}
                paddingTop={Platform.OS === "web" ? 10 : 8}
                paddingBottom={Platform.OS === "web" ? 10 : 8}
                onChangeText={props.onChangeText}
                placeholder={props.placeholder}
                onKeyPress={handleKeyPress}
                onStateChange={handleInputStateChange}
                maxHeight={120}
                onImagePaste={props.images?.onImagePaste}
              />
            </View>

            {/* Action buttons below input */}
            <View style={styles.actionButtonsContainer}>
              <View style={{ flexDirection: "column", flex: 1, gap: 2 }}>
                {/* Row 1: Settings, Profile (FIRST), Agent, Abort, Git Status */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.actionButtonsLeft}
                    contentContainerStyle={styles.actionButtonsLeftContent}
                  >
                    {/* Settings button */}
                    {props.onPermissionModeChange && (
                      <Pressable
                        onPress={handleSettingsPress}
                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                        style={(p) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          borderRadius: Platform.select({
                            default: 16,
                            android: 20,
                          }),
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          justifyContent: "center",
                          height: 32,
                          opacity: p.pressed ? 0.7 : 1,
                        })}
                      >
                        <Octicons
                          name={"gear"}
                          size={16}
                          color={theme.colors.button.secondary.tint}
                        />
                      </Pressable>
                    )}

                    {/* Profile selector button - FIRST */}
                    {props.profileId && props.onProfileClick && (
                      <Pressable
                        onPress={() => {
                          hapticsLight();
                          props.onProfileClick?.();
                        }}
                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                        style={(p) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          borderRadius: Platform.select({
                            default: 16,
                            android: 20,
                          }),
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          justifyContent: "center",
                          height: 32,
                          opacity: p.pressed ? 0.7 : 1,
                          gap: 6,
                        })}
                      >
                        <Ionicons
                          name="person-outline"
                          size={14}
                          color={theme.colors.button.secondary.tint}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            color: theme.colors.button.secondary.tint,
                            fontWeight: "600",
                            ...Typography.default("semiBold"),
                          }}
                        >
                          {currentProfile?.name || "Select Profile"}
                        </Text>
                      </Pressable>
                    )}
                    {/* Profile label (read-only) - shown when profileId is set but no click handler */}
                    {props.profileId &&
                      !props.onProfileClick &&
                      currentProfile && (
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            borderRadius: Platform.select({
                              default: 16,
                              android: 20,
                            }),
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            justifyContent: "center",
                            height: 32,
                            gap: 6,
                          }}
                        >
                          <Ionicons
                            name="person-outline"
                            size={14}
                            color={theme.colors.button.secondary.tint}
                          />
                          <Text
                            style={{
                              fontSize: 13,
                              color: theme.colors.button.secondary.tint,
                              fontWeight: "600",
                              ...Typography.default("semiBold"),
                            }}
                          >
                            {currentProfile.name}
                          </Text>
                        </View>
                      )}

                    {/* Agent selector button */}
                    {props.agentType && props.onAgentClick && (
                      <Pressable
                        onPress={() => {
                          hapticsLight();
                          props.onAgentClick?.();
                        }}
                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                        style={(p) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          borderRadius: Platform.select({
                            default: 16,
                            android: 20,
                          }),
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          justifyContent: "center",
                          height: 32,
                          opacity: p.pressed ? 0.7 : 1,
                          gap: 6,
                        })}
                      >
                        <Octicons
                          name="cpu"
                          size={14}
                          color={theme.colors.button.secondary.tint}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            color: theme.colors.button.secondary.tint,
                            fontWeight: "600",
                            ...Typography.default("semiBold"),
                          }}
                        >
                          {props.agentType === "claude"
                            ? t("agentInput.agent.claude")
                            : props.agentType === "codex"
                              ? t("agentInput.agent.codex")
                              : t("agentInput.agent.gemini")}
                        </Text>
                      </Pressable>
                    )}

                    {/* Abort button */}
                    {props.onAbort && (
                      <Shaker ref={shakerRef}>
                        <Pressable
                          style={(p) => ({
                            flexDirection: "row",
                            alignItems: "center",
                            borderRadius: Platform.select({
                              default: 16,
                              android: 20,
                            }),
                            paddingHorizontal: 8,
                            paddingVertical: 6,
                            justifyContent: "center",
                            height: 32,
                            opacity: p.pressed ? 0.7 : 1,
                          })}
                          hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                          onPress={handleAbortPress}
                          disabled={isAborting}
                        >
                          {isAborting ? (
                            <ActivityIndicator
                              size="small"
                              color={theme.colors.button.secondary.tint}
                            />
                          ) : (
                            <Octicons
                              name={"stop"}
                              size={16}
                              color={theme.colors.button.secondary.tint}
                            />
                          )}
                        </Pressable>
                      </Shaker>
                    )}

                    {/* Slash command button */}
                    {props.commands?.onSlashCommandPress && (
                      <Pressable
                        onPress={() => {
                          hapticsLight();
                          props.commands?.onSlashCommandPress?.();
                        }}
                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                        style={(p) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          borderRadius: Platform.select({
                            default: 16,
                            android: 20,
                          }),
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          justifyContent: "center",
                          height: 32,
                          opacity: p.pressed ? 0.7 : 1,
                        })}
                      >
                        <Octicons
                          name="command-palette"
                          size={16}
                          color={theme.colors.button.secondary.tint}
                        />
                      </Pressable>
                    )}

                    {/* Terminal quick commands button */}
                    {props.onShellCommand && (
                      <Pressable
                        onPress={() => {
                          hapticsLight();
                          setShowQuickCommands((prev) => {
                            if (!prev) {
                              setShowSettings(false);
                              setShowFileBrowser(false);
                            }
                            return !prev;
                          });
                        }}
                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                        style={(p) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          borderRadius: Platform.select({
                            default: 16,
                            android: 20,
                          }),
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          justifyContent: "center",
                          height: 32,
                          opacity: p.pressed ? 0.7 : 1,
                        })}
                      >
                        <Octicons
                          name="terminal"
                          size={16}
                          color={
                            showQuickCommands
                              ? theme.colors.success
                              : theme.colors.button.secondary.tint
                          }
                        />
                      </Pressable>
                    )}

                    {/* File browser button */}
                    {props.sessionId && (
                      <Pressable
                        onPress={() => {
                          hapticsLight();
                          setShowFileBrowser((prev) => {
                            if (!prev) {
                              setShowSettings(false);
                              setShowQuickCommands(false);
                            }
                            return !prev;
                          });
                        }}
                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                        style={(p) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          borderRadius: Platform.select({
                            default: 16,
                            android: 20,
                          }),
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          justifyContent: "center",
                          height: 32,
                          opacity: p.pressed ? 0.7 : 1,
                        })}
                      >
                        <Octicons
                          name="file-directory"
                          size={16}
                          color={
                            showFileBrowser
                              ? theme.colors.success
                              : theme.colors.button.secondary.tint
                          }
                        />
                      </Pressable>
                    )}

                    {/* Image pick button */}
                    {props.images?.onImagePickPress && (
                      <ImagePickButton
                        onPress={props.images?.onImagePickPress}
                        isPickingImage={props.images?.isPickingImage}
                        imagePaths={props.images?.imagePaths}
                      />
                    )}

                    {/* STT (Speech-to-Text) button */}
                    {props.stt?.onSttPress && (
                      <Pressable
                        onPress={() => {
                          hapticsLight();
                          props.stt?.onSttPress?.();
                        }}
                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                        style={(p) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          borderRadius: Platform.select({
                            default: 16,
                            android: 20,
                          }),
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          justifyContent: "center",
                          height: 32,
                          opacity: p.pressed ? 0.7 : 1,
                          backgroundColor: props.stt?.isSttListening
                            ? "#FF3B30"
                            : undefined,
                        })}
                      >
                        {props.stt?.isSttListening ? (
                          <SttWaveIndicator />
                        ) : (
                          <Ionicons
                            name="mic-outline"
                            size={16}
                            color={theme.colors.button.secondary.tint}
                          />
                        )}
                      </Pressable>
                    )}

                    {/* Git Status Badge */}
                    <GitStatusButton
                      sessionId={props.sessionId}
                      onPress={props.onFileViewerPress}
                    />
                  </ScrollView>

                  {/* Send/Voice button - aligned with first row */}
                  <View
                    style={[
                      styles.sendButton,
                      canSend ||
                      props.isSending ||
                      (props.onMicPress && !props.isMicActive)
                        ? styles.sendButtonActive
                        : styles.sendButtonInactive,
                    ]}
                  >
                    <Pressable
                      style={(p) => ({
                        width: "100%",
                        height: "100%",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: p.pressed ? 0.7 : 1,
                      })}
                      hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                      onPress={() => {
                        hapticsLight();
                        if (canSend) {
                          messageHistory.reset();
                          props.onSend();
                        } else {
                          props.onMicPress?.();
                        }
                      }}
                      disabled={
                        props.isSendDisabled ||
                        props.isSending ||
                        (!canSend && !props.onMicPress)
                      }
                    >
                      {props.isSending ? (
                        <ActivityIndicator
                          size="small"
                          color={theme.colors.button.primary.tint}
                        />
                      ) : canSend ? (
                        <Octicons
                          name="arrow-up"
                          size={16}
                          color={theme.colors.button.primary.tint}
                          style={[
                            styles.sendButtonIcon,
                            { marginTop: Platform.OS === "web" ? 2 : 0 },
                          ]}
                        />
                      ) : props.onMicPress && !props.isMicActive ? (
                        <Image
                          source={require("@/assets/images/icon-voice-white.png")}
                          style={{
                            width: 24,
                            height: 24,
                          }}
                          tintColor={theme.colors.button.primary.tint}
                        />
                      ) : (
                        <Octicons
                          name="arrow-up"
                          size={16}
                          color={theme.colors.button.primary.tint}
                          style={[
                            styles.sendButtonIcon,
                            { marginTop: Platform.OS === "web" ? 2 : 0 },
                          ]}
                        />
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
            {/* STT progress shimmer — absolutely pinned to bottom edge of panel */}
            {(props.stt?.isSttListening || props.stt?.isSttCorrecting) && (
              <View
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                }}
              >
                <SttProgressLine
                  active={!!props.stt?.isSttListening || !!props.stt?.isSttCorrecting}
                  value={props.value}
                  correcting={!!props.stt?.isSttCorrecting}
                />
              </View>
            )}
          </View>
        </View>
      </View>
    );
  }),
);
