import React from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useAllMachines, useLocalSettingMutable } from "@/sync/storage";
import type { Machine } from "@/sync/storageTypes";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchTasks } from "@/sync/apiTasks";
import { fetchTriggerSchedules } from "@/sync/apiTriggerSchedules";
import { fetchWebhookTriggers } from "@/sync/apiWebhookTriggers";
import { sync } from "@/sync/sync";
import { useThrottledCallback } from "@/hooks/useThrottledCallback";
import {
  interactiveWebPressScale,
  interactiveWebPressScaleSubtle,
  useWebHoverProps,
  webInteractive,
} from "@/utils/interactiveSurface";
import { AUTOMATION_SUMMARY_THROTTLE_MS } from "./automationConstants";
import {
  AutomationGridSection,
  useAutomationSummaryCounts,
} from "./AutomationSummarySection";

const stylesheet = StyleSheet.create((theme) => ({
  container: {
    backgroundColor: theme.colors.groupped.background,
    paddingTop: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 6,
  },
  headerTitleColumn: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "transparent",
    ...webInteractive,
  },
  headerChevronButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    ...webInteractive,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerTitle: {
    fontSize: 14,
    color: theme.colors.groupped.sectionTitle,
    letterSpacing: 0.1,
    textTransform: "uppercase",
    ...Typography.default("semiBold"),
  },
  headerBadge: {
    backgroundColor: theme.colors.primary + "22",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: "center",
  },
  headerBadgeText: {
    color: theme.colors.primary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0,
  },
  summaryChipsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexWrap: "wrap",
  },
  summaryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "transparent",
    ...webInteractive,
  },
  // Hover + pressed surfaces are intentionally generic — every Pressable in
  // this header (chip, title, chevron) layers the same two state colors.
  interactiveHovered: {
    backgroundColor: theme.colors.surfaceHigh,
  },
  interactivePressed: {
    backgroundColor: theme.colors.surfacePressed,
  },
  summaryChipText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    ...Typography.default("semiBold"),
  },
  machineGroup: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  machineLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
    gap: 6,
  },
  machineLabelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#34C759",
  },
  machineLabelText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    ...Typography.default("semiBold"),
  },
}));

// Bridges useAutomationSummaryCounts (one hook per machine) into the grid props.
// Lives in its own component so the hook order stays stable when machines
// come and go between renders.
const MachineAutomationCard = React.memo(function MachineAutomationCard({
  machine,
}: {
  machine: Machine;
}) {
  const counts = useAutomationSummaryCounts(machine.id);
  const styles = stylesheet;
  const machineLabel =
    machine.metadata?.displayName ||
    machine.metadata?.host ||
    machine.id;

  return (
    <View style={styles.machineGroup}>
      <View style={styles.machineLabelRow}>
        <View style={styles.machineLabelDot} />
        <Text style={styles.machineLabelText} numberOfLines={1}>
          {machineLabel}
        </Text>
      </View>
      <AutomationGridSection
        machine={machine}
        machineId={machine.id}
        summaryCounts={counts}
      />
    </View>
  );
});

// Walks the online-machine list in display order and returns the first
// machine id whose automation counts match the picker's > 0 test, or null
// if none match. Pure data helper — kept outside hooks so the deep-link
// callbacks can derive their target with a one-liner memo.
function findFirstMachineWithCounts(
  machines: Machine[],
  pickCount: (counts: Record<string, number>) => number,
): string | null {
  for (const machine of machines) {
    const counts =
      ((machine.daemonState?.automation as any)?.counts ?? {}) as Record<
        string,
        number
      >;
    if (pickCount(counts) > 0) return machine.id;
  }
  return null;
}

type GlobalSummary = {
  running: number;
  queued: number;
  failed: number;
  guardians: number;
  triggerCount: number | null;
  activeTaskCount: number | null;
};

