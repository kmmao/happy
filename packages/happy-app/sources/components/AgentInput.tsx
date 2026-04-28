import { Ionicons, Octicons } from "@expo/vector-icons";
import * as React from "react";
import {
  Animated,
  View,
  Platform,
  useWindowDimensions,
  Text,
  ActivityIndicator,
  TouchableWithoutFeedback,
  Pressable,
  ScrollView,
  Modal as RNModal,
  Easing,
} from "react-native";
import { BlurView } from "expo-blur";
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
} from "@/sync/storage";
import { hackMode, hackModes } from "@/sync/modeHacks";
import { getAllCommands } from "@/sync/suggestionCommands";
import { t } from "@/text";
import { getBuiltInProfile } from "@/sync/profileUtils";
import { useAnimatedTokensCostValue } from "./AnimatedTokensCost";
import { GitBrowseTab } from "./git/GitBrowseTab";

import type { AgentInputProps } from "./AgentInputTypes";
import { stylesheet, FAVORITE_CHIP_GRADIENTS, getFavoriteSlashChipGlassStyle, getFloatingGlassChipStyle } from "./AgentInputStyles";
import { ContextProgressBar } from "./ContextProgressBar";
import { AttachButton, type AttachAction } from "./AttachButton";
import { AgentInputSettingsOverlay } from "./AgentInputSettingsOverlay";
import { getReasoningSummaryLabels } from "./reasoningEffort";
import {
  buildRpcSummaryText,
  getRpcSummaryStatusLabel,
  getRpcSummaryVisualState,
} from "./rpcSummaryVisualState";
import { log } from '@/log';

export type {
  ReasoningProps,
  ImageProps,
  CommandProps,
  AgentInputProps,
} from "./AgentInputTypes";

