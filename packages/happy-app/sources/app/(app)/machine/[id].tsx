import React, { useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { Typography } from "@/constants/Typography";
import { useSessions, useMachine } from "@/sync/storage";
import { Ionicons, Octicons } from "@expo/vector-icons";
import type { Session } from "@/sync/storageTypes";
import {
  machineStopDaemon,
  machineUpdateMetadata,
  machineBash,
  machineUpgradeCli,
  waitForMachineCliVersion,
} from "@/sync/ops";
import { Modal } from "@/modal";
import {
  formatPathRelativeToHome,
  getSessionName,
  getSessionSubtitle,
} from "@/utils/sessionUtils";
import { isMachineOnline } from "@/utils/machineUtils";
import { sync } from "@/sync/sync";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { useCliVersionCheck } from "@/hooks/useCliVersionCheck";
import { resolveCliSelfUpgradeSupport } from "@/hooks/cliSelfUpgradeSupport";
import { machineSpawnNewSession } from "@/sync/ops";
import { resolveAbsolutePath } from "@/utils/pathUtils";
import {
  MultiTextInput,
  type MultiTextInputHandle,
} from "@/components/MultiTextInput";
import { NetworkServicesSummaryItem } from "@/components/machine/NetworkServicesSection";
import { MachineNavigationSummaryItem } from "@/components/machine/MachineNavigationSummaryItem";
import { AutomationGridSection, AutomationGroupTitle, useAutomationSummaryCounts } from "@/components/machine/AutomationSummarySection";
import { SessionProviderTag } from "@/components/session/SessionProviderTag";

const styles = StyleSheet.create((theme) => ({
  pathInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pathInput: {
    flex: 1,
    borderRadius: 8,
    backgroundColor:
      theme.colors.input?.background ?? theme.colors.groupped.background,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    minHeight: 36,
    position: "relative",
    paddingHorizontal: 10,
    paddingVertical: Platform.select({ web: 6, ios: 4, default: 6 }) as any,
  },
  inlineSendButton: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
  },
  inlineSendActive: {
    backgroundColor: theme.colors.button.primary.background,
  },
  inlineSendInactive: {
    backgroundColor:
      theme.colors.permissionButton?.inactive?.background ??
      theme.colors.surfaceHigh,
  },
  // Daemon compact status bar
  daemonBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  daemonDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  daemonLabel: {
    ...Typography.default("regular"),
    fontSize: 14,
    color: theme.colors.text,
    flex: 1,
  },
  daemonMeta: {
    ...Typography.default("regular"),
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: "Menlo",
  },
  daemonActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  previousSessionRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 220,
  },
}));

