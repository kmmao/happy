import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  TextInput,
  ScrollView,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { sessionAllow, sessionAllowPlanFreshContext, sessionDeny } from "@/sync/ops";
import { useUnistyles } from "react-native-unistyles";
import { storage } from "@/sync/storage";
import { t } from "@/text";
import { Modal } from "@/modal";
import { useImageUpload } from "@/hooks/useImageUpload";
import { MAX_IMAGES } from "@/utils/imageUpload";
import { hapticsLight } from "@/components/haptics";
import { log } from '@/log';

interface PermissionFooterProps {
  permission: {
    id: string;
    status: "pending" | "approved" | "denied" | "canceled";
    reason?: string;
    mode?: string;
    allowedTools?: string[];
    decision?: "approved" | "approved_for_session" | "denied" | "abort";
    /** Auto Mode safety classification (Phase 1) — drives danger highlighting. */
    riskLevel?: "safe" | "dangerous" | "neutral";
    classifierReason?: string;
  };
  sessionId: string;
  toolName: string;
  toolInput?: any;
  metadata?: any;
}

export const PermissionFooter: React.FC<PermissionFooterProps> = ({
  permission,
  sessionId,
  toolName,
  toolInput,
  metadata,
}) => {
  const { theme } = useUnistyles();
  const [loadingButton, setLoadingButton] = useState<
    "allow" | "deny" | "abort" | null
  >(null);
  const [loadingAllEdits, setLoadingAllEdits] = useState(false);
  const [loadingForSession, setLoadingForSession] = useState(false);
  // "Clear context & execute" opt-in for ExitPlanMode (Layer 0, plan-mode-429).
  const [loadingFreshContext, setLoadingFreshContext] = useState(false);

  // Check if this is a Codex session - check both metadata.flavor and tool name prefix
  const isCodex = metadata?.flavor === "codex" || toolName.startsWith("Codex");

  // Detect ExitPlanMode early so handleApprove can update permission mode
  const isExitPlan =
    toolName === "exit_plan_mode" || toolName === "ExitPlanMode";

  const handleApprove = async () => {
    if (
      permission.status !== "pending" ||
      loadingButton !== null ||
      loadingAllEdits ||
      loadingForSession
    )
      return;

    setLoadingButton("allow");
    try {
      await sessionAllow(sessionId, permission.id);
      // When approving ExitPlanMode, update App-side permission mode to "default"
      // so subsequent messages no longer carry permissionMode: "plan"
      if (isExitPlan) {
        storage.getState().updateSessionPermissionMode(sessionId, "default");
      }
    } catch (error) {
      log.error("Failed to approve permission:", error);
    } finally {
      setLoadingButton(null);
    }
  };

  const handleApproveAllEdits = async () => {
    if (
      permission.status !== "pending" ||
      loadingButton !== null ||
      loadingAllEdits ||
      loadingForSession
    )
      return;

    setLoadingAllEdits(true);
    try {
      await sessionAllow(sessionId, permission.id, "acceptEdits");
      // Update the session permission mode to 'acceptEdits' for future permissions
      storage.getState().updateSessionPermissionMode(sessionId, "acceptEdits");
    } catch (error) {
      log.error("Failed to approve all edits:", error);
    } finally {
      setLoadingAllEdits(false);
    }
  };

  const handleApproveForSession = async () => {
    if (
      permission.status !== "pending" ||
      loadingButton !== null ||
      loadingAllEdits ||
      loadingForSession ||
      !toolName
    )
      return;

    setLoadingForSession(true);
    try {
      // Special handling for Bash tool - include exact command
      let toolIdentifier = toolName;
      if (toolName === "Bash" && toolInput?.command) {
        const command = toolInput.command;
        toolIdentifier = `Bash(${command})`;
      }

      await sessionAllow(sessionId, permission.id, undefined, [toolIdentifier]);
    } catch (error) {
      log.error("Failed to approve for session:", error);
    } finally {
      setLoadingForSession(false);
    }
  };

  const handleDeny = async () => {
    if (
      permission.status !== "pending" ||
      loadingButton !== null ||
      loadingAllEdits ||
      loadingForSession
    )
      return;

    setLoadingButton("deny");
    try {
      await sessionDeny(sessionId, permission.id);
    } catch (error) {
      log.error("Failed to deny permission:", error);
    } finally {
      setLoadingButton(null);
    }
  };

  // Codex-specific handlers
  const handleCodexApprove = async () => {
    if (
      permission.status !== "pending" ||
      loadingButton !== null ||
      loadingForSession
    )
      return;

    setLoadingButton("allow");
    try {
      await sessionAllow(
        sessionId,
        permission.id,
        undefined,
        undefined,
        "approved",
      );
    } catch (error) {
      log.error("Failed to approve permission:", error);
    } finally {
      setLoadingButton(null);
    }
  };

  const handleCodexApproveForSession = async () => {
    if (
      permission.status !== "pending" ||
      loadingButton !== null ||
      loadingForSession
    )
      return;

    setLoadingForSession(true);
    try {
      await sessionAllow(
        sessionId,
        permission.id,
        undefined,
        undefined,
        "approved_for_session",
      );
    } catch (error) {
      log.error("Failed to approve for session:", error);
    } finally {
      setLoadingForSession(false);
    }
  };

  const handleCodexAbort = async () => {
    if (
      permission.status !== "pending" ||
      loadingButton !== null ||
      loadingForSession
    )
      return;

    setLoadingButton("abort");
    try {
      await sessionDeny(
        sessionId,
        permission.id,
        undefined,
        undefined,
        "abort",
      );
    } catch (error) {
      log.error("Failed to abort permission:", error);
    } finally {
      setLoadingButton(null);
    }
  };

  const isApproved = permission.status === "approved";
  const isDenied = permission.status === "denied";
  const isPending = permission.status === "pending";

  // Helper function to check if tool matches allowed pattern
  const isToolAllowed = (
    toolName: string,
    toolInput: any,
    allowedTools: string[] | undefined,
  ): boolean => {
    if (!allowedTools) return false;

    // Direct match for non-Bash tools
    if (allowedTools.includes(toolName)) return true;

    // For Bash, check exact command match
    if (toolName === "Bash" && toolInput?.command) {
      const command = toolInput.command;
      return allowedTools.includes(`Bash(${command})`);
    }

    return false;
  };

  // Detect which button was used based on mode (for Claude) or decision (for Codex)
  const isApprovedViaAllow =
    isApproved &&
    permission.mode !== "acceptEdits" &&
    permission.mode !== "bypassPermissions" &&
    !isToolAllowed(toolName, toolInput, permission.allowedTools);
  const isApprovedViaAllEdits =
    isApproved &&
    (permission.mode === "acceptEdits" ||
      permission.mode === "bypassPermissions");
  const isApprovedForSession =
    isApproved && isToolAllowed(toolName, toolInput, permission.allowedTools);

  // Codex-specific status detection with fallback
  const isCodexApproved =
    isCodex &&
    isApproved &&
    (permission.decision === "approved" || !permission.decision);
  const isCodexApprovedForSession =
    isCodex && isApproved && permission.decision === "approved_for_session";
  const isCodexAborted = isCodex && isDenied && permission.decision === "abort";

  const styles = StyleSheet.create({
    container: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      justifyContent: "center",
    },
    buttonContainer: {
      flexDirection: "column",
      gap: 4,
      alignItems: "flex-start",
    },
    button: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 1,
      backgroundColor: "transparent",
      alignItems: "flex-start",
      justifyContent: "center",
      minHeight: 32,
      borderLeftWidth: 3,
      borderLeftColor: "transparent",
      alignSelf: "stretch",
    },
    buttonAllow: {
      backgroundColor: "transparent",
    },
    buttonDeny: {
      backgroundColor: "transparent",
    },
    buttonAllowAll: {
      backgroundColor: "transparent",
    },
    buttonSelected: {
      backgroundColor: "transparent",
      borderLeftColor: theme.colors.text,
    },
    buttonInactive: {
      opacity: 0.3,
    },
    buttonContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: 20,
    },
    icon: {
      marginRight: 2,
    },
    buttonText: {
      fontSize: 14,
      fontWeight: "400",
      color: theme.colors.textSecondary,
    },
    buttonTextAllow: {
      color: theme.colors.permissionButton.allow.background,
      fontWeight: "500",
    },
    buttonTextDeny: {
      color: theme.colors.permissionButton.deny.background,
      fontWeight: "500",
    },
    buttonTextAllowAll: {
      color: theme.colors.permissionButton.allowAll.background,
      fontWeight: "500",
    },
    buttonTextSelected: {
      color: theme.colors.text,
      fontWeight: "500",
    },
    buttonForSession: {
      backgroundColor: "transparent",
    },
    buttonTextForSession: {
      color: theme.colors.permissionButton.allowAll.background,
      fontWeight: "500",
    },
    loadingIndicatorAllow: {
      color: theme.colors.permissionButton.allow.background,
    },
    loadingIndicatorDeny: {
      color: theme.colors.permissionButton.deny.background,
    },
    loadingIndicatorAllowAll: {
      color: theme.colors.permissionButton.allowAll.background,
    },
    loadingIndicatorForSession: {
      color: theme.colors.permissionButton.allowAll.background,
    },
    iconApproved: {
      color: theme.colors.permissionButton.allow.background,
    },
    iconDenied: {
      color: theme.colors.permissionButton.deny.background,
    },
    dangerBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      marginBottom: 4,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.permissionButton.deny.background,
      backgroundColor: `${theme.colors.permissionButton.deny.background}14`,
    },
    dangerBadgeText: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.permissionButton.deny.background,
    },
    dangerReasonText: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      flexShrink: 1,
    },
  });

  // Auto Mode danger banner — shown when the CLI classifier flagged this call
  // as potentially destructive (Phase 1). Renders above whichever button set
  // this session type uses.
  const dangerBanner =
    permission.riskLevel === "dangerous" ? (
      <View style={styles.dangerBanner}>
        <Ionicons
          name="warning"
          size={14}
          color={theme.colors.permissionButton.deny.background}
        />
        <Text style={styles.dangerBadgeText}>
          {t("claude.permissions.dangerBadge")}
        </Text>
        {permission.classifierReason ? (
          <Text
            style={styles.dangerReasonText}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {permission.classifierReason}
          </Text>
        ) : null}
      </View>
    ) : null;

  // Render Codex buttons if this is a Codex session
  if (isCodex) {
    return (
      <View style={styles.container}>
        <View style={styles.buttonContainer}>
          {/* Codex: Yes button */}
          <TouchableOpacity
            style={[
              styles.button,
              isPending && styles.buttonAllow,
              isCodexApproved && styles.buttonSelected,
              (isCodexAborted || isCodexApprovedForSession) &&
                styles.buttonInactive,
            ]}
            onPress={handleCodexApprove}
            disabled={!isPending || loadingButton !== null || loadingForSession}
            activeOpacity={isPending ? 0.7 : 1}
          >
            {loadingButton === "allow" && isPending ? (
              <View
                style={[
                  styles.buttonContent,
                  { width: 40, height: 20, justifyContent: "center" },
                ]}
              >
                <ActivityIndicator
                  size={Platform.OS === "ios" ? "small" : (14 as any)}
                  color={styles.loadingIndicatorAllow.color}
                />
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text
                  style={[
                    styles.buttonText,
                    isPending && styles.buttonTextAllow,
                    isCodexApproved && styles.buttonTextSelected,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {t("common.yes")}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Codex: Yes, and don't ask for a session button */}
          <TouchableOpacity
            style={[
              styles.button,
              isPending && styles.buttonForSession,
              isCodexApprovedForSession && styles.buttonSelected,
              (isCodexAborted || isCodexApproved) && styles.buttonInactive,
            ]}
            onPress={handleCodexApproveForSession}
            disabled={!isPending || loadingButton !== null || loadingForSession}
            activeOpacity={isPending ? 0.7 : 1}
          >
            {loadingForSession && isPending ? (
              <View
                style={[
                  styles.buttonContent,
                  { width: 40, height: 20, justifyContent: "center" },
                ]}
              >
                <ActivityIndicator
                  size={Platform.OS === "ios" ? "small" : (14 as any)}
                  color={styles.loadingIndicatorForSession.color}
                />
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text
                  style={[
                    styles.buttonText,
                    isPending && styles.buttonTextForSession,
                    isCodexApprovedForSession && styles.buttonTextSelected,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {t("codex.permissions.yesForSession")}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Codex: Stop, and explain what to do button */}
          <TouchableOpacity
            style={[
              styles.button,
              isPending && styles.buttonDeny,
              isCodexAborted && styles.buttonSelected,
              (isCodexApproved || isCodexApprovedForSession) &&
                styles.buttonInactive,
            ]}
            onPress={handleCodexAbort}
            disabled={!isPending || loadingButton !== null || loadingForSession}
            activeOpacity={isPending ? 0.7 : 1}
          >
            {loadingButton === "abort" && isPending ? (
              <View
                style={[
                  styles.buttonContent,
                  { width: 40, height: 20, justifyContent: "center" },
                ]}
              >
                <ActivityIndicator
                  size={Platform.OS === "ios" ? "small" : (14 as any)}
                  color={styles.loadingIndicatorDeny.color}
                />
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text
                  style={[
                    styles.buttonText,
                    isPending && styles.buttonTextDeny,
                    isCodexAborted && styles.buttonTextSelected,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {t("codex.permissions.stopAndExplain")}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Render ExitPlanMode-specific buttons

  if (isExitPlan) {
    const handlePlanApproveAll = async () => {
      if (
        permission.status !== "pending" ||
        loadingButton !== null ||
        loadingAllEdits
      )
        return;

      setLoadingAllEdits(true);
      try {
        await sessionAllow(sessionId, permission.id, "bypassPermissions");
        storage
          .getState()
          .updateSessionPermissionMode(sessionId, "bypassPermissions");
      } catch (error) {
        log.error("Failed to approve plan with bypass:", error);
      } finally {
        setLoadingAllEdits(false);
      }
    };

    // "Clear context & execute" — approve the plan but tell the CLI to run
    // `/clear` and inject the plan into a fresh session, sidestepping the 200K
    // long-context 429. Mode is left unset (CLI keeps the current session mode,
    // matching plain "Approve plan").
    const handleApproveFreshContext = async () => {
      if (
        permission.status !== "pending" ||
        loadingButton !== null ||
        loadingAllEdits ||
        loadingFreshContext
      )
        return;

      setLoadingFreshContext(true);
      try {
        await sessionAllowPlanFreshContext(sessionId, permission.id);
        // Match handleApprove: leave plan mode so subsequent messages don't
        // carry permissionMode: "plan".
        storage.getState().updateSessionPermissionMode(sessionId, "default");
      } catch (error) {
        log.error("Failed to approve plan with fresh context:", error);
      } finally {
        setLoadingFreshContext(false);
      }
    };

    const handleSubmitFeedback = async (feedbackText: string) => {
      if (
        permission.status !== "pending" ||
        loadingButton !== null ||
        loadingAllEdits ||
        !feedbackText.trim()
      )
        return;

      setLoadingButton("deny");
      try {
        await sessionDeny(
          sessionId,
          permission.id,
          undefined,
          undefined,
          undefined,
          feedbackText.trim(),
        );
      } catch (error) {
        log.error("Failed to deny plan with reason:", error);
      } finally {
        setLoadingButton(null);
      }
    };

    return (
      <ExitPlanButtons
        permission={permission}
        sessionId={sessionId}
        isPending={isPending}
        isApproved={isApproved}
        isDenied={isDenied}
        isApprovedViaAllow={isApprovedViaAllow}
        isApprovedViaAllEdits={isApprovedViaAllEdits}
        loadingButton={loadingButton}
        loadingAllEdits={loadingAllEdits}
        loadingFreshContext={loadingFreshContext}
        handleApprove={handleApprove}
        handlePlanApproveAll={handlePlanApproveAll}
        handleApproveFreshContext={handleApproveFreshContext}
        handleSubmitFeedback={handleSubmitFeedback}
        styles={styles}
      />
    );
  }

  // Render Claude buttons (existing behavior)
  return (
    <View style={styles.container}>
      {dangerBanner}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[
            styles.button,
            isPending && styles.buttonAllow,
            isApprovedViaAllow && styles.buttonSelected,
            (isDenied || isApprovedViaAllEdits || isApprovedForSession) &&
              styles.buttonInactive,
          ]}
          onPress={handleApprove}
          disabled={
            !isPending ||
            loadingButton !== null ||
            loadingAllEdits ||
            loadingForSession
          }
          activeOpacity={isPending ? 0.7 : 1}
        >
          {loadingButton === "allow" && isPending ? (
            <View
              style={[
                styles.buttonContent,
                { width: 40, height: 20, justifyContent: "center" },
              ]}
            >
              <ActivityIndicator
                size={Platform.OS === "ios" ? "small" : (14 as any)}
                color={styles.loadingIndicatorAllow.color}
              />
            </View>
          ) : (
            <View style={styles.buttonContent}>
              <Text
                style={[
                  styles.buttonText,
                  isPending && styles.buttonTextAllow,
                  isApprovedViaAllow && styles.buttonTextSelected,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t("common.yes")}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Allow All Edits button - only show for Edit and MultiEdit tools */}
        {(toolName === "Edit" ||
          toolName === "MultiEdit" ||
          toolName === "Write" ||
          toolName === "NotebookEdit") && (
          <TouchableOpacity
            style={[
              styles.button,
              isPending && styles.buttonAllowAll,
              isApprovedViaAllEdits && styles.buttonSelected,
              (isDenied || isApprovedViaAllow || isApprovedForSession) &&
                styles.buttonInactive,
            ]}
            onPress={handleApproveAllEdits}
            disabled={
              !isPending ||
              loadingButton !== null ||
              loadingAllEdits ||
              loadingForSession
            }
            activeOpacity={isPending ? 0.7 : 1}
          >
            {loadingAllEdits && isPending ? (
              <View
                style={[
                  styles.buttonContent,
                  { width: 40, height: 20, justifyContent: "center" },
                ]}
              >
                <ActivityIndicator
                  size={Platform.OS === "ios" ? "small" : (14 as any)}
                  color={styles.loadingIndicatorAllowAll.color}
                />
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text
                  style={[
                    styles.buttonText,
                    isPending && styles.buttonTextAllowAll,
                    isApprovedViaAllEdits && styles.buttonTextSelected,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {t("claude.permissions.yesAllowAllEdits")}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* Allow for session button - only show for non-edit tools */}
        {toolName &&
          toolName !== "Edit" &&
          toolName !== "MultiEdit" &&
          toolName !== "Write" &&
          toolName !== "NotebookEdit" && (
            <TouchableOpacity
              style={[
                styles.button,
                isPending && styles.buttonForSession,
                isApprovedForSession && styles.buttonSelected,
                (isDenied || isApprovedViaAllow || isApprovedViaAllEdits) &&
                  styles.buttonInactive,
              ]}
              onPress={handleApproveForSession}
              disabled={
                !isPending ||
                loadingButton !== null ||
                loadingAllEdits ||
                loadingForSession
              }
              activeOpacity={isPending ? 0.7 : 1}
            >
              {loadingForSession && isPending ? (
                <View
                  style={[
                    styles.buttonContent,
                    { width: 40, height: 20, justifyContent: "center" },
                  ]}
                >
                  <ActivityIndicator
                    size={Platform.OS === "ios" ? "small" : (14 as any)}
                    color={styles.loadingIndicatorForSession.color}
                  />
                </View>
              ) : (
                <View style={styles.buttonContent}>
                  <Text
                    style={[
                      styles.buttonText,
                      isPending && styles.buttonTextForSession,
                      isApprovedForSession && styles.buttonTextSelected,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {t("claude.permissions.yesForTool")}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}

        <TouchableOpacity
          style={[
            styles.button,
            isPending && styles.buttonDeny,
            isDenied && styles.buttonSelected,
            isApproved && styles.buttonInactive,
          ]}
          onPress={handleDeny}
          disabled={
            !isPending ||
            loadingButton !== null ||
            loadingAllEdits ||
            loadingForSession
          }
          activeOpacity={isPending ? 0.7 : 1}
        >
          {loadingButton === "deny" && isPending ? (
            <View
              style={[
                styles.buttonContent,
                { width: 40, height: 20, justifyContent: "center" },
              ]}
            >
              <ActivityIndicator
                size={Platform.OS === "ios" ? "small" : (14 as any)}
                color={styles.loadingIndicatorDeny.color}
              />
            </View>
          ) : (
            <View style={styles.buttonContent}>
              <Text
                style={[
                  styles.buttonText,
                  isPending && styles.buttonTextDeny,
                  isDenied && styles.buttonTextSelected,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t("claude.permissions.noTellClaude")}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

/**
 * ExitPlanMode-specific buttons with inline feedback input.
 * Extracted to isolate the feedback TextInput state from the parent component.
 */
const ExitPlanButtons: React.FC<{
  permission: PermissionFooterProps["permission"];
  sessionId: string;
  isPending: boolean;
  isApproved: boolean;
  isDenied: boolean;
  isApprovedViaAllow: boolean;
  isApprovedViaAllEdits: boolean;
  loadingButton: "allow" | "deny" | "abort" | null;
  loadingAllEdits: boolean;
  loadingFreshContext: boolean;
  handleApprove: () => void;
  handlePlanApproveAll: () => void;
  handleApproveFreshContext: () => void;
  handleSubmitFeedback: (text: string) => void;
  styles: any;
}> = ({
  permission,
  sessionId,
  isPending,
  isApproved,
  isDenied,
  isApprovedViaAllow,
  isApprovedViaAllEdits,
  loadingButton,
  loadingAllEdits,
  loadingFreshContext,
  handleApprove,
  handlePlanApproveAll,
  handleApproveFreshContext,
  handleSubmitFeedback,
  styles,
}) => {
  const { theme } = useUnistyles();
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");

  const {
    pendingImagePaths,
    pendingImageUris,
    isPickingImage,
    isProcessingImage,
    pendingImagePathsRef,
    doPickImage,
    removeImageByPath,
    clearImages,
  } = useImageUpload(sessionId);

  const hasImages = pendingImagePaths.length > 0;
  const atMaxImages = pendingImagePaths.length >= MAX_IMAGES;

  const onRejectPress = () => {
    if (!isPending || loadingButton !== null || loadingAllEdits) return;
    setShowFeedbackInput(true);
  };

  const onSubmitFeedback = () => {
    const text = feedbackText.trim();
    if (!text && !hasImages) return;

    // Append image references to feedback text (same format as main chat)
    const imageRefs = pendingImagePathsRef.current
      .map((p) => `[image: ${p}]`)
      .join("\n");
    const finalMessage = [text, imageRefs].filter(Boolean).join("\n");

    handleSubmitFeedback(finalMessage);
    clearImages();
    setFeedbackText("");
  };

  return (
    <View style={styles.container}>
      <View style={styles.buttonContainer}>
        {/* Approve Plan */}
        <TouchableOpacity
          style={[
            styles.button,
            isPending && styles.buttonAllow,
            isApprovedViaAllow && styles.buttonSelected,
            (isDenied || isApprovedViaAllEdits) && styles.buttonInactive,
          ]}
          onPress={handleApprove}
          disabled={!isPending || loadingButton !== null || loadingAllEdits}
          activeOpacity={isPending ? 0.7 : 1}
        >
          {loadingButton === "allow" && isPending ? (
            <View
              style={[
                styles.buttonContent,
                { width: 40, height: 20, justifyContent: "center" },
              ]}
            >
              <ActivityIndicator
                size={Platform.OS === "ios" ? "small" : (14 as any)}
                color={(styles as any).loadingIndicatorAllow?.color}
              />
            </View>
          ) : (
            <View style={styles.buttonContent}>
              <Text
                style={[
                  styles.buttonText,
                  isPending && styles.buttonTextAllow,
                  isApprovedViaAllow && styles.buttonTextSelected,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t("plan.approve")}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Approve & Auto-approve All (bypassPermissions) */}
        <TouchableOpacity
          style={[
            styles.button,
            isPending && styles.buttonAllowAll,
            isApprovedViaAllEdits && styles.buttonSelected,
            (isDenied || isApprovedViaAllow) && styles.buttonInactive,
          ]}
          onPress={handlePlanApproveAll}
          disabled={!isPending || loadingButton !== null || loadingAllEdits}
          activeOpacity={isPending ? 0.7 : 1}
        >
          {loadingAllEdits && isPending ? (
            <View
              style={[
                styles.buttonContent,
                { width: 40, height: 20, justifyContent: "center" },
              ]}
            >
              <ActivityIndicator
                size={Platform.OS === "ios" ? "small" : (14 as any)}
                color={(styles as any).loadingIndicatorAllowAll?.color}
              />
            </View>
          ) : (
            <View style={styles.buttonContent}>
              <Text
                style={[
                  styles.buttonText,
                  isPending && styles.buttonTextAllowAll,
                  isApprovedViaAllEdits && styles.buttonTextSelected,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t("plan.approveAutoEdits")}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Clear context & execute (fresh session, avoids 200K long-context 429) */}
        <TouchableOpacity
          style={[
            styles.button,
            isPending && styles.buttonAllow,
            (isDenied || isApprovedViaAllow || isApprovedViaAllEdits) &&
              styles.buttonInactive,
          ]}
          onPress={handleApproveFreshContext}
          disabled={
            !isPending ||
            loadingButton !== null ||
            loadingAllEdits ||
            loadingFreshContext
          }
          activeOpacity={isPending ? 0.7 : 1}
        >
          {loadingFreshContext && isPending ? (
            <View
              style={[
                styles.buttonContent,
                { width: 40, height: 20, justifyContent: "center" },
              ]}
            >
              <ActivityIndicator
                size={Platform.OS === "ios" ? "small" : (14 as any)}
                color={(styles as any).loadingIndicatorAllow?.color}
              />
            </View>
          ) : (
            <View style={styles.buttonContent}>
              <Text
                style={[
                  styles.buttonText,
                  isPending && styles.buttonTextAllow,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t("plan.approveFreshContext")}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Reject with Feedback - inline input */}
        {isDenied && permission.reason ? (
          // Show submitted feedback
          <View style={[styles.button, styles.buttonSelected]}>
            <View style={styles.buttonContent}>
              <Text
                style={[styles.buttonText, styles.buttonTextSelected]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t("plan.rejectWithFeedback")}
              </Text>
            </View>
            <Text
              style={{
                fontSize: 13,
                color: theme.colors.textSecondary,
                marginTop: 4,
              }}
            >
              {permission.reason}
            </Text>
          </View>
        ) : showFeedbackInput && isPending ? (
          // Inline feedback input with image support
          <View style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            {/* Image thumbnails */}
            {hasImages && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingBottom: 8,
                  gap: 8,
                }}
              >
                {pendingImagePaths.map((path, index) => {
                  const uri = pendingImageUris[index];
                  return (
                    <View
                      key={path}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: theme.colors.surfacePressed,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: theme.colors.divider,
                        overflow: "hidden",
                        height: uri ? 48 : 32,
                      }}
                    >
                      {uri ? (
                        <Image
                          source={{ uri }}
                          style={{ width: 48, height: 48 }}
                          contentFit="cover"
                        />
                      ) : (
                        <View
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Ionicons
                            name="image"
                            size={14}
                            color={theme.colors.success}
                          />
                          <Text
                            style={{
                              fontSize: 12,
                              color: theme.colors.textSecondary,
                            }}
                          >
                            {t("session.imageLabel", { index: index + 1 })}
                          </Text>
                        </View>
                      )}
                      <Pressable
                        onPress={() => removeImageByPath(path)}
                        hitSlop={6}
                        style={{
                          paddingHorizontal: 6,
                          paddingVertical: 4,
                        }}
                      >
                        <Ionicons
                          name="close-circle"
                          size={16}
                          color={theme.colors.textSecondary}
                        />
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            {/* Multiline text input */}
            <TextInput
              style={{
                fontSize: 14,
                color: theme.colors.text,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 8,
                minHeight: 80,
                maxHeight: 160,
                textAlignVertical: "top",
              }}
              placeholder={t("plan.rejectPlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              value={feedbackText}
              onChangeText={setFeedbackText}
              returnKeyType="default"
              autoFocus
              multiline
            />

            {/* Action row: image pick + submit */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 8,
              }}
            >
              {/* Image pick button */}
              <Pressable
                onPress={() => {
                  hapticsLight();
                  doPickImage();
                }}
                disabled={isPickingImage || isProcessingImage || atMaxImages}
                hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                style={(p) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  borderRadius: 16,
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  height: 32,
                  opacity:
                    isPickingImage || isProcessingImage || atMaxImages
                      ? 0.4
                      : p.pressed
                        ? 0.6
                        : 1,
                  backgroundColor: hasImages
                    ? `${theme.colors.success}14`
                    : "transparent",
                })}
              >
                {isPickingImage || isProcessingImage ? (
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.success}
                  />
                ) : (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Ionicons
                      name={hasImages ? "image" : "image-outline"}
                      size={18}
                      color={
                        hasImages
                          ? theme.colors.success
                          : theme.colors.textSecondary
                      }
                    />
                    {hasImages && (
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "700",
                          color: theme.colors.success,
                        }}
                      >
                        {pendingImagePaths.length}
                      </Text>
                    )}
                  </View>
                )}
              </Pressable>

              {/* Submit button */}
              {loadingButton === "deny" ? (
                <ActivityIndicator
                  size={Platform.OS === "ios" ? "small" : (14 as any)}
                  color={theme.colors.permissionButton.deny.background}
                />
              ) : (
                <TouchableOpacity
                  onPress={onSubmitFeedback}
                  disabled={!feedbackText.trim() && !hasImages}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "500",
                      color:
                        feedbackText.trim() || hasImages
                          ? theme.colors.permissionButton.deny.background
                          : theme.colors.textSecondary,
                    }}
                  >
                    {t("common.submit")}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          // Reject button
          <TouchableOpacity
            style={[
              styles.button,
              isPending && styles.buttonDeny,
              isDenied && styles.buttonSelected,
              isApproved && styles.buttonInactive,
            ]}
            onPress={onRejectPress}
            disabled={!isPending || loadingButton !== null || loadingAllEdits}
            activeOpacity={isPending ? 0.7 : 1}
          >
            <View style={styles.buttonContent}>
              <Text
                style={[
                  styles.buttonText,
                  isPending && styles.buttonTextDeny,
                  isDenied && styles.buttonTextSelected,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t("plan.rejectWithFeedback")}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};
