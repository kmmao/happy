import React, { useCallback } from "react";
import { randomUUID } from "expo-crypto";
import { View, Text, Animated } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { Avatar } from "@/components/Avatar";
import { storage, useSession, useIsDataReady } from "@/sync/storage";
import {
  getSessionName,
  useSessionStatus,
  formatOSPlatform,
  formatPathRelativeToHome,
  getSessionAvatarId,
  getSessionProviderKey,
  getSessionProviderLabel,
} from "@/utils/sessionUtils";
import * as Clipboard from "expo-clipboard";
import { Modal } from "@/modal";
import { sessionKill, sessionDelete, machineSpawnNewSession, sessionForkSession } from "@/sync/ops";
import { handleSessionResumeResult } from "@/sync/sessionResumeFlow";
import { runWithSessionResumeGuard } from "@/sync/sessionResumeGuard";
import { setSessionForkSource } from "@/sync/apiProjects";
import { useAuth } from "@/auth/AuthContext";
import { useUnistyles } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { isVersionSupported, MINIMUM_CLI_VERSION } from "@/utils/versionUtils";
import { useSessionUpgrade } from "@/hooks/useSessionUpgrade";
import { CodeView } from "@/components/CodeView";
import { Session } from "@/sync/storageTypes";
import { useHappyAction } from "@/hooks/useHappyAction";
import { HappyError } from "@/utils/errors";
import { useMachine } from "@/sync/storage";
import { isMachineOnline } from "@/utils/machineUtils";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { WorktreeInfoSection } from "@/components/WorktreeInfoSection";
import {
  applySessionStartPreferences,
  buildForkSessionStartPreferences,
} from "@/app/(app)/new/sessionStartPreferences";
import { sync } from "@/sync/sync";
import { CodexInfoSection } from "./CodexInfoSection";
import { SessionMetadataSection } from "./SessionMetadataSection";

// Animated status dot component
function StatusDot({
  color,
  isPulsing,
  size = 8,
}: {
  color: string;
  isPulsing?: boolean;
  size?: number;
}) {
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (isPulsing) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isPulsing, pulseAnim]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: pulseAnim,
        marginRight: 4,
      }}
    />
  );
}