function MachineDetailScreen() {
  const { theme } = useUnistyles();
  const { id: machineId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const sessions = useSessions();
  const machine = useMachine(machineId!);
  const automationSummaryCounts = useAutomationSummaryCounts(machineId ?? "");
  const navigateToSession = useNavigateToSession();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStoppingDaemon, setIsStoppingDaemon] = useState(false);
  const [isRenamingMachine, setIsRenamingMachine] = useState(false);
  const [customPath, setCustomPath] = useState("");
  const [isSpawning, setIsSpawning] = useState(false);
  const inputRef = useRef<MultiTextInputHandle>(null);
  const [showAllPaths, setShowAllPaths] = useState(false);
  const [hasDocker, setHasDocker] = useState(false);
  const [isUpgradingCli, setIsUpgradingCli] = useState(false);

  const currentCliVersion = machine?.daemonState?.startedWithCliVersion as string | undefined;
  const { latestVersion, hasUpdate } = useCliVersionCheck(currentCliVersion);
  const cliSelfUpgradeSupport = resolveCliSelfUpgradeSupport(machine);
  const showUpgradeButton =
    hasUpdate &&
    !!latestVersion &&
    !!machine &&
    isMachineOnline(machine) &&
    cliSelfUpgradeSupport.canSelfUpgrade;
  const showUpgradeInfo =
    hasUpdate &&
    !!latestVersion &&
    !!machine &&
    isMachineOnline(machine) &&
    !cliSelfUpgradeSupport.canSelfUpgrade;

  // Check if Docker is available on this machine
  React.useEffect(() => {
    if (!machineId || !machine?.active) return;
    machineBash(machineId, "docker --version", "/").then((r) => {
      setHasDocker(r.success && r.exitCode === 0);
    }).catch(() => setHasDocker(false));
  }, [machineId, machine?.active]);

  const machineSessions = useMemo(() => {
    if (!sessions || !machineId) return [];

    return sessions.filter((item) => {
      if (typeof item === "string") return false;
      const session = item as Session;
      return session.metadata?.machineId === machineId;
    }) as Session[];
  }, [sessions, machineId]);

  const previousSessions = useMemo(() => {
    return [...machineSessions]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 5);
  }, [machineSessions]);

  const recentPaths = useMemo(() => {
    const paths = new Set<string>();
    machineSessions.forEach((session) => {
      if (session.metadata?.path) {
        paths.add(session.metadata.path);
      }
    });
    return Array.from(paths).sort();
  }, [machineSessions]);

  const pathsToShow = useMemo(() => {
    if (showAllPaths) return recentPaths;
    return recentPaths.slice(0, 5);
  }, [recentPaths, showAllPaths]);

  // Determine daemon status from metadata
  const daemonStatus = useMemo(() => {
    if (!machine) return "unknown";

    // Check metadata for daemon status
    const metadata = machine.metadata as any;
    if (metadata?.daemonLastKnownStatus === "shutting-down") {
      return "stopped";
    }

    // Use machine online status as proxy for daemon status
    return isMachineOnline(machine) ? "likely alive" : "stopped";
  }, [machine]);

  const handleStopDaemon = async () => {
    // Show confirmation modal using alert with buttons
    Modal.alert(
      t("machine.stopDaemonTitle"),
      t("machine.stopDaemonMessage"),
      [
        {
          text: t("common.cancel"),
          style: "cancel",
        },
        {
          text: t("machine.stopDaemonButton"),
          style: "destructive",
          onPress: async () => {
            setIsStoppingDaemon(true);
            try {
              const result = await machineStopDaemon(machineId!);
              Modal.alert(t("machine.daemonStopped"), result.message);
              // Refresh to get updated metadata
              await sync.refreshMachines();
            } catch (error) {
              Modal.alert(
                t("common.error"),
                t("machine.failedToStopDaemon"),
              );
            } finally {
              setIsStoppingDaemon(false);
            }
          },
        },
      ],
    );
  };

  const handleUpgradeCli = async () => {
    if (!latestVersion) return;
    Modal.alert(
      t("machine.upgradeCliConfirmTitle"),
      t("machine.upgradeCliConfirmMessage", { version: latestVersion }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("machine.upgradeCliButton"),
          onPress: async () => {
            setIsUpgradingCli(true);
            try {
              const result = await machineUpgradeCli(
                machineId!,
                latestVersion,
              );
              if (result.success) {
                const upgraded = await waitForMachineCliVersion(
                  machineId!,
                  latestVersion,
                );
                if (upgraded) {
                  Modal.alert(
                    t("common.success"),
                    t("machine.upgradeCliSuccess"),
                  );
                } else {
                  Modal.alert(
                    t("common.error"),
                    t("machine.upgradeCliFailed"),
                  );
                }
              } else {
                Modal.alert(
                  t("common.error"),
                  t("machine.upgradeCliFailed"),
                );
              }
            } catch {
              Modal.alert(
                t("common.error"),
                t("machine.upgradeCliFailed"),
              );
            } finally {
              setIsUpgradingCli(false);
            }
          },
        },
      ],
    );
  };

  const handleShowUpgradeUnavailable = () => {
    const reason = cliSelfUpgradeSupport.reason;
    const message =
      reason === "local-source"
        ? t("machine.upgradeCliUnavailableLocalSource")
        : reason === "legacy-cli"
          ? t("machine.upgradeCliUnavailableLegacy")
          : t("machine.upgradeCliUnavailableUnknown");
    Modal.alert(
      t("machine.upgradeCliUnavailableTitle"),
      message,
    );
  };

  // inline control below

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await sync.refreshMachines();
    setIsRefreshing(false);
  };

  const handleRenameMachine = async () => {
    if (!machine || !machineId) return;

    const newDisplayName = await Modal.prompt(
      t("machine.renameMachineTitle"),
      t("machine.renameMachineDescription"),
      {
        defaultValue: machine.metadata?.displayName || "",
        placeholder: machine.metadata?.host || "",
        cancelText: t("common.cancel"),
        confirmText: t("common.rename"),
      },
    );

    if (newDisplayName !== null) {
      setIsRenamingMachine(true);
      try {
        const updatedMetadata = {
          ...machine.metadata!,
          displayName: newDisplayName.trim() || undefined,
        };

        await machineUpdateMetadata(
          machineId,
          updatedMetadata,
          machine.metadataVersion,
        );

        Modal.alert(t("common.success"), t("machine.renameMachineSuccess"));
      } catch (error) {
        Modal.alert(
          t("common.error"),
          error instanceof Error ? error.message : t("machine.renameMachineFailed"),
        );
        // Refresh to get latest state
        await sync.refreshMachines();
      } finally {
        setIsRenamingMachine(false);
      }
    }
  };

  const handleStartSession = async (
    approvedNewDirectoryCreation: boolean = false,
  ): Promise<void> => {
    if (!machine || !machineId) return;
    try {
      const pathToUse = customPath.trim() || "~";
      if (!isMachineOnline(machine)) return;
      setIsSpawning(true);
      const absolutePath = resolveAbsolutePath(
        pathToUse,
        machine?.metadata?.homeDir,
      );
      const result = await machineSpawnNewSession({
        machineId: machineId!,
        directory: absolutePath,
        approvedNewDirectoryCreation,
      });
      switch (result.type) {
        case "success":
          // Dismiss machine picker & machine detail screen
          router.back();
          router.back();
          navigateToSession(result.sessionId);
          break;
        case "requestToApproveDirectoryCreation": {
          const approved = await Modal.confirm(
            t("machine.createDirectoryTitle"),
            t("machine.createDirectoryMessage", { directory: result.directory }),
            { cancelText: t("common.cancel"), confirmText: t("common.create") },
          );
          if (approved) {
            await handleStartSession(true);
          }
          break;
        }
        case "error":
          Modal.alert(t("common.error"), result.errorMessage);
          break;
      }
    } catch (error) {
      let errorMessage = t("machine.failedToStartSession");
      if (
        error instanceof Error &&
        !error.message.includes("Failed to spawn session")
      ) {
        errorMessage = error.message;
      }
      Modal.alert(t("common.error"), errorMessage);
    } finally {
      setIsSpawning(false);
    }
  };

  if (!machine) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: "",
            headerBackTitle: t("machine.back"),
          }}
        />
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <Text style={[Typography.default(), { fontSize: 16, color: "#666" }]}>
            Machine not found
          </Text>
        </View>
      </>
    );
  }

  const metadata = machine.metadata;
  const machineName =
    metadata?.displayName || metadata?.host || "unknown machine";

  const spawnButtonDisabled =
    !customPath.trim() || isSpawning || !isMachineOnline(machine!);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: () => (
            <View style={{ alignItems: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons
                  name="desktop-outline"
                  size={18}
                  color={theme.colors.header.tint}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    Typography.default("semiBold"),
                    { fontSize: 17, color: theme.colors.header.tint },
                  ]}
                >
                  {machineName}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: 2,
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: isMachineOnline(machine)
                      ? "#34C759"
                      : "#999",
                    marginRight: 4,
                  }}
                />
                <Text
                  style={[
                    Typography.default(),
                    {
                      fontSize: 12,
                      color: isMachineOnline(machine) ? "#34C759" : "#999",
                    },
                  ]}
                >
                  {isMachineOnline(machine)
                    ? t("status.ready")
                    : t("status.offline")}
                </Text>
              </View>
            </View>
          ),
          headerRight: () => (
            <Pressable
              onPress={handleRenameMachine}
              hitSlop={10}
              style={{
                opacity: isRenamingMachine ? 0.5 : 1,
              }}
              disabled={isRenamingMachine}
            >
              <Octicons name="pencil" size={24} color={theme.colors.text} />
            </Pressable>
          ),
          headerBackTitle: t("machine.back"),
        }}
      />
      <ItemList
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* Daemon — compact status bar at top */}
        <ItemGroup>
          <View style={styles.daemonBar}>
            <View
              style={[
                styles.daemonDot,
                {
                  backgroundColor:
                    daemonStatus === "likely alive" ? "#34C759" : "#FF9500",
                },
              ]}
            />
            <Text style={styles.daemonLabel}>
              {t("machine.daemon")}
            </Text>
            {machine.daemonState?.startedWithCliVersion && (
              <Text style={styles.daemonMeta}>
                {hasUpdate && latestVersion
                  ? `v${machine.daemonState.startedWithCliVersion} → ${latestVersion}`
                  : `v${machine.daemonState.startedWithCliVersion}`}
              </Text>
            )}
            {machine.daemonState?.pid && (
              <Text style={styles.daemonMeta}>
                PID {machine.daemonState.pid}
              </Text>
            )}
            <View style={styles.daemonActions}>
              {showUpgradeButton && (
                <Pressable onPress={handleUpgradeCli} disabled={isUpgradingCli} hitSlop={8}>
                  {isUpgradingCli ? (
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                  ) : (
                    <Ionicons name="cloud-download-outline" size={18} color={theme.colors.textLink} />
                  )}
                </Pressable>
              )}
              {showUpgradeInfo && (
                <Pressable onPress={handleShowUpgradeUnavailable} hitSlop={8}>
                  <Ionicons name="information-circle-outline" size={18} color={theme.colors.textSecondary} />
                </Pressable>
              )}
              {daemonStatus !== "stopped" && (
                <Pressable
                  onPress={handleStopDaemon}
                  disabled={isStoppingDaemon}
                  hitSlop={8}
                >
                  {isStoppingDaemon ? (
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                  ) : (
                    <Ionicons name="stop-circle" size={18} color="#FF9500" />
                  )}
                </Pressable>
              )}
            </View>
          </View>
        </ItemGroup>

        <ItemGroup title={<AutomationGroupTitle machine={machine} label={t("machine.automation")} activeTaskCount={automationSummaryCounts.activeTaskCount} />}>
          <AutomationGridSection machine={machine} machineId={machineId} summaryCounts={automationSummaryCounts} />
        </ItemGroup>

        {/* Network Services */}
        <NetworkServicesSummaryItem machineId={machineId} machine={machine} />

        {/* Web Terminal (web only) */}
        {Platform.OS === "web" && isMachineOnline(machine) && (
          <MachineNavigationSummaryItem
            groupTitle={t("webTerminal.title")}
            title={t("webTerminal.openTerminal")}
            subtitle={t("webTerminal.title")}
            iconName="code-slash-outline"
            iconColor={theme.colors.textLink}
            onPress={() => router.push(`/machine/${machineId}/terminal` as any)}
          />
        )}

        {/* Background processes */}
        <MachineNavigationSummaryItem
          groupTitle={t("processManager.title")}
          title={t("processManager.viewAll")}
          subtitle={t("processManager.viewAllHint")}
          iconName="terminal-outline"
          iconColor={theme.colors.textLink}
          onPress={() => router.push(`/machine/${machineId}/processes`)}
        />

        {/* Diagnostics — Happy CLI process inspector & cleanup */}
        <MachineNavigationSummaryItem
          groupTitle={t("diagnostics.title")}
          title={t("diagnostics.viewAll")}
          subtitle={t("diagnostics.viewAllHint")}
          iconName="medkit-outline"
          iconColor="#F59E0B"
          onPress={() => router.push(`/machine/${machineId}/diagnostics` as any)}
        />

        {/* Docker Containers (Provision Tokens) — only if Docker is available */}
        {hasDocker && (
          <MachineNavigationSummaryItem
            groupTitle={t("provision.title")}
            title={t("provision.title")}
            subtitle={t("settings.provisionSubtitle")}
            iconName="key-outline"
            iconColor={theme.colors.accentOrange}
            onPress={() =>
              router.push(
                `/settings/provision?machineId=${machineId}` as any,
              )
            }
          />
        )}

        {/* Extensions (per-machine) */}
        <ItemGroup title={t("machine.extensions")}>
          <Item
            title={t("settings.plugins")}
            subtitle={t("settings.pluginsSubtitle")}
            icon={
              <Ionicons
                name="extension-puzzle-outline"
                size={20}
                color="#10B981"
              />
            }
            onPress={() =>
              router.push(
                `/settings/plugins?machineId=${machineId}` as any,
              )
            }
            showChevron
          />
          <Item
            title={t("settings.mcp")}
            subtitle={t("settings.mcpSubtitle")}
            icon={
              <Ionicons
                name="server-outline"
                size={20}
                color="#8B5CF6"
              />
            }
            onPress={() =>
              router.push(
                `/settings/mcp?machineId=${machineId}` as any,
              )
            }
            showChevron
          />
        </ItemGroup>

        {/* Launch section */}
        {machine && (
          <>
            {!isMachineOnline(machine) && (
              <ItemGroup>
                <Item
                  title={t("machine.offlineUnableToSpawn")}
                  subtitle={t("machine.offlineHelp")}
                  subtitleLines={0}
                  showChevron={false}
                />
              </ItemGroup>
            )}
            <ItemGroup title={t("machine.launchNewSessionInDirectory")}>
              <View style={{ opacity: isMachineOnline(machine) ? 1 : 0.5 }}>
                <View style={styles.pathInputContainer}>
                  <View style={styles.pathInput}>
                    <MultiTextInput
                      ref={inputRef}
                      value={customPath}
                      onChangeText={setCustomPath}
                      placeholder={"Enter custom path"}
                      maxHeight={60}
                      paddingTop={4}
                      paddingBottom={4}
                      paddingRight={36}
                    />
                    <Pressable
                      onPress={() => handleStartSession()}
                      disabled={spawnButtonDisabled}
                      style={[
                        styles.inlineSendButton,
                        spawnButtonDisabled
                          ? styles.inlineSendInactive
                          : styles.inlineSendActive,
                      ]}
                    >
                      <Ionicons
                        name="play"
                        size={14}
                        color={
                          spawnButtonDisabled
                            ? theme.colors.textSecondary
                            : theme.colors.button.primary.tint
                        }
                        style={{ marginLeft: 1 }}
                      />
                    </Pressable>
                  </View>
                </View>
                {pathsToShow.map((path, index) => {
                  const display = formatPathRelativeToHome(
                    path,
                    machine.metadata?.homeDir,
                  );
                  const isSelected = customPath.trim() === display;
                  const isLast = index === pathsToShow.length - 1;
                  const hideDivider = isLast && pathsToShow.length <= 5;
                  return (
                    <Item
                      key={path}
                      title={display}
                      leftElement={
                        <Ionicons
                          name="folder-outline"
                          size={18}
                          color={theme.colors.textSecondary}
                        />
                      }
                      onPress={
                        isMachineOnline(machine)
                          ? () => {
                              setCustomPath(display);
                              setTimeout(() => inputRef.current?.focus(), 50);
                            }
                          : undefined
                      }
                      disabled={!isMachineOnline(machine)}
                      selected={isSelected}
                      showChevron={false}
                      pressableStyle={
                        isSelected
                          ? { backgroundColor: theme.colors.surfaceSelected }
                          : undefined
                      }
                      showDivider={!hideDivider}
                    />
                  );
                })}
                {recentPaths.length > 5 && (
                  <Item
                    title={
                      showAllPaths
                        ? t("machineLauncher.showLess")
                        : t("machineLauncher.showAll", {
                            count: recentPaths.length,
                          })
                    }
                    onPress={() => setShowAllPaths(!showAllPaths)}
                    showChevron={false}
                    showDivider={false}
                    titleStyle={{
                      textAlign: "center",
                      color: (theme as any).dark
                        ? theme.colors.button.primary.tint
                        : theme.colors.button.primary.background,
                    }}
                  />
                )}
              </View>
            </ItemGroup>
          </>
        )}

        {/* Previous Sessions (debug view) */}
        {previousSessions.length > 0 && (
          <ItemGroup title={t("machine.previousSessions")}>
            {previousSessions.map((session) => (
              <Item
                key={session.id}
                title={getSessionName(session)}
                subtitle={getSessionSubtitle(session)}
                onPress={() => navigateToSession(session.id)}
                showChevron={false}
                rightElement={
                  <View style={styles.previousSessionRight}>
                    <SessionProviderTag session={session} includeModel />
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={theme.colors.groupped.chevron}
                    />
                  </View>
                }
              />
            ))}
          </ItemGroup>
        )}

        {/* Machine — compact detail layout */}
        <ItemGroup title={t("machine.machineGroup")}>
          <Item
            title={t("machine.host")}
            detail={metadata?.host || machineId}
            showChevron={false}
            copy
          />
          <Item
            title={t("machine.machineId")}
            detail={machineId}
            detailStyle={{ fontFamily: "Menlo", fontSize: 12 }}
            showChevron={false}
            copy
          />
          {metadata?.username && (
            <Item
              title={t("machine.username")}
              detail={metadata.username}
              showChevron={false}
            />
          )}
          {metadata?.homeDir && (
            <Item
              title={t("machine.homeDirectory")}
              detail={metadata.homeDir}
              detailStyle={{ fontFamily: "Menlo", fontSize: 12 }}
              showChevron={false}
              copy
            />
          )}
          {metadata?.platform && metadata?.arch ? (
            <Item
              title={t("machine.platform")}
              detail={`${metadata.platform} / ${metadata.arch}`}
              showChevron={false}
            />
          ) : (
            <>
              {metadata?.platform && (
                <Item title={t("machine.platform")} detail={metadata.platform} showChevron={false} />
              )}
              {metadata?.arch && (
                <Item title={t("machine.architecture")} detail={metadata.arch} showChevron={false} />
              )}
            </>
          )}
          <Item
            title={t("machine.lastSeen")}
            detail={
              machine.activeAt
                ? new Date(machine.activeAt).toLocaleString()
                : t("machine.never")
            }
            showChevron={false}
          />
        </ItemGroup>
      </ItemList>
    </>
  );
}

export default React.memo(MachineDetailScreen);
