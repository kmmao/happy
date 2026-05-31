import * as React from "react";
import { Pressable, ScrollView, Text, View, type ViewStyle, type StyleProp } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/constants/Typography";
import { useAppendToInput } from "@/hooks/useInputContext";
import { Modal } from "@/modal";
import { useSession, useSessionMessages, useWorkflowRuns } from "@/sync/storage";
import { t } from "@/text";
import { WorkflowRunCard } from "./WorkflowRunCard";
import {
    computeSessionProgress,
    countTodoProgress,
    getChecklistTabs,
    resolveChecklist,
    type ChecklistSource,
    type ChecklistTab,
    type ChecklistTabSummary,
    type ProgressTodo,
} from "./sessionProgressData";
import { buildProgressTodoActionSheet } from "./sessionProgressTodoActions";
import {
    FileChangeItem,
} from "./SidePanelCodeTab";
import {
    extractFileChanges,
    type FileChange,
} from "./sidePanelCodeData";
import { DiffStatsBar } from "@/components/diff/DiffStatsBar";
import { CodexPlanSection } from "@/components/session/codex/CodexPlanSection";
import {
    resolveCodexPlanData,
} from "@/components/session/codex/codexProgressPresentation";
import type { ToolMixSemanticKind, ToolMixSegment } from "@/components/session/toolMixData";
import { computeToolMix } from "@/components/session/toolMixData";
import Svg, { Path } from "react-native-svg";
import { Message, ToolCallMessage } from "@/sync/typesMessage";

interface SessionProgressPanelProps {
    sessionId: string;
}

const STATUS_META: Record<ProgressTodo["status"], { icon: keyof typeof Ionicons.glyphMap; colorKey: "accentPurple" | "accentBlue" | "textSecondary" }> = {
    completed: { icon: "checkbox", colorKey: "accentPurple" },
    in_progress: { icon: "ellipse", colorKey: "accentBlue" },
    pending: { icon: "square-outline", colorKey: "textSecondary" },
};

const SPARKLINE_BUCKETS = 32;
const SPARKLINE_HEIGHT = 80;

const TOOL_MIX_TOP_N = Infinity;
/** Palette used by ToolMixBar; falls back if theme keys are missing. */
const TOOL_MIX_PALETTE = [
    "#60A5FA", // blue
    "#A78BFA", // violet
    "#34D399", // emerald
    "#F59E0B", // amber
    "#F472B6", // pink
    "#22D3EE", // cyan
];

interface RhythmStats {
    durationSec: number;
    lastActiveAt: number | null;
}

function computeRhythm(messages: readonly Message[]): RhythmStats {
    if (messages.length === 0) return { durationSec: 0, lastActiveAt: null };
    let minTs = Infinity;
    let maxTs = -Infinity;
    const walk = (m: Message) => {
        if (m.createdAt < minTs) minTs = m.createdAt;
        if (m.createdAt > maxTs) maxTs = m.createdAt;
        if (m.kind === "tool-call") for (const c of m.children) walk(c);
    };
    for (const m of messages) walk(m);
    if (!isFinite(minTs) || !isFinite(maxTs)) {
        return { durationSec: 0, lastActiveAt: null };
    }
    return {
        durationSec: Math.max(0, Math.floor((maxTs - minTs) / 1000)),
        lastActiveAt: maxTs,
    };
}

function getSemanticToolMixLabel(kind: ToolMixSemanticKind): string {
    switch (kind) {
        case "read":
            return t("tools.names.readFile");
        case "write":
            return t("tools.names.writeFile");
        case "search":
            return t("tools.names.search");
        case "list_files":
            return t("tools.names.listFiles");
        case "verify":
            return t("tools.names.verify");
        case "test":
            return t("tools.names.test");
        case "git":
            return t("tools.names.git");
        case "package":
            return t("tools.names.package");
        case "run":
            return t("tools.names.run");
        case "patch":
            return t("tools.names.applyChanges");
        case "diff":
            return t("tools.names.viewDiff");
        case "unknown":
            return t("status.unknown");
        default:
            return t("status.unknown");
    }
}

function getToolMixSegmentLabel(segment: ToolMixSegment): string {
    if (segment.kind === "semantic") {
        return getSemanticToolMixLabel(segment.name as ToolMixSemanticKind);
    }
    return String(segment.name);
}

interface ActivityBucket {
    user: number;
    agent: number;
    tool: number;
}

interface SparklineData {
    buckets: ActivityBucket[];
    startMs: number;
    endMs: number;
}