// Aggregates fleet-wide automation numbers for the collapsed header.
// Live counts come straight from storage (no API calls); active task and
// trigger totals are pulled once globally (no machineId filter) so the header
// stays in sync without each MachineAutomationCard duplicating the request.
function useGlobalAutomationSummary(machines: Machine[]): GlobalSummary {
  const liveCounts = React.useMemo(() => {
    let running = 0;
    let queued = 0;
    let failed = 0;
    let guardians = 0;
    for (const machine of machines) {
      const automation = machine.daemonState?.automation as any;
      if (!automation) continue;
      const counts = automation.counts ?? {};
      running += (counts.running ?? 0) + (counts.dispatching ?? 0);
      queued += counts.queued ?? 0;
      failed += counts.failed ?? 0;
      guardians += Array.isArray(automation.guardians)
        ? automation.guardians.length
        : 0;
    }
    return { running, queued, failed, guardians };
  }, [machines]);

  const [activeTaskCount, setActiveTaskCount] = React.useState<number | null>(
    null,
  );
  const [triggerCount, setTriggerCount] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    const credentials = await TokenStorage.getCredentials().catch(() => null);
    if (!credentials) return;

    fetchTasks(credentials, { limit: 100 })
      .then(({ tasks }) => {
        const count = tasks.filter((task) =>
          ["queued", "dispatching", "running"].includes(task.status),
        ).length;
        setActiveTaskCount(count);
      })
      .catch(() => {});

    Promise.all([
      fetchTriggerSchedules(credentials, { enabled: true }),
      fetchWebhookTriggers(credentials, { enabled: true }),
    ])
      .then(([cron, webhooks]) => {
        setTriggerCount(cron.total + webhooks.total);
      })
      .catch(() => {});
  }, []);

  // First-mount fetch fires immediately; subsequent task-status events are
  // throttled so a burst (e.g. swarm dispatch firing dozens of events in a
  // few hundred ms) coalesces into one trailing fetch.
  const throttledLoad = useThrottledCallback(load, AUTOMATION_SUMMARY_THROTTLE_MS);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    return sync.onTaskStatusChanged(() => {
      throttledLoad();
    });
  }, [throttledLoad]);

  return { ...liveCounts, activeTaskCount, triggerCount };
}

// Single chip in the collapsed summary row — only renders when value > 0,
// so an idle fleet collapses cleanly to just the section title. Each chip is
// pressable: tapping any of them expands the header so the user can drill
// into the full per-machine grid that backs the number they care about.
// Hover (web) and press feedback are mirrored from the standard
// CommandPaletteItem pattern: hover only fires on web, press fires on all
// platforms (touch counts).
function SummaryChip({
  icon,
  value,
  color,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  value: number;
  color: string;
  onPress: () => void;
}) {
  const styles = stylesheet;
  const { isHovered, hoverProps } = useWebHoverProps();

  if (value <= 0) return null;

  return (
    <Pressable
      {...hoverProps}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.summaryChip,
        isHovered && styles.interactiveHovered,
        pressed && styles.interactivePressed,
        pressed && interactiveWebPressScale,
      ]}
    >
      <Ionicons name={icon} size={12} color={color} />
      <Text style={[styles.summaryChipText, { color }]}>{value}</Text>
    </Pressable>
  );
}

