import * as React from "react";
import { Pressable, ScrollView, Text, View, type ViewStyle, type StyleProp } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/constants/Typography";
import { useAppendToInput } from "@/hooks/useInputContext";
import { Modal } from "@/modal";
import { useSession, useSessionMessages } from "@/sync/storage";
import { t } from "@/text";
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

const FOOTPRINT_CHART_BUCKETS = 24;
const FOOTPRINT_CHART_HEIGHT = 88;
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

/**
 * Bucket messages into `count` equal time slices between the session's first
 * and last messages, counting user-text / agent-text / tool-call kinds per
 * bucket. Result powers the three sparklines in the 足迹 panel.
 */
function buildActivitySeries(
    messages: readonly Message[],
    count: number,
): ActivityBucket[] {
    const buckets: ActivityBucket[] = Array.from({ length: count }, () => ({
        user: 0,
        agent: 0,
        tool: 0,
    }));
    if (messages.length === 0) return buckets;

    // Walk the message tree to find first/last createdAt and collect leaves.
    type Leaf = { createdAt: number; kind: Message["kind"] };
    const leaves: Leaf[] = [];
    const walk = (msg: Message) => {
        leaves.push({ createdAt: msg.createdAt, kind: msg.kind });
        if (msg.kind === "tool-call") {
            for (const child of msg.children) walk(child);
        }
    };
    for (const m of messages) walk(m);
    if (leaves.length === 0) return buckets;

    let minTs = leaves[0].createdAt;
    let maxTs = leaves[0].createdAt;
    for (const leaf of leaves) {
        if (leaf.createdAt < minTs) minTs = leaf.createdAt;
        if (leaf.createdAt > maxTs) maxTs = leaf.createdAt;
    }
    const span = Math.max(1, maxTs - minTs);

    for (const leaf of leaves) {
        const ratio = (leaf.createdAt - minTs) / span;
        const idx = Math.min(count - 1, Math.floor(ratio * count));
        if (leaf.kind === "user-text") buckets[idx].user += 1;
        else if (leaf.kind === "agent-text") buckets[idx].agent += 1;
        else if (leaf.kind === "tool-call") buckets[idx].tool += 1;
    }
    return buckets;
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

        const data = React.useMemo(() => computeSessionProgress(messages), [messages]);
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
            () => resolveCodexPlanData(checklist, messages),
            [checklist, messages],
        );

        const [showListFiles, setShowListFiles] = React.useState(false);

        // Per-bucket activity curves (user turns / agent turns / tool calls).
        // Bucketing spans the full session timeline into a fixed count so the
        // three sparklines share an X axis and can be visually compared.
        const activitySeries = React.useMemo(
            () => buildActivitySeries(messages, FOOTPRINT_CHART_BUCKETS),
            [messages],
        );
        const rhythm = React.useMemo(
            () => computeRhythm(messages),
            [messages],
        );
        const toolMix = React.useMemo(
            () => computeToolMix(messages, TOOL_MIX_TOP_N, session?.metadata ?? null),
            [messages, session?.metadata],
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
            for (const m of messages) walk(m);
            return extractFileChanges(scoped, session?.metadata ?? null);
        }, [
            checklist.listId,
            session?.metadata,
            messages,
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

        return (
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
            >
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
                                                    <Text style={textStyle}>{displayContent}</Text>
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
                                series={activitySeries}
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
    series: readonly ActivityBucket[];
    userTurns: number;
    agentTurns: number;
    toolCalls: number;
}

/**
 * Build a smooth filled path through `values` (length N), normalized by `max`.
 * X spans 0..width evenly; Y inverted so higher values sit near the top.
 * Returns both the stroke path (line) and fill path (line closed to baseline).
 */
function buildSparklinePath(
    values: readonly number[],
    max: number,
    width: number,
    height: number,
    padBottom: number,
): { stroke: string; fill: string } {
    if (values.length === 0 || max <= 0) {
        return { stroke: "", fill: "" };
    }
    const usableHeight = height - padBottom;
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    const points: Array<[number, number]> = values.map((v, i) => {
        const x = i * step;
        const ratio = Math.max(0, Math.min(1, v / max));
        const y = usableHeight - ratio * usableHeight + 2;
        return [x, y];
    });
    if (points.length === 1) {
        const [x, y] = points[0];
        const stroke = `M ${x} ${y}`;
        return { stroke, fill: "" };
    }

    // Monotone-ish smoothing: use catmull-rom → cubic bezier.
    const stroke = points
        .map(([x, y], i) => {
            if (i === 0) return `M ${x.toFixed(2)} ${y.toFixed(2)}`;
            const [px, py] = points[i - 1];
            const cx = (px + x) / 2;
            return `C ${cx.toFixed(2)} ${py.toFixed(2)} ${cx.toFixed(2)} ${y.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" ");
    const last = points[points.length - 1];
    const first = points[0];
    const fill = `${stroke} L ${last[0].toFixed(2)} ${height} L ${first[0].toFixed(2)} ${height} Z`;
    return { stroke, fill };
}

const FootprintChart = React.memo<FootprintChartProps>(function FootprintChart({
    series,
    userTurns,
    agentTurns,
    toolCalls,
}) {
    const { theme } = useUnistyles();
    const [width, setWidth] = React.useState(0);

    const userMax = Math.max(1, ...series.map((b) => b.user));
    const agentMax = Math.max(1, ...series.map((b) => b.agent));
    const toolMax = Math.max(1, ...series.map((b) => b.tool));
    const h = FOOTPRINT_CHART_HEIGHT;

    const userPath = buildSparklinePath(
        series.map((b) => b.user),
        userMax,
        width,
        h,
        4,
    );
    const agentPath = buildSparklinePath(
        series.map((b) => b.agent),
        agentMax,
        width,
        h,
        4,
    );
    const toolPath = buildSparklinePath(
        series.map((b) => b.tool),
        toolMax,
        width,
        h,
        4,
    );

    const userColor = theme.colors.textSecondary;
    const agentColor = theme.colors.accentBlue;
    const toolColor = theme.colors.accentPurple;

    const hasData = userTurns > 0 || agentTurns > 0 || toolCalls > 0;

    return (
        <View style={styles.chartBlock}>
            <View
                style={[styles.chartSurface, { borderColor: theme.colors.divider }]}
                onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            >
                {width > 0 && hasData && (
                    <Svg width={width} height={h} pointerEvents="none">
                        <Path d={toolPath.fill} fill={toolColor + "22"} />
                        <Path d={toolPath.stroke} stroke={toolColor} strokeWidth={1.5} fill="none" />
                        <Path d={agentPath.fill} fill={agentColor + "22"} />
                        <Path d={agentPath.stroke} stroke={agentColor} strokeWidth={1.5} fill="none" />
                        <Path d={userPath.fill} fill={userColor + "1F"} />
                        <Path d={userPath.stroke} stroke={userColor} strokeWidth={1.5} fill="none" />
                    </Svg>
                )}
            </View>
            <View style={styles.chartLegend}>
                <ChartLegendItem color={userColor} label={t("session.progressUserTurns", { n: userTurns })} />
                <ChartLegendItem color={agentColor} label={t("session.progressAgentTurns", { n: agentTurns })} />
                <ChartLegendItem color={toolColor} label={t("session.progressToolCalls", { n: toolCalls })} />
            </View>
        </View>
    );
});

const ChartLegendItem = React.memo<{ color: string; label: string }>(function ChartLegendItem({
    color,
    label,
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
    todoText: {
        ...Typography.default("regular"),
        fontSize: 13,
        lineHeight: 18,
        flex: 1,
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
        gap: 8,
        marginTop: 4,
    },
    chartSurface: {
        borderRadius: 10,
        borderWidth: 1,
        overflow: "hidden",
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