function buildSparklineData(
    messages: readonly Message[],
    count: number,
): SparklineData {
    const buckets: ActivityBucket[] = Array.from({ length: count }, () => ({
        user: 0, agent: 0, tool: 0,
    }));
    if (messages.length === 0) return { buckets, startMs: 0, endMs: 0 };

    type Leaf = { createdAt: number; kind: Message["kind"] };
    const leaves: Leaf[] = [];
    const walk = (msg: Message) => {
        leaves.push({ createdAt: msg.createdAt, kind: msg.kind });
        if (msg.kind === "tool-call") {
            for (const child of msg.children) walk(child);
        }
    };
    for (const m of messages) walk(m);
    if (leaves.length === 0) return { buckets, startMs: 0, endMs: 0 };

    let minTs = leaves[0].createdAt;
    let maxTs = leaves[0].createdAt;
    for (const leaf of leaves) {
        if (leaf.createdAt < minTs) minTs = leaf.createdAt;
        if (leaf.createdAt > maxTs) maxTs = leaf.createdAt;
    }
    const span = Math.max(1, maxTs - minTs);

    for (const leaf of leaves) {
        const idx = Math.min(count - 1, Math.floor(((leaf.createdAt - minTs) / span) * count));
        if (leaf.kind === "user-text") buckets[idx].user += 1;
        else if (leaf.kind === "agent-text") buckets[idx].agent += 1;
        else if (leaf.kind === "tool-call") buckets[idx].tool += 1;
    }
    return { buckets, startMs: minTs, endMs: maxTs };
}

function buildSmoothPath(
    values: readonly number[],
    max: number,
    width: number,
    height: number,
): { stroke: string; fill: string } {
    if (values.length === 0 || max <= 0) return { stroke: "", fill: "" };
    const pad = 4;
    const usable = height - pad;
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    const pts = values.map((v, i) => {
        const x = i * step;
        const y = usable - (Math.min(1, v / max)) * usable + 2;
        return [x, y] as const;
    });
    if (pts.length === 1) {
        const [, y] = pts[0];
        return {
            stroke: `M 0 ${y.toFixed(1)} L ${width.toFixed(1)} ${y.toFixed(1)}`,
            fill: `M 0 ${y.toFixed(1)} L ${width.toFixed(1)} ${y.toFixed(1)} L ${width.toFixed(1)} ${height} L 0 ${height} Z`,
        };
    }
    const stroke = pts.map(([x, y], i) => {
        if (i === 0) return `M ${x.toFixed(1)} ${y.toFixed(1)}`;
        const [px, py] = pts[i - 1];
        const cx = (px + x) / 2;
        return `C ${cx.toFixed(1)} ${py.toFixed(1)} ${cx.toFixed(1)} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
    const last = pts[pts.length - 1];
    const fill = `${stroke} L ${last[0].toFixed(1)} ${height} L ${pts[0][0].toFixed(1)} ${height} Z`;
    return { stroke, fill };
}

function formatTimeLabel(ms: number): string {
    const d = new Date(ms);
    const M = d.getMonth() + 1;
    const D = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${M}/${D} ${hh}:${mm}`;
}


interface GlassCardProps {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    intensity?: number;
}

/**
 * Frosted-glass surface used to wrap each progress section.
 * BlurView backs a semi-transparent overlay so theme colors bleed through
 * while retaining legibility in both light and dark modes.
 */
const GlassCard = React.memo<GlassCardProps>(function GlassCard({
    children,
    style,
    intensity = 28,
}) {
    const { theme } = useUnistyles();
    const tint = theme.dark ? "dark" : "light";
    return (
        <View
            style={[
                styles.glassCard,
                { borderColor: theme.colors.divider },
                style,
            ]}
        >
            <BlurView
                intensity={intensity}
                tint={tint}
                style={StyleSheet.absoluteFill}
            />
            <View
                style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: theme.colors.surfaceHigh + (theme.dark ? "55" : "80") },
                ]}
            />
            <View style={styles.glassCardBody}>{children}</View>
        </View>
    );
});

function formatRelativeTime(updatedAt: number | null, nowMs: number): string {
    if (updatedAt === null) return "";
    const deltaSec = Math.max(0, Math.floor((nowMs - updatedAt) / 1000));
    if (deltaSec < 60) return t("session.progressTimeJustNow");
    if (deltaSec < 3600) return t("session.progressTimeMinutes", { n: Math.floor(deltaSec / 60) });
    if (deltaSec < 86400) return t("session.progressTimeHours", { n: Math.floor(deltaSec / 3600) });
    return t("session.progressTimeDays", { n: Math.floor(deltaSec / 86400) });
}

