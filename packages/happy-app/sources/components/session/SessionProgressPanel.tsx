import * as React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
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
    type ProgressTodo,
} from "./sessionProgressData";

interface SessionProgressPanelProps {
    sessionId: string;
}

const STATUS_META: Record<ProgressTodo["status"], { icon: keyof typeof Ionicons.glyphMap; colorKey: "success" | "accentBlue" | "textSecondary" }> = {
    completed: { icon: "checkbox", colorKey: "success" },
    in_progress: { icon: "ellipse", colorKey: "accentBlue" },
    pending: { icon: "square-outline", colorKey: "textSecondary" },
};

const MAX_FILES_VISIBLE = 8;
const MAX_COMMANDS_VISIBLE = 6;

function truncateMiddle(value: string, max = 48): string {
    if (value.length <= max) return value;
    const head = Math.ceil((max - 1) / 2);
    const tail = max - 1 - head;
    return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

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

        const handleRefreshProgress = React.useCallback(() => {
            appendToInput(t("session.progressRefreshPrompt"));
        }, [appendToInput]);

        const handleRefreshSummary = React.useCallback(() => {
            appendToInput(t("session.progressSummaryRefreshPrompt"));
        }, [appendToInput]);

        const handleTodoTap = React.useCallback(
            (todo: ProgressTodo) => {
                const content = todo.content;
                // Per-status action set — skip actions whose semantics don't fit:
                //   completed:   verify + issue            (no "continue" on done)
                //   in_progress: verify + continue + issue (full set)
                //   pending:     continue + issue          (no "verify" — nothing done yet)
                const showVerify = todo.status !== "pending";
                const showContinue = todo.status !== "completed";

                const buttons = [
                    ...(showVerify
                        ? [
                              {
                                  text: t("session.progressTodoActionVerify"),
                                  onPress: () =>
                                      appendToInput(
                                          t("session.progressTodoPromptVerify", { content }),
                                      ),
                              },
                          ]
                        : []),
                    ...(showContinue
                        ? [
                              {
                                  text: t("session.progressTodoActionContinue"),
                                  onPress: () =>
                                      appendToInput(
                                          t("session.progressTodoPromptContinue", { content }),
                                      ),
                              },
                          ]
                        : []),
                    {
                        text: t("session.progressTodoActionIssue"),
                        style: "destructive" as const,
                        onPress: () =>
                            appendToInput(
                                t("session.progressTodoPromptIssue", { content }),
                            ),
                    },
                    {
                        text: t("common.cancel"),
                        style: "cancel" as const,
                    },
                ];
                Modal.alert(
                    content.length > 80 ? content.slice(0, 79) + "…" : content,
                    t("session.progressTodoActionMessage"),
                    buttons,
                );
            },
            [appendToInput],
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
        const summary = session?.metadata?.sessionSummary;

        const [showAllFiles, setShowAllFiles] = React.useState(false);
        const [showAllCommands, setShowAllCommands] = React.useState(false);

        const visibleFiles = showAllFiles ? data.files : data.files.slice(0, MAX_FILES_VISIBLE);
        const visibleCommands = showAllCommands
            ? data.commands
            : data.commands.slice(0, MAX_COMMANDS_VISIBLE);

        const hasTodos = checklist.todos.length > 0;
        const hasFootprint =
            data.files.length > 0 || data.commands.length > 0 || data.toolCalls > 0;

        return (
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
            >
                <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                    {t("session.progressSubtitle")}
                </Text>

                <SummaryCard
                    summary={summary}
                    onRefresh={handleRefreshSummary}
                    nowMs={nowMs}
                />

                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Ionicons
                            name="list-outline"
                            size={14}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                            {t("session.progressTodosSection")}
                        </Text>
                        {hasTodos && (
                            <>
                                <SourceBadge source={checklist.source} />
                                <Text style={[styles.sectionCount, { color: theme.colors.textSecondary }]}>
                                    {t("session.progressTodosCount", {
                                        done: counts.completed,
                                        total: counts.total,
                                    })}
                                </Text>
                            </>
                        )}
                        <Pressable
                            onPress={handleRefreshProgress}
                            hitSlop={8}
                            style={[styles.refreshButton, { borderColor: theme.colors.textLink + "55" }]}
                            accessibilityRole="button"
                            accessibilityLabel={t("session.progressRefreshActionLabel")}
                        >
                            <Ionicons
                                name="refresh-outline"
                                size={12}
                                color={theme.colors.textLink}
                                style={styles.refreshIcon}
                            />
                            <Text style={[styles.refreshText, { color: theme.colors.textLink }]}>
                                {t("session.progressRefreshActionLabel")}
                            </Text>
                        </Pressable>
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
                    {hasTodos && checklist.updatedAt !== null && (
                        <Text style={[styles.timeHint, { color: theme.colors.textSecondary }]}>
                            {formatRelativeTime(checklist.updatedAt, nowMs)}
                            {checklist.label ? ` · ${checklist.label}` : ""}
                            {checklist.currentStage ? ` · ${checklist.currentStage}` : ""}
                        </Text>
                    )}

                    {hasTodos ? (
                        <>
                            <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceHighest }]}>
                                <View
                                    style={[
                                        styles.progressFill,
                                        {
                                            backgroundColor: theme.colors.success,
                                            width: `${Math.round(counts.completionRatio * 100)}%`,
                                        },
                                    ]}
                                />
                            </View>
                            <View style={styles.progressLegend}>
                                <LegendDot color={theme.colors.success} label={t("session.progressLegendCompleted", { n: counts.completed })} />
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
                                            textDecorationLine:
                                                todo.status === "completed" ? ("line-through" as const) : undefined,
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
                        </>
                    ) : (
                        <View style={styles.emptyBlock}>
                            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                                {t("session.progressTodosEmpty")}
                            </Text>
                        </View>
                    )}
                </View>

                <View style={styles.section}>
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
                            <View style={styles.statRow}>
                                <StatPill
                                    icon="person-outline"
                                    label={t("session.progressUserTurns", { n: data.userTurns })}
                                />
                                <StatPill
                                    icon="sparkles-outline"
                                    label={t("session.progressAgentTurns", { n: data.agentTurns })}
                                />
                                <StatPill
                                    icon="hammer-outline"
                                    label={t("session.progressToolCalls", { n: data.toolCalls })}
                                />
                            </View>

                            {data.files.length > 0 && (
                                <View style={styles.subSection}>
                                    <Text style={[styles.subSectionTitle, { color: theme.colors.textSecondary }]}>
                                        {t("session.progressFilesTitle", { n: data.files.length })}
                                    </Text>
                                    {visibleFiles.map((file) => (
                                        <View key={file.path} style={styles.footprintRow}>
                                            <Ionicons
                                                name="document-text-outline"
                                                size={12}
                                                color={theme.colors.textSecondary}
                                                style={styles.footprintIcon}
                                            />
                                            <Text
                                                style={[styles.footprintPath, { color: theme.colors.text }]}
                                                numberOfLines={1}
                                            >
                                                {truncateMiddle(file.path)}
                                            </Text>
                                            {file.edits > 1 && (
                                                <Text style={[styles.footprintMeta, { color: theme.colors.textSecondary }]}>
                                                    ×{file.edits}
                                                </Text>
                                            )}
                                        </View>
                                    ))}
                                    {data.files.length > MAX_FILES_VISIBLE && (
                                        <Pressable
                                            onPress={() => setShowAllFiles((prev) => !prev)}
                                            hitSlop={6}
                                            style={styles.expandButton}
                                        >
                                            <Text style={[styles.expandText, { color: theme.colors.textLink }]}>
                                                {showAllFiles
                                                    ? t("session.progressCollapse")
                                                    : t("session.progressShowAll", {
                                                        n: data.files.length - MAX_FILES_VISIBLE,
                                                    })}
                                            </Text>
                                        </Pressable>
                                    )}
                                </View>
                            )}

                            {data.commands.length > 0 && (
                                <View style={styles.subSection}>
                                    <Text style={[styles.subSectionTitle, { color: theme.colors.textSecondary }]}>
                                        {t("session.progressCommandsTitle", { n: data.commands.length })}
                                    </Text>
                                    {visibleCommands.map((cmd) => (
                                        <View key={cmd.command} style={styles.footprintRow}>
                                            <Ionicons
                                                name="terminal-outline"
                                                size={12}
                                                color={theme.colors.textSecondary}
                                                style={styles.footprintIcon}
                                            />
                                            <Text
                                                style={[styles.footprintCommand, { color: theme.colors.text }]}
                                                numberOfLines={1}
                                            >
                                                {truncateMiddle(cmd.command, 60)}
                                            </Text>
                                            {cmd.count > 1 && (
                                                <Text style={[styles.footprintMeta, { color: theme.colors.textSecondary }]}>
                                                    ×{cmd.count}
                                                </Text>
                                            )}
                                        </View>
                                    ))}
                                    {data.commands.length > MAX_COMMANDS_VISIBLE && (
                                        <Pressable
                                            onPress={() => setShowAllCommands((prev) => !prev)}
                                            hitSlop={6}
                                            style={styles.expandButton}
                                        >
                                            <Text style={[styles.expandText, { color: theme.colors.textLink }]}>
                                                {showAllCommands
                                                    ? t("session.progressCollapse")
                                                    : t("session.progressShowAll", {
                                                        n: data.commands.length - MAX_COMMANDS_VISIBLE,
                                                    })}
                                            </Text>
                                        </Pressable>
                                    )}
                                </View>
                            )}
                        </>
                    ) : (
                        <View style={styles.emptyBlock}>
                            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                                {t("session.progressFootprintEmpty")}
                            </Text>
                        </View>
                    )}
                </View>
            </ScrollView>
        );
    },
);

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
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabRow}
        >
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
                        <Text
                            style={[styles.tabChipText, { color }]}
                            numberOfLines={1}
                        >
                            {tab.label}
                        </Text>
                        <Text style={[styles.tabChipCount, { color }]}>
                            {`${tab.completed}/${tab.total}`}
                        </Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
});