function SessionInfoContent({ session }: { session: Session }) {
  const { theme } = useUnistyles();
  const router = useRouter();
  const auth = useAuth();
  const devModeEnabled = __DEV__;
  const sessionName = getSessionName(session);
  const sessionStatus = useSessionStatus(session);
  const navigateToSession = useNavigateToSession();

  // Resume preconditions: session has claudeSessionId, machineId, path, and flavor is claude or undefined
  const machine = useMachine(session.metadata?.machineId ?? "");
  const canResume =
    !sessionStatus.isConnected &&
    !session.active &&
    !!session.metadata?.claudeSessionId &&
    !!session.metadata?.machineId &&
    !!session.metadata?.path &&
    (!session.metadata?.flavor || session.metadata.flavor === "claude") &&
    !!machine &&
    isMachineOnline(machine);

  // Fork preconditions: session has claudeSessionId, machineId, path, session is active, and machine online
  const canFork =
    sessionStatus.isConnected &&
    !!session.metadata?.claudeSessionId &&
    !!session.metadata?.machineId &&
    !!session.metadata?.path &&
    (!session.metadata?.flavor || session.metadata.flavor === "claude") &&
    !!machine &&
    isMachineOnline(machine);

  const { needsUpgrade, machineCliVersion, handleUpgrade: handleUpgradeSession } = useSessionUpgrade(session, machine);

  // Check if CLI version is outdated
  const isCliOutdated =
    session.metadata?.version &&
    !isVersionSupported(session.metadata.version, MINIMUM_CLI_VERSION);

  const handleCopySessionId = useCallback(async () => {
    if (!session) return;
    try {
      await Clipboard.setStringAsync(session.id);
      Modal.toast(t("sessionInfo.happySessionIdCopied"));
    } catch (error) {
      Modal.alert(t("common.error"), t("sessionInfo.failedToCopySessionId"));
    }
  }, [session]);

  const handleCopyMetadata = useCallback(async () => {
    if (!session?.metadata) return;
    try {
      await Clipboard.setStringAsync(JSON.stringify(session.metadata, null, 2));
      Modal.toast(t("sessionInfo.metadataCopied"));
    } catch (error) {
      Modal.alert(t("common.error"), t("sessionInfo.failedToCopyMetadata"));
    }
  }, [session]);

  // Use HappyAction for archiving - it handles errors automatically
  const [archivingSession, performArchive] = useHappyAction(async () => {
    const result = await sessionKill(session.id);
    if (!result.success) {
      throw new HappyError(
        result.message || t("sessionInfo.failedToArchiveSession"),
        false,
      );
    }
    // Success - navigate back
    router.back();
    router.back();
  });

  const handleArchiveSession = useCallback(() => {
    Modal.alert(
      t("sessionInfo.archiveSession"),
      t("sessionInfo.archiveSessionConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("sessionInfo.archiveSession"),
          style: "destructive",
          onPress: performArchive,
        },
      ],
    );
  }, [performArchive]);

  // Use HappyAction for deletion - it handles errors automatically
  const [deletingSession, performDelete] = useHappyAction(async () => {
    const result = await sessionDelete(session.id);
    if (!result.success) {
      throw new HappyError(
        result.message || t("sessionInfo.failedToDeleteSession"),
        false,
      );
    }
    // Success - no alert needed, UI will update to show deleted state
  });

  const handleDeleteSession = useCallback(() => {
    const wt = session.metadata?.worktree;
    let warningMessage = t("sessionInfo.deleteSessionWarning");

    if (wt?.isWorktree && wt.branchName) {
      if (wt.prUrl) {
        warningMessage = t("sessionInfo.deleteSessionWorktreePrWarning", {
          branchName: wt.branchName,
        });
      } else if (wt.state !== "merged") {
        warningMessage = t("sessionInfo.deleteSessionWorktreeWarning", {
          branchName: wt.branchName,
        });
      }
    }

    Modal.alert(t("sessionInfo.deleteSession"), warningMessage, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("sessionInfo.deleteSession"),
        style: "destructive",
        onPress: performDelete,
      },
    ]);
  }, [performDelete, session.metadata?.worktree]);

  // Use HappyAction for resume - reconnects to the same Happy session with --resume
  const [resumingSession, performResume] = useHappyAction(async () => {
    await runWithSessionResumeGuard(session.id, async () => {
      const worktree = session.metadata?.worktree;
      const createResumeRequest = (directory?: string) =>
        machineSpawnNewSession({
          machineId: session.metadata!.machineId!,
          directory: directory ?? session.metadata!.path!,
          claudeSessionId: session.metadata!.claudeSessionId!,
          happySessionId: session.id,
          agent: "claude",
        });

      const result = await createResumeRequest();
      await handleSessionResumeResult({
        result,
        onSuccess: () => router.back(),
        requestDirectoryApproval: (directory) =>
          Modal.confirm(
            t("machine.createDirectoryTitle"),
            t("machine.createDirectoryMessage", { directory }),
            { cancelText: t("common.cancel"), confirmText: t("common.create") },
          ),
        retryWithApprovedDirectoryCreation: (directory) => createResumeRequest(directory),
        createError: (message) => new HappyError(message, false),
        getStartSessionFallbackMessage: () => t("machine.failedToStartSession"),
        mapRetryDirectory: (directory) => {
          if (worktree?.isWorktree && worktree.parentRepoPath && directory === session.metadata!.path!) {
            return worktree.parentRepoPath;
          }
          return directory;
        },
      });
    });
  });

  const handleResumeSession = useCallback(() => {
    performResume();
  }, [performResume]);

  // Fork session — create a new session branching from the current one
  const [forkingSession, performFork] = useHappyAction(async () => {
    const forkResult = await sessionForkSession(session.id, {});
    if ("error" in forkResult) {
      throw new HappyError(forkResult.error, false);
    }
    // Pre-allocate a Happy session ID so the spawned process command includes
    // --happy-session-id, enabling diagnostics to identify and navigate to this fork.
    const preAllocatedSessionId = randomUUID();
    const spawnResult = await machineSpawnNewSession({
      machineId: session.metadata!.machineId!,
      directory: forkResult.path,
      claudeSessionId: forkResult.claudeSessionId,
      happySessionId: preAllocatedSessionId,
      forkSourceId: session.id,
      agent: "claude",
    });
    if (spawnResult.type === "error") {
      throw new HappyError(spawnResult.errorMessage, false);
    }
    if (spawnResult.type === "success") {
      await sync.refreshSessions();
      applySessionStartPreferences(
        storage.getState(),
        buildForkSessionStartPreferences(session, spawnResult.sessionId),
      );
      // Record fork relationship on server BEFORE navigating so
      // forkedFromSessionId is available when EmptyMessages renders.
      if (auth.credentials) {
        await setSessionForkSource(spawnResult.sessionId, session.id, auth.credentials);
      }
      Modal.toast(t("sessionInfo.forkSessionSuccess"));
      navigateToSession(spawnResult.sessionId);
    }
  });

  const handleForkSession = useCallback(() => {
    performFork();
  }, [performFork]);

  const formatDate = useCallback((timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  }, []);

  const handleCopyUpdateCommand = useCallback(async () => {
    const updateCommand = "npm install -g happy-coder@latest";
    try {
      await Clipboard.setStringAsync(updateCommand);
      Modal.alert(t("common.success"), updateCommand);
    } catch (error) {
      Modal.alert(t("common.error"), t("common.error"));
    }
  }, []);

  return (
    <>
      <ItemList>
        {/* Session Header */}
        <View
          style={{
            maxWidth: layout.maxWidth,
            alignSelf: "center",
            width: "100%",
          }}
        >
          <View
            style={{
              alignItems: "center",
              paddingVertical: 24,
              backgroundColor: theme.colors.surface,
              marginBottom: 8,
              borderRadius: 12,
              marginHorizontal: 16,
              marginTop: 16,
            }}
          >
            <Avatar
              id={getSessionAvatarId(session)}
              size={80}
              monochrome={!sessionStatus.isConnected}
              flavor={session.metadata?.flavor}
              provider={getSessionProviderKey(session)}
            />
            <Text
              style={{
                fontSize: 20,
                fontWeight: "600",
                marginTop: 12,
                textAlign: "center",
                color: theme.colors.text,
                ...Typography.default("semiBold"),
              }}
            >
              {sessionName}
            </Text>
            <View
              style={{
                marginTop: 8,
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 6,
                backgroundColor: session.metadata?.worktree?.isWorktree
                  ? "rgba(88, 86, 214, 0.12)"
                  : "rgba(52, 199, 89, 0.12)",
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  color: session.metadata?.worktree?.isWorktree
                    ? "#5856D6"
                    : "#34C759",
                  ...Typography.default("semiBold"),
                }}
              >
                {session.metadata?.worktree?.isWorktree
                  ? t("sessionInfo.tagBranch")
                  : t("sessionInfo.tagMain")}
              </Text>
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginTop: 8,
              }}
            >
              <StatusDot
                color={sessionStatus.statusDotColor}
                isPulsing={sessionStatus.isPulsing}
                size={10}
              />
              <Text
                style={{
                  fontSize: 15,
                  color: sessionStatus.statusColor,
                  fontWeight: "500",
                  ...Typography.default(),
                }}
              >
                {sessionStatus.statusText}
              </Text>
            </View>
          </View>
        </View>

        {/* CLI Version Warning */}
        {isCliOutdated && (
          <ItemGroup>
            <Item
              title={t("sessionInfo.cliVersionOutdated")}
              subtitle={t("sessionInfo.updateCliInstructions")}
              icon={
                <Ionicons name="warning-outline" size={29} color="#FF9500" />
              }
              showChevron={false}
              onPress={handleCopyUpdateCommand}
            />
          </ItemGroup>
        )}

        {/* Session Details */}
        <ItemGroup>
          <Item
            title={t("sessionInfo.happySessionId")}
            subtitle={`${session.id.substring(0, 8)}...${session.id.substring(session.id.length - 8)}`}
            icon={
              <Ionicons name="finger-print-outline" size={29} color="#007AFF" />
            }
            onPress={handleCopySessionId}
          />
          {session.metadata?.claudeSessionId && (
            <Item
              title={t("sessionInfo.claudeCodeSessionId")}
              subtitle={`${session.metadata.claudeSessionId.substring(0, 8)}...${session.metadata.claudeSessionId.substring(session.metadata.claudeSessionId.length - 8)}`}
              icon={<Ionicons name="code-outline" size={29} color="#9C27B0" />}
              onPress={async () => {
                try {
                  await Clipboard.setStringAsync(
                    session.metadata!.claudeSessionId!,
                  );
                  Modal.alert(
                    t("common.success"),
                    t("sessionInfo.claudeCodeSessionIdCopied"),
                  );
                } catch (error) {
                  Modal.alert(
                    t("common.error"),
                    t("sessionInfo.failedToCopyClaudeCodeSessionId"),
                  );
                }
              }}
            />
          )}
          <Item
            title={t("sessionInfo.connectionStatus")}
            detail={
              sessionStatus.isConnected
                ? t("status.online")
                : t("status.offline")
            }
            icon={
              <Ionicons
                name="pulse-outline"
                size={29}
                color={sessionStatus.isConnected ? "#34C759" : "#8E8E93"}
              />
            }
            showChevron={false}
          />
          <Item
            title={t("sessionInfo.created")}
            subtitle={formatDate(session.createdAt)}
            icon={
              <Ionicons name="calendar-outline" size={29} color="#007AFF" />
            }
            showChevron={false}
          />
          <Item
            title={t("sessionInfo.lastUpdated")}
            subtitle={formatDate(session.updatedAt)}
            icon={<Ionicons name="time-outline" size={29} color="#007AFF" />}
            showChevron={false}
          />
          <Item
            title={t("sessionInfo.sequence")}
            detail={session.seq.toString()}
            icon={
              <Ionicons name="git-commit-outline" size={29} color="#007AFF" />
            }
            showChevron={false}
          />
        </ItemGroup>

        {/* Worktree Info */}
        {session.metadata?.worktree?.isWorktree &&
          session.metadata.machineId && (
            <WorktreeInfoSection
              sessionId={session.id}
              machineId={session.metadata.machineId}
              worktree={session.metadata.worktree}
            />
          )}

        {/* Quick Actions */}
        <ItemGroup title={t("sessionInfo.quickActions")}>
          {session.metadata?.machineId && (
            <Item
              title={t("sessionInfo.viewMachine")}
              subtitle={t("sessionInfo.viewMachineSubtitle")}
              icon={
                <Ionicons name="server-outline" size={29} color="#007AFF" />
              }
              onPress={() =>
                router.push(`/machine/${session.metadata?.machineId}`)
              }
            />
          )}
          {needsUpgrade && (
            <Item
              title={`${t("sessionInfo.upgradeRestart")} → ${machineCliVersion}`}
              subtitle={t("sessionInfo.upgradeRestartConfirm")}
              icon={
                <Ionicons name="arrow-up-circle-outline" size={29} color="#FF9500" />
              }
              onPress={handleUpgradeSession}
            />
          )}
          {sessionStatus.isConnected && (
            <Item
              title={t("sessionInfo.archiveSession")}
              subtitle={t("sessionInfo.archiveSessionSubtitle")}
              icon={
                <Ionicons name="archive-outline" size={29} color="#FF3B30" />
              }
              onPress={handleArchiveSession}
            />
          )}
          {canResume && (
            <Item
              title={t("sessionInfo.resumeSession")}
              subtitle={t("sessionInfo.resumeSessionSubtitle")}
              icon={<Ionicons name="play-outline" size={29} color="#34C759" />}
              onPress={handleResumeSession}
            />
          )}
          {canFork && (
            <Item
              title={t("sessionInfo.forkSession")}
              subtitle={t("sessionInfo.forkSessionSubtitle")}
              icon={<Ionicons name="git-branch-outline" size={29} color={theme.colors.textLink} />}
              onPress={handleForkSession}
            />
          )}
          {!sessionStatus.isConnected && !session.active && (
            <Item
              title={t("sessionInfo.deleteSession")}
              subtitle={t("sessionInfo.deleteSessionSubtitle")}
              icon={<Ionicons name="trash-outline" size={29} color="#FF3B30" />}
              onPress={handleDeleteSession}
            />
          )}
          <Item
            title={t("timeline.title")}
            subtitle={t("timeline.subtitle")}
            icon={<Ionicons name="time-outline" size={29} color="#5856D6" />}
            onPress={() => router.push(`/session/${session.id}/timeline` as any)}
            showChevron
          />
          <Item
            title="Task Debug"
            subtitle="View raw background task data"
            icon={<Ionicons name="bug-outline" size={29} color="#FF9500" />}
            onPress={() => router.push(`/session/${session.id}/debug-tasks` as any)}
            showChevron
          />
          {session.metadata && (
            <Item
              title={t("sessionInfo.copyMetadata")}
              subtitle={t("sessionInfo.copyMetadataSubtitle")}
              icon={<Ionicons name="copy-outline" size={29} color="#007AFF" />}
              onPress={handleCopyMetadata}
            />
          )}
        </ItemGroup>

        <SessionMetadataSection
          session={session}
          isCliOutdated={!!isCliOutdated}
        />
        <CodexInfoSection session={session} />

        {/* Agent State */}
        {session.agentState && (
          <ItemGroup title={t("sessionInfo.agentState")}>
            <Item
              title={t("sessionInfo.controlledByUser")}
              detail={
                session.agentState.controlledByUser
                  ? t("common.yes")
                  : t("common.no")
              }
              icon={
                <Ionicons name="person-outline" size={29} color="#FF9500" />
              }
              showChevron={false}
            />
            {session.agentState.requests &&
              Object.keys(session.agentState.requests).length > 0 && (
                <Item
                  title={t("sessionInfo.pendingRequests")}
                  detail={Object.keys(
                    session.agentState.requests,
                  ).length.toString()}
                  icon={
                    <Ionicons
                      name="hourglass-outline"
                      size={29}
                      color="#FF9500"
                    />
                  }
                  showChevron={false}
                />
              )}
          </ItemGroup>
        )}

        {/* Activity */}
        <ItemGroup title={t("sessionInfo.activity")}>
          <Item
            title={t("sessionInfo.thinking")}
            detail={session.thinking ? t("common.yes") : t("common.no")}
            icon={
              <Ionicons
                name="bulb-outline"
                size={29}
                color={session.thinking ? "#FFCC00" : "#8E8E93"}
              />
            }
            showChevron={false}
          />
          {session.thinking && (
            <Item
              title={t("sessionInfo.thinkingSince")}
              subtitle={formatDate(session.thinkingAt)}
              icon={<Ionicons name="timer-outline" size={29} color="#FFCC00" />}
              showChevron={false}
            />
          )}
        </ItemGroup>

        {/* Raw JSON (Dev Mode Only) */}
        {devModeEnabled && (
          <ItemGroup title="Raw JSON (Dev Mode)">
            {session.agentState && (
              <>
                <Item
                  title="Agent State"
                  icon={
                    <Ionicons
                      name="code-working-outline"
                      size={29}
                      color="#FF9500"
                    />
                  }
                  showChevron={false}
                />
                <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
                  <CodeView
                    code={JSON.stringify(session.agentState, null, 2)}
                    language="json"
                  />
                </View>
              </>
            )}
            {session.metadata && (
              <>
                <Item
                  title="Metadata"
                  icon={
                    <Ionicons
                      name="information-circle-outline"
                      size={29}
                      color="#5856D6"
                    />
                  }
                  showChevron={false}
                />
                <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
                  <CodeView
                    code={JSON.stringify(session.metadata, null, 2)}
                    language="json"
                  />
                </View>
              </>
            )}
            {sessionStatus && (
              <>
                <Item
                  title="Session Status"
                  icon={
                    <Ionicons
                      name="analytics-outline"
                      size={29}
                      color="#007AFF"
                    />
                  }
                  showChevron={false}
                />
                <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
                  <CodeView
                    code={JSON.stringify(
                      {
                        isConnected: sessionStatus.isConnected,
                        statusText: sessionStatus.statusText,
                        statusColor: sessionStatus.statusColor,
                        statusDotColor: sessionStatus.statusDotColor,
                        isPulsing: sessionStatus.isPulsing,
                      },
                      null,
                      2,
                    )}
                    language="json"
                  />
                </View>
              </>
            )}
            {/* Full Session Object */}
            <Item
              title="Full Session Object"
              icon={
                <Ionicons
                  name="document-text-outline"
                  size={29}
                  color="#34C759"
                />
              }
              showChevron={false}
            />
            <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
              <CodeView
                code={JSON.stringify(session, null, 2)}
                language="json"
              />
            </View>
          </ItemGroup>
        )}
      </ItemList>
    </>
  );
}

export default React.memo(() => {
  const { theme } = useUnistyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession(id);
  const isDataReady = useIsDataReady();

  // Handle three states: loading, deleted, and exists
  if (!isDataReady) {
    // Still loading data
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Ionicons
          name="hourglass-outline"
          size={48}
          color={theme.colors.textSecondary}
        />
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 17,
            marginTop: 16,
            ...Typography.default("semiBold"),
          }}
        >
          {t("common.loading")}
        </Text>
      </View>
    );
  }

  if (!session) {
    // Session has been deleted or doesn't exist
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Ionicons
          name="trash-outline"
          size={48}
          color={theme.colors.textSecondary}
        />
        <Text
          style={{
            color: theme.colors.text,
            fontSize: 20,
            marginTop: 16,
            ...Typography.default("semiBold"),
          }}
        >
          {t("errors.sessionDeleted")}
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 15,
            marginTop: 8,
            textAlign: "center",
            paddingHorizontal: 32,
            ...Typography.default(),
          }}
        >
          {t("errors.sessionDeletedDescription")}
        </Text>
      </View>
    );
  }

  return <SessionInfoContent session={session} />;
});