export const SessionProgressPanel = React.memo<SessionProgressPanelProps>(
    function SessionProgressPanel({ sessionId }) {
        const { theme } = useUnistyles();
        const { messages } = useSessionMessages(sessionId);
        // During streaming the messages array reference flips on every chunk,
        // and the five useMemos below are all O(messages). Defer the heavy
        // derivations so React catches up only when the main thread is idle;
        // intermediate frames are dropped, the final value always lands.
        const deferredMessages = React.useDeferredValue(messages);
        const session = useSession(sessionId);
        const appendToInput = useAppendToInput();
        const isCodex = session?.metadata?.flavor?.toLowerCase() === "codex";
        const handleTodoTap = React.useCallback(
            (todo: ProgressTodo) => {
                const sheet = buildProgressTodoActionSheet({
                    todo,
                    flavor: session?.metadata?.flavor,
                    appendToInput,
                });
                Modal.alert(sheet.title, sheet.message, sheet.buttons);
            },
            [appendToInput, session?.metadata?.flavor],
        );

        // Tick every 30s so relative time labels stay fresh without re-rendering
        // the rest of the App.
        const [nowMs, setNowMs] = React.useState(() => Date.now());
        React.useEffect(() => {
            const interval = setInterval(() => setNowMs(Date.now()), 30_000);
            return () => clearInterval(interval);
        }, []);

        const data = React.useMemo(
            () => computeSessionProgress(deferredMessages),
            [deferredMessages],
        );
        const tabs = React.useMemo(
            () => getChecklistTabs(session?.metadata?.progress),
            [session?.metadata?.progress],
        );
        // Let the user pin a specific list to view; null means "follow active".
        const [pinnedListId, setPinnedListId] = React.useState<string | null>(null);
        // Reset pin if the pinned list disappears (e.g. archive cap dropped it).
        React.useEffect(() => {
            if (pinnedListId && !tabs.some((t) => t.id === pinnedListId)) {
                setPinnedListId(null);
            }
        }, [tabs, pinnedListId]);
        const checklist = React.useMemo(
            () =>
                resolveChecklist(
                    session?.metadata?.progress,
                    data,
                    pinnedListId ?? undefined,
                ),
            [session?.metadata?.progress, data, pinnedListId],
        );
        const counts = React.useMemo(() => countTodoProgress(checklist.todos), [checklist.todos]);
        const codexPlan = React.useMemo(
            () => resolveCodexPlanData(checklist, deferredMessages),
            [checklist, deferredMessages],
        );

        const [showListFiles, setShowListFiles] = React.useState(false);

        // Per-bucket activity curves (user turns / agent turns / tool calls).
        // Bucketing spans the full session timeline into a fixed count so the
        // three sparklines share an X axis and can be visually compared.
        const sparkline = React.useMemo(
            () => buildSparklineData(deferredMessages, SPARKLINE_BUCKETS),
            [deferredMessages],
        );
        const rhythm = React.useMemo(
            () => computeRhythm(deferredMessages),
            [deferredMessages],
        );
        const toolMix = React.useMemo(
            () => computeToolMix(deferredMessages, TOOL_MIX_TOP_N, session?.metadata ?? null),
            [deferredMessages, session?.metadata],
        );
        const toolsPerTurn = data.agentTurns > 0
            ? data.toolCalls / data.agentTurns
            : 0;

        // Per-list file changes: resolve the active/pinned list's toolCallIds
        // against the session message stream and aggregate into FileChange[].
        // Empty when metadata has no toolCallIds (older CLI) or no messages.
        const listFileChanges = React.useMemo<FileChange[]>(() => {
            const listId = checklist.listId;
            if (!listId) return [];
            const list = session?.metadata?.progress?.lists?.find(
                (l) => l.id === listId,
            );
            const ids = list?.toolCallIds;
            if (!ids || ids.length === 0) return [];
            const idSet = new Set(ids);
            const scoped: ToolCallMessage[] = [];
            const walk = (msg: Message) => {
                if (msg.kind === "tool-call") {
                    const toolId = msg.tool.id;
                    if (toolId && idSet.has(toolId)) scoped.push(msg);
                    for (const child of msg.children) walk(child);
                }
            };
            for (const m of deferredMessages) walk(m);
            return extractFileChanges(scoped, session?.metadata ?? null);
        }, [
            checklist.listId,
            session?.metadata,
            deferredMessages,
        ]);
        const listFileTotalAdditions = React.useMemo(
            () => listFileChanges.reduce((sum, f) => sum + f.totalAdditions, 0),
            [listFileChanges],
        );
        const listFileTotalDeletions = React.useMemo(
            () => listFileChanges.reduce((sum, f) => sum + f.totalDeletions, 0),
            [listFileChanges],
        );

        const hasTodos = checklist.todos.length > 0;
        const hasChecklistState = checklist.source !== "none";
        const hasFootprint = data.toolCalls > 0 || data.userTurns > 0 || data.agentTurns > 0;

        const workflowRuns = useWorkflowRuns(sessionId);
        const orderedWorkflowRuns = React.useMemo(() => {
            // Show running runs first (top, sorted by most recent), then finished
            // runs below (sorted by most recent end). Within each group, newest
            // at the top — this matches users' "what's happening now" mental
            // model for the Progress tab.
            const all = Object.values(workflowRuns);
            const running = all
                .filter((r) => r.status === "running")
                .sort((a, b) => b.startedAt - a.startedAt);
            const done = all
                .filter((r) => r.status !== "running")
                .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
            return [...running, ...done];
        }, [workflowRuns]);

        return (
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
            >
                {orderedWorkflowRuns.length > 0 ? (
                    orderedWorkflowRuns.map((run) => (
                        <WorkflowRunCard key={run.runId} run={run} nowMs={nowMs} />
                    ))
                ) : !isCodex ? (
                    <GlassCard style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Ionicons
                                name="git-network-outline"
                                size={14}
                                color={theme.colors.textSecondary}
                            />
                            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                                Workflow
                            </Text>
                        </View>
                        <View style={styles.emptyBlock}>
                            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                                {t("session.workflowEmpty")}
                            </Text>
                        </View>
                    </GlassCard>
                ) : null}
                {isCodex ? (
                    <>
                        <CodexPlanSection
                            plan={codexPlan}
                            onTodoTap={handleTodoTap}
                            nowMs={nowMs}
                            listFileChanges={listFileChanges}
                            listFileTotalAdditions={listFileTotalAdditions}
                            listFileTotalDeletions={listFileTotalDeletions}
                            tabs={tabs}
                            selectedListId={pinnedListId}
                            onSelectList={(id) =>
                                setPinnedListId((prev) =>
                                    prev === id ? null : id,
                                )
                            }
                        />
                    </>
                ) : (
                    <>
                        <GlassCard style={styles.section}>
                            <View style={styles.sectionHeader}>
                                <Ionicons
                                    name="list-outline"
                                    size={14}
                                    color={theme.colors.textSecondary}
                                />
                                <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                                    {t("session.progressTodosSection")}
                                </Text>
                                {tabs.length > 1 && (
                                    <View style={[styles.tabCountBadge, { backgroundColor: theme.colors.textSecondary + "1F", borderColor: theme.colors.textSecondary + "55" }]}>
                                        <Text style={[styles.tabCountBadgeText, { color: theme.colors.textSecondary }]}>
                                            {tabs.length}
                                        </Text>
                                    </View>
                                )}
                                {hasChecklistState && (
                                    <>
                                        <SourceBadge source={checklist.source} />
                                        {hasTodos && (
                                            <Text style={[styles.sectionCount, { color: theme.colors.textSecondary }]}>
                                                {t("session.progressTodosCount", {
                                                    done: counts.completed,
                                                    total: counts.total,
                                                })}
                                            </Text>
                                        )}
                                    </>
                                )}
                            </View>
                            {tabs.length > 1 && (
                                <ChecklistTabRow
                                    tabs={tabs}
                                    selectedId={checklist.listId ?? null}
                                    onSelect={(id) =>
                                        setPinnedListId((prev) =>
                                            prev === id ? null : id,
                                        )
                                    }
                                />
                            )}
                            {checklist.updatedAt !== null && (
                                <Text style={[styles.timeHint, { color: theme.colors.textSecondary }]}>
                                    {formatRelativeTime(checklist.updatedAt, nowMs)}
                                    {checklist.label ? ` · ${checklist.label}` : ""}
                                    {checklist.currentStage ? ` · ${checklist.currentStage}` : ""}
                                </Text>
                            )}
                            <InlineListSummary
                                listId={checklist.listId}
                                metadata={session?.metadata}
                            />

                            {hasTodos ? (
                                <>
                                    <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceHighest }]}>
                                        <View
                                            style={[
                                                styles.progressFill,
                                                {
                                                    backgroundColor: theme.colors.accentPurple,
                                                    width: `${Math.round(counts.completionRatio * 100)}%`,
                                                },
                                            ]}
                                        />
                                    </View>
                                    <View style={styles.progressLegend}>
                                        <LegendDot color={theme.colors.accentPurple} label={t("session.progressLegendCompleted", { n: counts.completed })} />
                                        <LegendDot color={theme.colors.accentBlue} label={t("session.progressLegendInProgress", { n: counts.inProgress })} />
                                        <LegendDot color={theme.colors.textSecondary} label={t("session.progressLegendPending", { n: counts.pending })} />
                                    </View>
                                    <View style={styles.todoList}>
                                        {checklist.todos.map((todo, index) => {
                                            const meta = STATUS_META[todo.status];
                                            const color = theme.colors[meta.colorKey];
                                            const textStyle = [
                                                styles.todoText,
                                                {
                                                    color: todo.status === "completed" ? color : theme.colors.text,
                                                },
                                            ];
                                            const displayContent =
                                                todo.status === "in_progress" && todo.activeForm
                                                    ? todo.activeForm
                                                    : todo.content;
                                            const showNudge =
                                                todo.status === "completed" &&
                                                todo.verificationNudgeNeeded === true;
                                            return (
                                                <Pressable
                                                    key={`${index}-${todo.content}`}
                                                    onPress={() => handleTodoTap(todo)}
                                                    style={styles.todoRow}
                                                    accessibilityRole="button"
                                                    accessibilityLabel={todo.content}
                                                >
                                                    <Ionicons
                                                        name={meta.icon}
                                                        size={16}
                                                        color={color}
                                                        style={styles.todoIcon}
                                                    />
                                                    <View style={styles.todoTextBlock}>
                                                        <Text style={textStyle}>{displayContent}</Text>
                                                        {todo.description ? (
                                                            <Text
                                                                style={[
                                                                    styles.todoDescription,
                                                                    { color: theme.colors.textSecondary },
                                                                ]}
                                                                numberOfLines={2}
                                                            >
                                                                {todo.description}
                                                            </Text>
                                                        ) : null}
                                                    </View>
                                                    {showNudge && (
                                                        <Ionicons
                                                            name="alert-circle-outline"
                                                            size={14}
                                                            color={theme.colors.warning ?? theme.colors.accentOrange ?? color}
                                                            style={styles.todoNudgeIcon}
                                                            accessibilityLabel={t("session.progressTodoNudgeLabel")}
                                                        />
                                                    )}
                                                    <Ionicons
                                                        name="ellipsis-horizontal"
                                                        size={14}
                                                        color={theme.colors.textSecondary}
                                                        style={styles.todoMenuIcon}
                                                    />
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                    {checklist.blockers && checklist.blockers.length > 0 && (
                                        <View style={styles.blockersBlock}>
                                            <Text style={[styles.subSectionTitle, { color: theme.colors.warning ?? theme.colors.textSecondary }]}>
                                                {t("session.progressBlockersTitle", { n: checklist.blockers.length })}
                                            </Text>
                                            {checklist.blockers.map((blocker, i) => (
                                                <Text
                                                    key={`${i}-${blocker}`}
                                                    style={[styles.blockerItem, { color: theme.colors.text }]}
                                                >
                                                    {`• ${blocker}`}
                                                </Text>
                                            ))}
                                        </View>
                                    )}
                                    {listFileChanges.length > 0 && (
                                        <View style={styles.listFilesBlock}>
                                            <Pressable
                                                onPress={() => setShowListFiles((prev) => !prev)}
                                                hitSlop={6}
                                                style={[
                                                    styles.listFilesHeader,
                                                    { borderColor: theme.colors.divider },
                                                ]}
                                                accessibilityRole="button"
                                                accessibilityState={{ expanded: showListFiles }}
                                            >
                                                <Ionicons
                                                    name={
                                                        showListFiles
                                                            ? "chevron-down"
                                                            : "chevron-forward"
                                                    }
                                                    size={12}
                                                    color={theme.colors.textSecondary}
                                                />
                                                <Text
                                                    style={[
                                                        styles.listFilesHeaderTitle,
                                                        { color: theme.colors.text },
                                                    ]}
                                                >
                                                    {t("session.progressListFilesTitle", {
                                                        n: listFileChanges.length,
                                                    })}
                                                </Text>
                                                <DiffStatsBar
                                                    additions={listFileTotalAdditions}
                                                    deletions={listFileTotalDeletions}
                                                />
                                            </Pressable>
                                            {showListFiles && (
                                                <View
                                                    style={[
                                                        styles.listFilesBody,
                                                        { borderColor: theme.colors.divider },
                                                    ]}
                                                >
                                                    {listFileChanges.map((change) => (
                                                        <FileChangeItem
                                                            key={change.filePath}
                                                            change={change}
                                                        />
                                                    ))}
                                                </View>
                                            )}
                                        </View>
                                    )}
                                </>
                            ) : (
                                <View style={styles.emptyBlock}>
                                    <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                                        {t("session.progressTodosEmpty")}
                                    </Text>
                                </View>
                            )}
                        </GlassCard>
                    </>
                )}

                <GlassCard style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Ionicons
                            name="footsteps-outline"
                            size={14}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                            {t("session.progressFootprintSection")}
                        </Text>
                    </View>

                    {hasFootprint ? (
                        <>
                            <FootprintChart
                                sparkline={sparkline}
                                userTurns={data.userTurns}
                                agentTurns={data.agentTurns}
                                toolCalls={data.toolCalls}
                            />
                            <RhythmRow
                                durationSec={rhythm.durationSec}
                                lastActiveAt={rhythm.lastActiveAt}
                                toolsPerTurn={toolsPerTurn}
                                nowMs={nowMs}
                            />
                            {toolMix.total > 0 && (
                                <ToolMixBar
                                    segments={toolMix.segments}
                                    total={toolMix.total}
                                />
                            )}
                        </>
                    ) : (
                        <View style={styles.emptyBlock}>
                            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                                {t("session.progressFootprintEmpty")}
                            </Text>
                        </View>
                    )}
                </GlassCard>
            </ScrollView>
        );
    },
);

interface InlineListSummaryProps {
    listId: string | undefined;
    metadata: { progress?: { lists?: readonly { id: string; summary?: ChecklistTabSummary }[] } | null } | null | undefined;
}

const InlineListSummary = React.memo<InlineListSummaryProps>(function InlineListSummary({
    listId,
    metadata,
}) {
    const { theme } = useUnistyles();
    const summary = React.useMemo(() => {
        if (listId) {
            const list = metadata?.progress?.lists?.find((l) => l.id === listId);
            if (list?.summary) return list.summary;
        }
        return undefined;
    }, [listId, metadata]);

    if (!summary) return null;

    const hasDecisions = summary.keyDecisions && summary.keyDecisions.length > 0;

    return (
        <View style={styles.inlineSummary}>
            <Text style={[styles.inlineSummaryGoal, { color: theme.colors.text }]}>
                {summary.goal}
            </Text>
            {summary.currentFocus && (
                <Text style={[styles.inlineSummaryFocus, { color: theme.colors.textSecondary }]}>
                    {summary.currentFocus}
                </Text>
            )}
            {hasDecisions && (
                <View style={styles.inlineSummaryDecisions}>
                    {summary.keyDecisions!.map((d, i) => (
                        <Text
                            key={`${i}-${d}`}
                            style={[styles.inlineSummaryDecisionItem, { color: theme.colors.textSecondary }]}
                        >
                            {`• ${d}`}
                        </Text>
                    ))}
                </View>
            )}
        </View>
    );
});

interface ChecklistTabRowProps {
    tabs: readonly ChecklistTab[];
    selectedId: string | null;
    onSelect: (id: string) => void;
}

const ChecklistTabRow = React.memo<ChecklistTabRowProps>(function ChecklistTabRow({
    tabs,
    selectedId,
    onSelect,
}) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.tabRow}>
            {tabs.map((tab) => {
                const active = tab.id === selectedId ||
                    (selectedId === null && tab.active);
                const color = active ? theme.colors.textLink : theme.colors.textSecondary;
                const bg = active
                    ? theme.colors.textLink + "1F"
                    : theme.colors.surfaceHighest;
                const border = active
                    ? theme.colors.textLink + "55"
                    : "transparent";
                return (
                    <Pressable
                        key={tab.id}
                        onPress={() => onSelect(tab.id)}
                        style={[
                            styles.tabChip,
                            { backgroundColor: bg, borderColor: border },
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                    >
                        <Text style={[styles.tabChipText, { color }]}>
                            {tab.label}
                        </Text>
                        <Text style={[styles.tabChipCount, { color }]}>
                            {`${tab.completed}/${tab.total}`}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
});

interface SourceBadgeProps {
    source: ChecklistSource;
}
const SourceBadge = React.memo<SourceBadgeProps>(function SourceBadge({ source }) {
    const { theme } = useUnistyles();
    if (source === "none") return null;
    const label =
        source === "mcp"
            ? t("session.progressSourceMcp")
            : t("session.progressSourceTodoWrite");
    const color = source === "mcp" ? theme.colors.primary : theme.colors.textSecondary;
    return (
        <View style={[styles.sourceBadge, { backgroundColor: color + "1F", borderColor: color + "55" }]}>
            <Text style={[styles.sourceBadgeText, { color }]}>{label}</Text>
        </View>
    );
});

interface LegendDotProps {
    color: string;
    label: string;
}
const LegendDot = React.memo<LegendDotProps>(({ color, label }) => (
    <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, { backgroundColor: color }]} />
        <Text style={[styles.legendLabel, { color }]}>{label}</Text>
    </View>
));

interface FootprintChartProps {
    sparkline: SparklineData;
    userTurns: number;
    agentTurns: number;
    toolCalls: number;
}

const FootprintChart = React.memo<FootprintChartProps>(function FootprintChart({
    sparkline,
    userTurns,
    agentTurns,
    toolCalls,
}) {
    const { theme } = useUnistyles();
    const [width, setWidth] = React.useState(0);
    const { buckets, startMs, endMs } = sparkline;
    const h = SPARKLINE_HEIGHT;

    const userMax = Math.max(1, ...buckets.map((b) => b.user));
    const agentMax = Math.max(1, ...buckets.map((b) => b.agent));
    const toolMax = Math.max(1, ...buckets.map((b) => b.tool));

    const userColor = theme.colors.textSecondary;
    const agentColor = theme.colors.accentBlue;
    const toolColor = theme.colors.accentPurple;

    const paths = React.useMemo(() => {
        if (width <= 0) return null;
        return {
            user: buildSmoothPath(buckets.map((b) => b.user), userMax, width, h),
            agent: buildSmoothPath(buckets.map((b) => b.agent), agentMax, width, h),
            tool: buildSmoothPath(buckets.map((b) => b.tool), toolMax, width, h),
        };
    }, [buckets, userMax, agentMax, toolMax, width, h]);

    const hasData = userTurns > 0 || agentTurns > 0 || toolCalls > 0;

    return (
        <View style={styles.chartBlock}>
            <View
                style={[styles.chartSurface, { borderColor: theme.colors.divider }]}
                onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            >
                {width > 0 && hasData && paths && (
                    <Svg width={width} height={h} pointerEvents="none">
                        <Path d={paths.tool.fill} fill={toolColor + "22"} />
                        <Path d={paths.tool.stroke} stroke={toolColor} strokeWidth={1.5} fill="none" />
                        <Path d={paths.agent.fill} fill={agentColor + "22"} />
                        <Path d={paths.agent.stroke} stroke={agentColor} strokeWidth={1.5} fill="none" />
                        <Path d={paths.user.fill} fill={userColor + "1F"} />
                        <Path d={paths.user.stroke} stroke={userColor} strokeWidth={1.5} fill="none" />
                    </Svg>
                )}
            </View>
            {startMs > 0 && endMs > 0 && startMs !== endMs && (
                <View style={styles.chartTimeRow}>
                    <Text style={[styles.chartTimeLabel, { color: theme.colors.textSecondary }]}>
                        {formatTimeLabel(startMs)}
                    </Text>
                    <Text style={[styles.chartTimeLabel, { color: theme.colors.textSecondary }]}>
                        {formatTimeLabel(endMs)}
                    </Text>
                </View>
            )}
            <View style={styles.chartLegend}>
                <ChartLegendItem color={userColor} label={t("session.progressUserTurns", { n: userTurns })} />
                <ChartLegendItem color={agentColor} label={t("session.progressAgentTurns", { n: agentTurns })} />
                <ChartLegendItem color={toolColor} label={t("session.progressToolCalls", { n: toolCalls })} />
            </View>
        </View>
    );
});

const ChartLegendItem = React.memo<{ color: string; label: string }>(function ChartLegendItem({
    color, label,
}) {
    return (
        <View style={styles.chartLegendItem}>
            <View style={[styles.chartLegendDot, { backgroundColor: color }]} />
            <Text style={[styles.chartLegendLabel, { color }]}>{label}</Text>
        </View>
    );
});

interface RhythmRowProps {
    durationSec: number;
    lastActiveAt: number | null;
    toolsPerTurn: number;
    nowMs: number;
}

/**
 * Three compact stat cards answering questions the sparkline can't:
 * how long has this session been running, when was it last active, and what
 * is the tool intensity per agent turn.
 */
const RhythmRow = React.memo<RhythmRowProps>(function RhythmRow({
    durationSec,
    lastActiveAt,
    toolsPerTurn,
    nowMs,
}) {
    const { theme } = useUnistyles();
    const durationText = durationSec > 0
        ? t("session.progressDurationShort", { seconds: durationSec })
        : "—";
    const lastActiveText = lastActiveAt !== null
        ? formatRelativeTime(lastActiveAt, nowMs)
        : "—";
    const toolsPerTurnText = toolsPerTurn > 0
        ? toolsPerTurn >= 10
            ? toolsPerTurn.toFixed(0)
            : toolsPerTurn.toFixed(1)
        : "—";

    return (
        <View style={styles.rhythmRow}>
            <RhythmCell
                label={t("session.progressDurationLabel")}
                value={durationText}
                color={theme.colors.text}
            />
            <RhythmCell
                label={t("session.progressLastActiveLabel")}
                value={lastActiveText}
                color={theme.colors.text}
            />
            <RhythmCell
                label={t("session.progressToolsPerTurnLabel")}
                value={toolsPerTurnText}
                color={theme.colors.text}
            />
        </View>
    );
});

interface RhythmCellProps {
    label: string;
    value: string;
    color: string;
}
const RhythmCell = React.memo<RhythmCellProps>(function RhythmCell({ label, value, color }) {
    const { theme } = useUnistyles();
    return (
        <View style={[styles.rhythmCell, { borderColor: theme.colors.divider }]}>
            <Text style={[styles.rhythmLabel, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                {label}
            </Text>
            <Text style={[styles.rhythmValue, { color }]} numberOfLines={1}>
                {value}
            </Text>
        </View>
    );
});

interface ToolMixBarProps {
    segments: readonly ToolMixSegment[];
    total: number;
}

/**
 * Horizontal stacked bar showing composition of tool calls by semantic action.
 * Top N segments get distinct palette colors; the rest collapse into a grey
 * "other" segment. Legend lists each segment with its count.
 */
const ToolMixBar = React.memo<ToolMixBarProps>(function ToolMixBar({
    segments,
    total,
}) {
    const { theme } = useUnistyles();
    if (total <= 0) return null;
    const entries = segments.map((seg, i) => ({
        name: getToolMixSegmentLabel(seg),
        count: seg.count,
        color: TOOL_MIX_PALETTE[i % TOOL_MIX_PALETTE.length],
    }));
    return (
        <View style={styles.toolMixBlock}>
            <Text style={[styles.subSectionTitle, { color: theme.colors.textSecondary, marginTop: 0, marginBottom: 4 }]}>
                {t("session.progressToolMixTitle")}
            </Text>
            <View style={[styles.toolMixBar, { backgroundColor: theme.colors.surfaceHighest }]}>
                {entries.map((entry) => {
                    const flex = entry.count / total;
                    if (flex <= 0) return null;
                    return (
                        <View
                            key={entry.name}
                            style={{ flex, backgroundColor: entry.color }}
                        />
                    );
                })}
            </View>
            <View style={styles.toolMixLegend}>
                {entries.map((entry) => (
                    <View key={`lg-${entry.name}`} style={styles.toolMixLegendItem}>
                        <View style={[styles.toolMixLegendDot, { backgroundColor: entry.color }]} />
                        <Text
                            style={[styles.toolMixLegendName, { color: theme.colors.text }]}
                            numberOfLines={1}
                        >
                            {entry.name}
                        </Text>
                        <Text style={[styles.toolMixLegendCount, { color: theme.colors.textSecondary }]}>
                            {entry.count}
                        </Text>
                    </View>
                ))}
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    scrollContent: {
        paddingHorizontal: 16,
        paddingBottom: 16,
        gap: 16,
    },
    subtitle: {
        ...Typography.default("regular"),
        fontSize: 12,
        paddingTop: 12,
    },
    section: {
        gap: 8,
    },
    sectionHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    sectionTitle: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        flex: 1,
    },
    sectionCount: {
        ...Typography.default("regular"),
        fontSize: 11,
    },
    timeHint: {
        ...Typography.default("regular"),
        fontSize: 11,
    },
    tabCountBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        borderWidth: 1,
        minWidth: 20,
        alignItems: "center",
    },
    tabCountBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 9,
        letterSpacing: 0.4,
    },
    sourceBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        borderWidth: 1,
    },
    sourceBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 9,
        textTransform: "uppercase",
        letterSpacing: 0.4,
    },
    progressTrack: {
        height: 4,
        borderRadius: 2,
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
    },
    progressLegend: {
        flexDirection: "row",
        gap: 12,
        flexWrap: "wrap",
    },
    legendItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    legendSwatch: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    legendLabel: {
        ...Typography.default("regular"),
        fontSize: 11,
    },
    todoList: {
        gap: 6,
        marginTop: 4,
    },
    todoRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    todoIcon: {
        marginTop: 1,
    },
    todoMenuIcon: {
        alignSelf: "center",
        opacity: 0.6,
    },
    todoNudgeIcon: {
        alignSelf: "center",
        marginRight: 4,
    },
    inlineSummary: {
        gap: 2,
        paddingVertical: 4,
    },
    inlineSummaryGoal: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        lineHeight: 16,
    },
    inlineSummaryFocus: {
        ...Typography.default("regular"),
        fontSize: 11,
        lineHeight: 15,
    },
    inlineSummaryDecisions: {
        gap: 1,
        marginTop: 2,
    },
    inlineSummaryDecisionItem: {
        ...Typography.default("regular"),
        fontSize: 11,
        lineHeight: 15,
    },
    tabRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        paddingVertical: 6,
    },
    tabChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
    },
    tabChipText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        flexShrink: 1,
    },
    tabChipCount: {
        ...Typography.default("regular"),
        fontSize: 10,
    },
    todoTextBlock: {
        flex: 1,
        gap: 2,
    },
    todoText: {
        ...Typography.default("regular"),
        fontSize: 13,
        lineHeight: 18,
    },
    todoDescription: {
        ...Typography.default("regular"),
        fontSize: 11,
        lineHeight: 15,
    },
    blockersBlock: {
        gap: 2,
        marginTop: 6,
    },
    blockerItem: {
        ...Typography.default("regular"),
        fontSize: 12,
        lineHeight: 16,
    },
    emptyBlock: {
        paddingVertical: 16,
        alignItems: "center",
    },
    emptyText: {
        ...Typography.default("regular"),
        fontSize: 12,
        textAlign: "center",
    },
    subSection: {
        gap: 4,
    },
    subSectionTitle: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        marginTop: 4,
        marginBottom: 2,
    },
    glassCard: {
        borderRadius: 14,
        borderWidth: 1,
        overflow: "hidden",
    },
    glassCardBody: {
        padding: 12,
        gap: 8,
    },
    chartBlock: {
        gap: 6,
        marginTop: 4,
    },
    chartSurface: {
        borderRadius: 10,
        borderWidth: 1,
        overflow: "hidden",
    },
    chartTimeRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingHorizontal: 2,
    },
    chartTimeLabel: {
        ...Typography.mono("regular"),
        fontSize: 9,
    },
    chartLegend: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 12,
    },
    chartLegendItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    chartLegendDot: {
        width: 8,
        height: 2,
        borderRadius: 1,
    },
    chartLegendLabel: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    rhythmRow: {
        flexDirection: "row",
        gap: 8,
        marginTop: 4,
    },
    rhythmCell: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 10,
        paddingVertical: 8,
        paddingHorizontal: 10,
        gap: 2,
    },
    rhythmLabel: {
        ...Typography.default("semiBold"),
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.4,
    },
    rhythmValue: {
        ...Typography.default("semiBold"),
        fontSize: 14,
    },
    toolMixBlock: {
        gap: 6,
        marginTop: 4,
    },
    toolMixBar: {
        flexDirection: "row",
        height: 8,
        borderRadius: 4,
        overflow: "hidden",
    },
    toolMixLegend: {
        flexDirection: "row",
        flexWrap: "wrap",
        rowGap: 4,
        columnGap: 12,
        marginTop: 4,
    },
    toolMixLegendItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    toolMixLegendDot: {
        width: 8,
        height: 8,
        borderRadius: 2,
    },
    toolMixLegendName: {
        ...Typography.mono("regular"),
        fontSize: 11,
        maxWidth: 120,
    },
    toolMixLegendCount: {
        ...Typography.default("regular"),
        fontSize: 10,
    },
    toolMixOtherDetails: {
        borderTopWidth: 1,
        marginTop: 2,
        paddingTop: 6,
        gap: 4,
    },
    toolMixOtherDetailItem: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    toolMixOtherDetailName: {
        ...Typography.mono("regular"),
        fontSize: 10,
        flex: 1,
    },
    toolMixOtherDetailText: {
        ...Typography.mono("regular"),
        fontSize: 10,
    },
    listFilesBlock: {
        gap: 0,
        marginTop: 8,
    },
    listFilesHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 0,
        borderTopWidth: 1,
    },
    listFilesHeaderTitle: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        flex: 1,
    },
    listFilesBody: {
        borderTopWidth: 1,
    },
});