interface SummaryCardProps {
    summary:
        | {
              goal: string;
              currentFocus?: string;
              keyDecisions?: string[];
              openQuestions?: string[];
              impactScope?: string[];
              updatedAt: number;
          }
        | undefined;
    onRefresh: () => void;
    nowMs: number;
}

const SummaryCard = React.memo<SummaryCardProps>(function SummaryCard({
    summary,
    onRefresh,
    nowMs,
}) {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const hasDetails = !!summary && (
        (summary.keyDecisions && summary.keyDecisions.length > 0) ||
        (summary.openQuestions && summary.openQuestions.length > 0) ||
        (summary.impactScope && summary.impactScope.length > 0)
    );

    return (
        <View style={[styles.summaryCard, { backgroundColor: theme.colors.surfaceHigh, borderColor: theme.colors.divider }]}>
            <View style={styles.summaryHeader}>
                <Ionicons name="book-outline" size={14} color={theme.colors.primary} />
                <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                    {t("session.progressSummarySection")}
                </Text>
                {summary && (
                    <Text style={[styles.timeHint, { color: theme.colors.textSecondary }]}>
                        {formatRelativeTime(summary.updatedAt, nowMs)}
                    </Text>
                )}
                <Pressable
                    onPress={onRefresh}
                    hitSlop={8}
                    style={[styles.refreshButton, { borderColor: theme.colors.textLink + "55" }]}
                    accessibilityRole="button"
                    accessibilityLabel={t("session.progressSummaryRefreshLabel")}
                >
                    <Ionicons
                        name="refresh-outline"
                        size={12}
                        color={theme.colors.textLink}
                        style={styles.refreshIcon}
                    />
                    <Text style={[styles.refreshText, { color: theme.colors.textLink }]}>
                        {t("session.progressSummaryRefreshLabel")}
                    </Text>
                </Pressable>
            </View>
            {summary ? (
                <View style={styles.summaryBody}>
                    <SummaryLine label={t("session.progressSummaryGoal")} value={summary.goal} />
                    {summary.currentFocus && (
                        <SummaryLine
                            label={t("session.progressSummaryCurrentFocus")}
                            value={summary.currentFocus}
                        />
                    )}
                    {hasDetails && (
                        <Pressable onPress={() => setExpanded((prev) => !prev)} hitSlop={6} style={styles.expandButton}>
                            <Text style={[styles.expandText, { color: theme.colors.textLink }]}>
                                {expanded
                                    ? t("session.progressSummaryCollapse")
                                    : t("session.progressSummaryExpand", {
                                        decisions: summary.keyDecisions?.length ?? 0,
                                        questions: summary.openQuestions?.length ?? 0,
                                        scopes: summary.impactScope?.length ?? 0,
                                    })}
                            </Text>
                        </Pressable>
                    )}
                    {expanded && summary.keyDecisions && summary.keyDecisions.length > 0 && (
                        <SummaryBulletList
                            title={t("session.progressSummaryDecisions")}
                            items={summary.keyDecisions}
                        />
                    )}
                    {expanded && summary.openQuestions && summary.openQuestions.length > 0 && (
                        <SummaryBulletList
                            title={t("session.progressSummaryOpenQuestions")}
                            items={summary.openQuestions}
                        />
                    )}
                    {expanded && summary.impactScope && summary.impactScope.length > 0 && (
                        <SummaryBulletList
                            title={t("session.progressSummaryImpactScope")}
                            items={summary.impactScope}
                        />
                    )}
                </View>
            ) : (
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary, textAlign: "left" }]}>
                    {t("session.progressSummaryEmpty")}
                </Text>
            )}
        </View>
    );
});

