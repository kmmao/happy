import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { sessionAllow, sessionDeny } from "@/sync/ops";
import { useUnistyles } from "react-native-unistyles";
import { storage } from "@/sync/storage";
import { t } from "@/text";
import { Modal } from "@/modal";

interface PermissionFooterProps {
  permission: {
    id: string;
    status: "pending" | "approved" | "denied" | "canceled";
    reason?: string;
    mode?: string;
    allowedTools?: string[];
    decision?: "approved" | "approved_for_session" | "denied" | "abort";
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
      console.error("Failed to approve permission:", error);
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
      console.error("Failed to approve all edits:", error);
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
      console.error("Failed to approve for session:", error);
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
      console.error("Failed to deny permission:", error);
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
      console.error("Failed to approve permission:", error);
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
      console.error("Failed to approve for session:", error);
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
      console.error("Failed to abort permission:", error);
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
  });

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
        console.error("Failed to approve plan with bypass:", error);
      } finally {
        setLoadingAllEdits(false);
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
        console.error("Failed to deny plan with reason:", error);
      } finally {
        setLoadingButton(null);
      }
    };

    return (
      <ExitPlanButtons
        permission={permission}
        isPending={isPending}
        isApproved={isApproved}
        isDenied={isDenied}
        isApprovedViaAllow={isApprovedViaAllow}
        isApprovedViaAllEdits={isApprovedViaAllEdits}
        loadingButton={loadingButton}
        loadingAllEdits={loadingAllEdits}
        handleApprove={handleApprove}
        handlePlanApproveAll={handlePlanApproveAll}
        handleSubmitFeedback={handleSubmitFeedback}
        styles={styles}
      />
    );
  }

  // Render Claude buttons (existing behavior)
  return (
    <View style={styles.container}>
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
  isPending: boolean;
  isApproved: boolean;
  isDenied: boolean;
  isApprovedViaAllow: boolean;
  isApprovedViaAllEdits: boolean;
  loadingButton: "allow" | "deny" | "abort" | null;
  loadingAllEdits: boolean;
  handleApprove: () => void;
  handlePlanApproveAll: () => void;
  handleSubmitFeedback: (text: string) => void;
  styles: any;
}> = ({
  permission,
  isPending,
  isApproved,
  isDenied,
  isApprovedViaAllow,
  isApprovedViaAllEdits,
  loadingButton,
  loadingAllEdits,
  handleApprove,
  handlePlanApproveAll,
  handleSubmitFeedback,
  styles,
}) => {
  const { theme } = useUnistyles();
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");

  const onRejectPress = () => {
    if (!isPending || loadingButton !== null || loadingAllEdits) return;
    setShowFeedbackInput(true);
  };

  const onSubmitFeedback = () => {
    if (!feedbackText.trim()) return;
    handleSubmitFeedback(feedbackText);
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
          // Inline feedback input
          <View style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            <TextInput
              style={{
                fontSize: 14,
                color: theme.colors.text,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                borderRadius: 6,
                paddingHorizontal: 10,
                paddingVertical: 8,
                minHeight: 36,
              }}
              placeholder={t("plan.rejectPlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              value={feedbackText}
              onChangeText={setFeedbackText}
              onSubmitEditing={onSubmitFeedback}
              returnKeyType="send"
              autoFocus
              multiline={false}
            />
            {loadingButton === "deny" ? (
              <ActivityIndicator
                size={Platform.OS === "ios" ? "small" : (14 as any)}
                color={theme.colors.permissionButton.deny.background}
                style={{ marginTop: 6 }}
              />
            ) : (
              <TouchableOpacity
                onPress={onSubmitFeedback}
                disabled={!feedbackText.trim()}
                style={{ marginTop: 6 }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "500",
                    color: feedbackText.trim()
                      ? theme.colors.permissionButton.deny.background
                      : theme.colors.textSecondary,
                  }}
                >
                  {t("common.submit")}
                </Text>
              </TouchableOpacity>
            )}
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