// Section-title pressable used in the header. Hover/press feedback is
// purely visual reinforcement that the title is the same toggle target as
// the chevron — taps still just collapse/expand.
function HeaderTitlePressable({
  label,
  badgeCount,
  onPress,
}: {
  label: string;
  badgeCount: number;
  onPress: () => void;
}) {
  const styles = stylesheet;
  const { isHovered, hoverProps } = useWebHoverProps();
  return (
    <Pressable
      {...hoverProps}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.headerTitleColumn,
        isHovered && styles.interactiveHovered,
        pressed && styles.interactivePressed,
        pressed && interactiveWebPressScaleSubtle,
      ]}
    >
      <View style={styles.headerTitleRow}>
        <Text style={styles.headerTitle}>{label}</Text>
        {badgeCount > 0 ? (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{badgeCount}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// Circular chevron button — distinct round target so the hover/press surface
// reads as a button on web, not as a slab of background highlight.
function HeaderChevronPressable({
  collapsed,
  color,
  onPress,
}: {
  collapsed: boolean;
  color: string;
  onPress: () => void;
}) {
  const styles = stylesheet;
  const { isHovered, hoverProps } = useWebHoverProps();
  return (
    <Pressable
      {...hoverProps}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [
        styles.headerChevronButton,
        isHovered && styles.interactiveHovered,
        pressed && styles.interactivePressed,
        pressed && interactiveWebPressScaleSubtle,
      ]}
    >
      <Ionicons
        name={collapsed ? "chevron-down" : "chevron-up"}
        size={16}
        color={color}
      />
    </Pressable>
  );
}

export const SessionsAutomationHeader = React.memo(
  function SessionsAutomationHeader() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const machines = useAllMachines();
    const [collapsed, setCollapsed] = useLocalSettingMutable(
      "sessionsAutomationCollapsed",
    );
    const router = useRouter();
    const summary = useGlobalAutomationSummary(machines);
    // Chips share the same "expand the header" action so a user who notices
    // a non-zero metric can drill in without having to find the chevron.
    const expand = React.useCallback(() => setCollapsed(false), [setCollapsed]);

    // First machine (by useAllMachines order — most recently active first)
    // matching the given chip's predicate. Used to short-circuit chips into
    // direct deep links instead of just expanding the header. When multiple
    // machines match, the user still lands on the most recently active one,
    // which is almost always what they meant.
    const firstRunningMachineId = React.useMemo(
      () =>
        findFirstMachineWithCounts(
          machines,
          (counts) => (counts.running ?? 0) + (counts.dispatching ?? 0),
        ),
      [machines],
    );
    const firstFailedMachineId = React.useMemo(
      () =>
        findFirstMachineWithCounts(machines, (counts) => counts.failed ?? 0),
      [machines],
    );

    // Both deep-link chips fall back to `expand()` when the predicate
    // somehow yields nothing — the chip itself only renders for value > 0,
    // but storage and the per-machine counts can drift for a frame and we
    // never want a button that looks live to feel inert.
    const openFirstRunning = React.useCallback(() => {
      if (!firstRunningMachineId) {
        expand();
        return;
      }
      router.push(
        `/machine/${firstRunningMachineId}/automation?jobFilter=running` as any,
      );
    }, [firstRunningMachineId, router, expand]);
    const openFirstFailed = React.useCallback(() => {
      if (!firstFailedMachineId) {
        expand();
        return;
      }
      router.push(
        `/machine/${firstFailedMachineId}/automation?jobFilter=failed` as any,
      );
    }, [firstFailedMachineId, router, expand]);

    // Hide the whole header on accounts with no online machines — there is
    // nothing meaningful to surface and an empty group would just take space.
    if (!machines.length) {
      return null;
    }

    const onlineMachineCount = machines.length;
    // Falsy guard for the "everything idle" case: when nothing is happening
    // we keep the chip row out of the layout so the header stays compact.
    const hasAnySummary =
      summary.running > 0 ||
      summary.queued > 0 ||
      summary.failed > 0 ||
      (summary.activeTaskCount ?? 0) > 0 ||
      (summary.triggerCount ?? 0) > 0;

    const toggle = () => setCollapsed(!collapsed);

    return (
      <View style={styles.container}>
        {/* Header row: title + chevron are independent Pressables, NOT a
            single outer Pressable wrapping the chip row. Nesting Pressables
            would let chip taps bubble to the toggle on web (RN-Web maps
            onPress → onClick which bubbles in the DOM), making chips appear
            inert because the trailing toggle re-collapses immediately. */}
        <View style={styles.headerRow}>
          <HeaderTitlePressable
            label={t("machine.automation")}
            badgeCount={onlineMachineCount}
            onPress={toggle}
          />
          <HeaderChevronPressable
            collapsed={collapsed}
            color={theme.colors.textSecondary}
            onPress={toggle}
          />
        </View>

        {collapsed && hasAnySummary ? (
          <View style={styles.summaryChipsRow}>
            <SummaryChip
              icon="play-circle"
              value={summary.running}
              color="#0A84FF"
              onPress={openFirstRunning}
            />
            <SummaryChip
              icon="time-outline"
              value={summary.queued}
              color="#FF9500"
              onPress={expand}
            />
            <SummaryChip
              icon="alert-circle-outline"
              value={summary.failed}
              color="#FF3B30"
              onPress={openFirstFailed}
            />
            <SummaryChip
              icon="list"
              value={summary.activeTaskCount ?? 0}
              color="#FF9500"
              onPress={expand}
            />
            <SummaryChip
              icon="timer"
              value={summary.triggerCount ?? 0}
              color="#34C759"
              onPress={expand}
            />
          </View>
        ) : null}

        {!collapsed
          ? machines.map((machine) => (
              <MachineAutomationCard key={machine.id} machine={machine} />
            ))
          : null}
      </View>
    );
  },
);