export const AgentInput = React.memo(
  React.forwardRef<MultiTextInputHandle, AgentInputProps>((props, ref) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { width: screenWidth } = useWindowDimensions();
    // Overlay max height: caller passes available space above input (accurate);
    // fall back to a safe default when not provided (e.g. new-session screen).
    const overlayMaxHeight = props.overlayMaxHeight ?? 400;

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
    const modelSummaryGlowOpacity = React.useRef(new Animated.Value(0)).current;
    const isInputDisabled = props.isInputDisabled ?? false;
    const resolvedInputPlaceholder =
      isInputDisabled && props.disabledPlaceholder
        ? props.disabledPlaceholder
        : props.placeholder;
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

    const modelSummaryStatusLabel = React.useMemo(
      () =>
        getRpcSummaryStatusLabel({
          rpcState: props.modelSummaryRpcState,
          translate: t,
        }),
      [props.modelSummaryRpcState],
    );

    const modelSummaryVisualState = React.useMemo(
      () => getRpcSummaryVisualState(props.modelSummaryRpcState, theme.colors),
      [props.modelSummaryRpcState, theme.colors],
    );

    React.useEffect(() => {
      let animation: Animated.CompositeAnimation | null = null;
      modelSummaryGlowOpacity.stopAnimation();

      if (props.modelSummaryRpcState === "reconnecting") {
        modelSummaryGlowOpacity.setValue(0.2);
        animation = Animated.loop(
          Animated.sequence([
            Animated.timing(modelSummaryGlowOpacity, {
              toValue: 0.7,
              duration: 900,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: false,
            }),
            Animated.timing(modelSummaryGlowOpacity, {
              toValue: 0.18,
              duration: 900,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: false,
            }),
          ]),
        );
        animation.start();
      } else {
        Animated.timing(modelSummaryGlowOpacity, {
          toValue: props.modelSummaryRpcState === "rpcReady" ? 0.14 : 0,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }).start();
      }

      return () => {
        animation?.stop();
      };
    }, [modelSummaryGlowOpacity, props.modelSummaryRpcState]);

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
    const animatedTokensCostValue = useAnimatedTokensCostValue({
      totalTokens:
        (props.usageData?.totalInputTokens ?? 0) +
        (props.usageData?.totalOutputTokens ?? 0),
      totalCostUsd: props.usageData?.totalCostUsd,
      totalDurationMs: props.totalDurationMs,
      completedTurnsDurationMs: props.completedTurnsDurationMs,
      isThinking: props.isThinking,
      turnStartedAt: props.turnStartedAt,
    });

    const agentInputEnterToSend = useSetting("agentInputEnterToSend");

    // Abort button state
    const [isAborting, setIsAborting] = React.useState(false);
    const shakerRef = React.useRef<ShakeInstance>(null);
    const inputRef = React.useRef<MultiTextInputHandle>(null);

    React.useEffect(() => {
      if (isInputDisabled) {
        inputRef.current?.blur();
      }
    }, [isInputDisabled]);

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
    const [showModelSelectorModal, setShowModelSelectorModal] = React.useState(false);
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

    // Favorite slash commands (synced Settings — for quick chips above input)
    // Only show favorites that exist in the current session's available commands
    const [rawFavoriteSlashCommands] = useSettingMutable("favoriteSlashCommands");
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

    const handleModelSummaryPress = React.useCallback(() => {
      if (!props.onModelModeChange || availableModels.length === 0) {
        return;
      }

      hapticsLight();
      setShowSettings(true);
      setShowModelSelectorModal(false);
      setShowQuickCommands(false);
      setShowFileBrowser(false);
    }, [
      props.onModelModeChange,
      availableModels.length,
    ]);

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
        log.error("Abort RPC call failed:", error);
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

    // Drag-and-drop zone covering the entire input area (web only)
    const dropZoneRef = React.useRef<View>(null);
    const [isDraggingOver, setIsDraggingOver] = React.useState(false);
    const dragCounterRef = React.useRef(0);

    React.useEffect(() => {
      if (Platform.OS !== "web") return;
      const el = dropZoneRef.current as unknown as HTMLElement | null;
      if (!el) return;

      const onDragEnter = (e: DragEvent) => {
        e.preventDefault();
        dragCounterRef.current++;
        if (e.dataTransfer?.types.includes("Files")) {
          setIsDraggingOver(true);
        }
      };
      const onDragLeave = (e: DragEvent) => {
        e.preventDefault();
        dragCounterRef.current--;
        if (dragCounterRef.current <= 0) {
          dragCounterRef.current = 0;
          setIsDraggingOver(false);
        }
      };
      const onDragOver = (e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "copy";
        }
      };
      const onDrop = (e: DragEvent) => {
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDraggingOver(false);
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|bmp|heic|heif|svg)$/i;
        for (const file of Array.from(files)) {
          const isImage = file.type.startsWith("image/") || IMAGE_EXTS.test(file.name);
          if (isImage) {
            props.images?.onImagePaste?.(file);
          } else {
            props.images?.onFilePaste?.(file);
          }
        }
      };

      el.addEventListener("dragenter", onDragEnter);
      el.addEventListener("dragleave", onDragLeave);
      el.addEventListener("dragover", onDragOver);
      el.addEventListener("drop", onDrop);
      return () => {
        el.removeEventListener("dragenter", onDragEnter);
        el.removeEventListener("dragleave", onDragLeave);
        el.removeEventListener("dragover", onDragOver);
        el.removeEventListener("drop", onDrop);
      };
    }, [props.images?.onImagePaste, props.images?.onFilePaste]);

    return (
      <View
        style={[
          styles.container,
          { paddingHorizontal: screenWidth > 700 ? 16 : 8 },
        ]}
      >
        <View
          ref={dropZoneRef}
          style={[
            styles.innerContainer,
            { maxWidth: props.contentMaxWidth ?? layout.maxWidth },
          ]}
        >
          {/* Drop zone overlay (web only) */}
          {isDraggingOver && Platform.OS === "web" && (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 100,
                borderRadius: 16,
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
                // @ts-ignore Web-only CSS property
                backdropFilter: "blur(6px)",
                backgroundColor: `${theme.colors.success}18`,
                borderWidth: 2,
                borderStyle: "dashed",
                borderColor: theme.colors.success,
              }}
              pointerEvents="none"
            >
              <Ionicons
                name="cloud-upload-outline"
                size={28}
                color={theme.colors.success}
              />
              <Text
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  color: theme.colors.success,
                  ...Typography.default("semiBold"),
                }}
              >
                {t("session.dropFilesHere")}
              </Text>
            </View>
          )}

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
            currentModelCode={props.currentModelCode}
            isCodex={isCodex}
            isGemini={isGemini}
            withSandboxSuffix={withSandboxSuffix}
            maxHeight={overlayMaxHeight}
          />

          <RNModal
            visible={showModelSelectorModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowModelSelectorModal(false)}
          >
            <Pressable
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.45)",
                justifyContent: "center",
                paddingHorizontal: 16,
                paddingVertical: 24,
              }}
              onPress={() => setShowModelSelectorModal(false)}
            >
              <Pressable
                onPress={(event) => event.stopPropagation()}
                style={{
                  maxHeight: "70%",
                  borderRadius: 16,
                  overflow: "hidden",
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.divider,
                }}
              >
                <View
                  style={{
                    paddingHorizontal: 16,
                    paddingTop: 16,
                    paddingBottom: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.divider,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 16,
                      color: theme.colors.text,
                      ...Typography.default("semiBold"),
                    }}
                  >
                    {t("agentInput.model.title")}
                  </Text>
                </View>

                <ScrollView>
                  {availableModels.map((model) => {
                    const isSelected = props.modelMode?.key === model.key;
                    return (
                      <Pressable
                        key={model.key}
                        onPress={() => {
                          hapticsLight();
                          props.onModelModeChange?.(model);
                          setShowModelSelectorModal(false);
                        }}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          paddingHorizontal: 16,
                          paddingVertical: 12,
                          backgroundColor: pressed
                            ? theme.colors.surfacePressed
                            : "transparent",
                        })}
                      >
                        <View
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 8,
                            borderWidth: 2,
                            borderColor: isSelected
                              ? theme.colors.radio.active
                              : theme.colors.radio.inactive,
                            alignItems: "center",
                            justifyContent: "center",
                            marginRight: 12,
                          }}
                        >
                          {isSelected && (
                            <View
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: 3,
                                backgroundColor: theme.colors.radio.dot,
                              }}
                            />
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{
                              fontSize: 14,
                              color: isSelected
                                ? theme.colors.radio.active
                                : theme.colors.text,
                              ...Typography.default(),
                            }}
                          >
                            {model.name}
                          </Text>
                          {!!model.description && (
                            <Text
                              style={{
                                fontSize: 11,
                                color: theme.colors.textSecondary,
                                ...Typography.default(),
                              }}
                            >
                              {model.description}
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </Pressable>
            </Pressable>
          </RNModal>

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
                  maxHeight={overlayMaxHeight}
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
                  maxHeight={overlayMaxHeight}
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
                <View style={[styles.fileBrowserContainer, { maxHeight: overlayMaxHeight }]}>
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
                minHeight: 20,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flex: 1,
                  gap: 11,
                  minWidth: 0,
                }}
              >
                {props.connectionStatus && (
                  <>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        minWidth: 0,
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
                      </Text>
                    </View>
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
                        {props.connectionStatus.cliStatus.gemini !== undefined && (
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
              <Animated.View
                style={{
                  alignSelf: "flex-end",
                  minWidth: 150,
                  maxWidth: screenWidth > 700 ? 360 : 290,
                  marginLeft: 12,
                  borderRadius: 12,
                  borderWidth: props.modelSummaryRpcState && Platform.OS !== "android" ? 1 : 0,
                  borderColor: modelSummaryVisualState.borderColor,
                  backgroundColor: modelSummaryVisualState.backgroundColor,
                  shadowColor: modelSummaryVisualState.glowColor,
                  shadowOffset: { width: 0, height: 0 },
                  shadowRadius: props.modelSummaryRpcState === "reconnecting" ? 10 : 6,
                  shadowOpacity: Platform.OS === "android" ? 0 : modelSummaryGlowOpacity,
                  elevation: Platform.OS === "android" ? 0 : props.modelSummaryRpcState === "reconnecting" ? 5 : 1,
                }}
              >
                <Pressable
                  onPress={handleModelSummaryPress}
                  disabled={!props.onModelModeChange || availableModels.length === 0}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    alignSelf: "stretch",
                    paddingLeft: 10,
                    paddingRight: 8,
                    paddingVertical: 6,
                    borderRadius: 12,
                    backgroundColor:
                      !props.onModelModeChange || availableModels.length === 0
                        ? "transparent"
                        : pressed
                          ? theme.colors.surfacePressedOverlay
                          : "transparent",
                    opacity:
                      !props.onModelModeChange || availableModels.length === 0
                        ? 1
                        : pressed
                          ? 0.9
                          : 1,
                    gap: 6,
                  })}
                >
                  {modelSummaryStatusLabel ? (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: Platform.select({ web: 5, default: 4 }),
                        paddingHorizontal: Platform.select({ web: 7, default: 5 }),
                        paddingVertical: Platform.select({ web: 3, default: 2 }),
                        borderRadius: 999,
                        backgroundColor: modelSummaryVisualState.pillBackgroundColor,
                        flexShrink: 0,
                      }}
                    >
                      <StatusDot
                        color={modelSummaryVisualState.pillDotColor}
                        isPulsing={props.modelSummaryRpcState === "reconnecting"}
                        size={Platform.select({ web: 5, default: 4 })}
                      />
                      <Text
                        style={{
                          fontSize: 10,
                          color: modelSummaryVisualState.pillTextColor,
                          ...Typography.default("semiBold"),
                        }}
                      >
                        {modelSummaryStatusLabel}
                      </Text>
                    </View>
                  ) : null}
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 11,
                      color: modelSummaryVisualState.summaryTextColor,
                      textAlign: "right",
                      flexWrap: "wrap",
                      ...Typography.default(),
                    }}
                  >
                    {buildRpcSummaryText({
                      permissionLabel: displayPermissionMode
                        ? withSandboxSuffix(
                            displayPermissionMode.name,
                            permissionModeKey,
                          )
                        : null,
                      modelLabel: props.effectiveModelLabel ?? props.modelMode?.name,
                      reasoningLabels: getReasoningSummaryLabels({
                        isCodex,
                        isGemini,
                        reasoning: props.reasoning,
                        translate: t,
                      }),
                    })}
                  </Text>
                  {!!props.onModelModeChange && availableModels.length > 0 && (
                    <Ionicons
                      name="chevron-forward"
                      size={12}
                      color={modelSummaryVisualState.summaryTextColor}
                    />
                  )}
                </Pressable>
              </Animated.View>
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
                sdkContextUsage={props.sdkContextUsage}
                extraSummary={animatedTokensCostValue}
              />
            ) : null}

            {/* Image/file attachment chips */}
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
                  const originalName = props.images?.fileNameMap?.get(path);
                  const fileName = originalName ?? path.slice(path.lastIndexOf("/") + 1);
                  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
                  const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif"];
                  const isImageFile = IMAGE_EXTS.includes(ext);
                  const showThumbnail = uri && isImageFile;
                  const fileIcon: React.ComponentProps<typeof Ionicons>["name"] =
                    isImageFile ? "image"
                    : [".pdf"].includes(ext) ? "document-text-outline"
                    : [".xls", ".xlsx", ".csv"].includes(ext) ? "grid-outline"
                    : [".doc", ".docx", ".txt", ".rtf", ".md"].includes(ext) ? "document-text-outline"
                    : [".zip", ".rar", ".7z", ".tar", ".gz"].includes(ext) ? "archive-outline"
                    : [".mp3", ".wav", ".aac", ".flac", ".ogg"].includes(ext) ? "musical-note-outline"
                    : [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext) ? "videocam-outline"
                    : [".json", ".xml", ".yaml", ".yml", ".toml"].includes(ext) ? "code-slash-outline"
                    : "document-outline";
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
                        height: showThumbnail ? 52 : 36,
                      }}
                    >
                      {showThumbnail ? (
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
                            maxWidth: 160,
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
                              name={fileIcon}
                              size={13}
                              color={theme.colors.success}
                            />
                          </View>
                          <Text
                            style={{
                              fontSize: 12,
                              color: theme.colors.text,
                              ...Typography.default("semiBold"),
                              flexShrink: 1,
                            }}
                            numberOfLines={1}
                            ellipsizeMode="middle"
                          >
                            {isImageFile
                              ? (props.images?.imagePaths ?? []).length === 1
                                ? t("session.imageAttached")
                                : t("session.imageLabel", { index: index + 1 })
                              : fileName}
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
                  paddingBottom: 6,
                  gap: 6,
                }}
              >
                {favoriteSlashCommands.map((cmd, index) => {
                  const glassStyle = getFavoriteSlashChipGlassStyle();
                  const gradient = FAVORITE_CHIP_GRADIENTS[
                    index % FAVORITE_CHIP_GRADIENTS.length
                  ];
                  const accentColor = gradient[0];
                  return (
                    <Pressable
                      key={cmd}
                      onPress={() => {
                        hapticsLight();
                        props.commands?.onCommandSelect?.(cmd);
                      }}
                      style={({ pressed }) => ({
                        ...glassStyle.container,
                        opacity: pressed ? 0.9 : 1,
                        borderColor: theme.dark
                          ? `${accentColor}22`
                          : `${accentColor}26`,
                        backgroundColor:
                          Platform.OS === "web"
                            ? theme.dark
                              ? `${accentColor}10`
                              : `${accentColor}18`
                            : Platform.OS === "android"
                              ? theme.dark
                                ? `${accentColor}18`
                                : `${accentColor}22`
                              : theme.dark
                                ? `${accentColor}0A`
                                : `${accentColor}14`,
                        shadowColor: "#000000",
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: Platform.OS === "android" ? 0 : theme.dark
                          ? (pressed ? 0.10 : 0.16)
                          : (pressed ? 0.05 : 0.08),
                        shadowRadius: 8,
                        elevation: Platform.OS === "android" ? 0 : (pressed ? 1 : 2),
                      })}
                    >
                      <BlurView
                        intensity={Platform.OS === "ios" ? 34 : 14}
                        tint={theme.dark ? "dark" : "light"}
                        style={glassStyle.blur}
                      >
                        <LinearGradient
                          colors={theme.dark
                            ? [
                                `${accentColor}1A`,
                                `${accentColor}10`,
                                "rgba(255,255,255,0.02)",
                              ]
                            : [
                                "rgba(255,255,255,0.58)",
                                `${accentColor}14`,
                                "rgba(255,255,255,0.14)",
                              ]}
                          locations={[0, 0.42, 1]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0.1 }}
                          style={glassStyle.content}
                        >
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 999,
                              backgroundColor: accentColor,
                              opacity: theme.dark ? 0.9 : 0.7,
                            }}
                          />
                          <Text
                            style={{
                              fontSize: 12,
                              color: theme.colors.text,
                              ...Typography.default("semiBold"),
                            }}
                            numberOfLines={1}
                          >
                            {cmd.includes(":") ? cmd.split(":").pop() : cmd}
                          </Text>
                        </LinearGradient>
                      </BlurView>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            {/* Continue chip — shown when max turns reached and no prompt suggestion */}
            {props.needsContinue &&
              props.onContinuePress &&
              !props.promptSuggestion && (() => {
                const glassStyle = getFloatingGlassChipStyle();
                const accentColor = theme.colors.permission.plan;
                return (
                  <Pressable
                    onPress={() => {
                      hapticsLight();
                      props.onContinuePress?.();
                    }}
                    style={({ pressed }) => ({
                      ...glassStyle.container,
                      opacity: pressed ? 0.88 : 1,
                      borderColor: theme.dark
                        ? `${accentColor}66`
                        : `${accentColor}44`,
                      backgroundColor:
                        Platform.OS === "web"
                          ? theme.dark
                            ? "rgba(255,255,255,0.16)"
                            : "rgba(255,255,255,0.72)"
                          : theme.dark
                            ? "rgba(255,255,255,0.10)"
                            : "rgba(255,255,255,0.56)",
                      shadowColor: accentColor,
                      shadowOffset: { width: 0, height: 8 },
                      shadowOpacity: pressed ? 0.12 : 0.22,
                      shadowRadius: 14,
                      elevation: pressed ? 1 : 3,
                    })}
                  >
                    <BlurView
                      intensity={Platform.OS === "ios" ? 52 : 24}
                      tint={theme.dark ? "dark" : "light"}
                      style={glassStyle.blur}
                    >
                      <LinearGradient
                        colors={theme.dark
                          ? ["rgba(255,255,255,0.18)", `${accentColor}22`, `${accentColor}0A`]
                          : ["rgba(255,255,255,0.82)", `${accentColor}1A`, `${accentColor}08`]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={glassStyle.content}
                      >
                        <Ionicons
                          name="play-circle-outline"
                          size={14}
                          color={accentColor}
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
                          color={accentColor}
                        />
                      </LinearGradient>
                    </BlurView>
                  </Pressable>
                );
              })()}

            {/* Requires-action chip — surfaces generic SDK user action state */}
            {props.requiresAction &&
              props.onRequiresActionPress &&
              !props.promptSuggestion &&
              !props.needsContinue && (() => {
                const glassStyle = getFloatingGlassChipStyle();
                const accentColor = theme.colors.accentOrange;
                return (
                  <Pressable
                    onPress={() => {
                      hapticsLight();
                      props.onRequiresActionPress?.();
                    }}
                    style={({ pressed }) => ({
                      ...glassStyle.container,
                      opacity: pressed ? 0.88 : 1,
                      borderColor: theme.dark
                        ? `${accentColor}66`
                        : `${accentColor}44`,
                      backgroundColor:
                        Platform.OS === "web"
                          ? theme.dark
                            ? "rgba(255,255,255,0.16)"
                            : "rgba(255,255,255,0.72)"
                          : theme.dark
                            ? "rgba(255,255,255,0.10)"
                            : "rgba(255,255,255,0.56)",
                      shadowColor: accentColor,
                      shadowOffset: { width: 0, height: 8 },
                      shadowOpacity: pressed ? 0.12 : 0.22,
                      shadowRadius: 14,
                      elevation: pressed ? 1 : 3,
                    })}
                  >
                    <BlurView
                      intensity={Platform.OS === "ios" ? 52 : 24}
                      tint={theme.dark ? "dark" : "light"}
                      style={glassStyle.blur}
                    >
                      <LinearGradient
                        colors={theme.dark
                          ? ["rgba(255,255,255,0.18)", `${accentColor}22`, `${accentColor}0A`]
                          : ["rgba(255,255,255,0.82)", `${accentColor}1A`, `${accentColor}08`]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={glassStyle.content}
                      >
                        <Ionicons
                          name="alert-circle-outline"
                          size={14}
                          color={accentColor}
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
                          {t("agentInput.requiresAction")}
                        </Text>
                        <Ionicons
                          name="chevron-down"
                          size={18}
                          color={accentColor}
                        />
                      </LinearGradient>
                    </BlurView>
                  </Pressable>
                );
              })()}

            {/* Prompt suggestion chip */}
            {props.promptSuggestion && props.onPromptSuggestionPress && (() => {
              const glassStyle = getFloatingGlassChipStyle();
              const accentColor = theme.colors.textLink;
              return (
                <Pressable
                  onPress={() => {
                    hapticsLight();
                    props.onPromptSuggestionPress?.(props.promptSuggestion!);
                  }}
                  style={({ pressed }) => ({
                    ...glassStyle.container,
                    opacity: pressed ? 0.82 : 1,
                    borderColor: `${accentColor}38`,
                    backgroundColor:
                      Platform.OS === "web"
                        ? `${theme.colors.surface}B8`
                        : Platform.OS === "android"
                          ? `${theme.colors.surface}CC`
                          : `${theme.colors.surface}7A`,
                    shadowColor: accentColor,
                    shadowOffset: { width: 0, height: 6 },
                    shadowOpacity: Platform.OS === "android" ? 0 : (pressed ? 0.08 : 0.16),
                    shadowRadius: 12,
                    elevation: Platform.OS === "android" ? 0 : (pressed ? 1 : 2),
                  })}
                >
                  <BlurView
                    intensity={Platform.OS === "ios" ? 36 : 18}
                    tint={theme.dark ? "dark" : "light"}
                    style={glassStyle.blur}
                  >
                    <LinearGradient
                      colors={[`${accentColor}18`, `${accentColor}08`]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={glassStyle.content}
                    >
                      <Ionicons
                        name="sparkles-outline"
                        size={14}
                        color={accentColor}
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
                        color={accentColor}
                      />
                    </LinearGradient>
                  </BlurView>
                </Pressable>
              );
            })()}

            {/* Input field */}
            <View
              style={[
                styles.inputContainer,
                isInputDisabled
                  ? {
                      opacity: 0.72,
                    }
                  : undefined,
                props.minHeight ? { minHeight: props.minHeight } : undefined,
              ]}
            >
              <MultiTextInput
                ref={inputRef}
                value={props.value}
                paddingTop={Platform.OS === "web" ? 10 : 8}
                paddingBottom={Platform.OS === "web" ? 10 : 8}
                onChangeText={props.onChangeText}
                placeholder={resolvedInputPlaceholder}
                editable={!isInputDisabled}
                onKeyPress={handleKeyPress}
                onStateChange={handleInputStateChange}
                maxHeight={120}
                onImagePaste={props.images?.onImagePaste}
                onFilePaste={props.images?.onFilePaste}
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

                    {/* Attach button (gallery / camera / file) */}
                    {(props.images?.onImagePickPress || props.images?.onTakePhotoPress || props.images?.onFilePickPress) && (
                      <AttachButton
                        onAction={(action: AttachAction) => {
                          if (action === "gallery") props.images?.onImagePickPress?.();
                          else if (action === "camera") props.images?.onTakePhotoPress?.();
                          else if (action === "file") props.images?.onFilePickPress?.();
                        }}
                        isPickingImage={props.images?.isPickingImage}
                        imagePaths={props.images?.imagePaths}
                      />
                    )}

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
          </View>
        </View>
      </View>
    );
  }),
);