interface SummaryLineProps {
    label: string;
    value: string;
}
const SummaryLine = React.memo<SummaryLineProps>(function SummaryLine({ label, value }) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.summaryLineRow}>
            <Text style={[styles.summaryLabel, { color: theme.colors.textSecondary }]}>
                {label}
            </Text>
            <Text style={[styles.summaryValue, { color: theme.colors.text }]}>{value}</Text>
        </View>
    );
});

interface SummaryBulletListProps {
    title: string;
    items: readonly string[];
}
const SummaryBulletList = React.memo<SummaryBulletListProps>(function SummaryBulletList({
    title,
    items,
}) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.summaryBulletBlock}>
            <Text style={[styles.subSectionTitle, { color: theme.colors.textSecondary }]}>
                {title}
            </Text>
            {items.map((item, i) => (
                <Text
                    key={`${i}-${item}`}
                    style={[styles.summaryBulletItem, { color: theme.colors.text }]}
                >
                    {`• ${item}`}
                </Text>
            ))}
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

interface StatPillProps {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
}
const StatPill = React.memo<StatPillProps>(({ icon, label }) => {
    const { theme } = useUnistyles();
    return (
        <View style={[styles.statPill, { backgroundColor: theme.colors.surfaceHighest }]}>
            <Ionicons name={icon} size={12} color={theme.colors.textSecondary} />
            <Text style={[styles.statPillText, { color: theme.colors.textSecondary }]}>
                {label}
            </Text>
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
    sourceBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        borderWidth: 1,
    },
    refreshButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 6,
        borderWidth: 1,
    },
    refreshIcon: {
        marginRight: 0,
    },
    refreshText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
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
    tabRow: {
        flexDirection: "row",
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
        maxWidth: 200,
    },
    tabChipText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        maxWidth: 140,
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
    statRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
    },
    statPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
    },
    statPillText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
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
    footprintRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 2,
    },
    footprintIcon: {
        marginRight: 0,
    },
    footprintPath: {
        ...Typography.mono("regular"),
        fontSize: 11,
        flex: 1,
    },
    footprintCommand: {
        ...Typography.mono("regular"),
        fontSize: 11,
        flex: 1,
    },
    footprintMeta: {
        ...Typography.default("regular"),
        fontSize: 10,
    },
    expandButton: {
        paddingVertical: 4,
    },
    expandText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    summaryCard: {
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        gap: 8,
    },
    summaryHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    summaryBody: {
        gap: 4,
    },
    summaryLineRow: {
        gap: 2,
    },
    summaryLabel: {
        ...Typography.default("semiBold"),
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.4,
    },
    summaryValue: {
        ...Typography.default("regular"),
        fontSize: 13,
        lineHeight: 18,
    },
    summaryBulletBlock: {
        gap: 2,
        marginTop: 4,
    },
    summaryBulletItem: {
        ...Typography.default("regular"),
        fontSize: 12,
        lineHeight: 16,
    },
});
