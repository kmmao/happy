/**
 * WorkflowSessionRow — single render path for "a Session inside a
 * Workflow row". Used in two places:
 *
 *   1. Ad-hoc Workflow main row (the workflow IS a session, so the
 *      header row is just this component with no kind-icon clutter).
 *   2. Inside a multi-session Workflow's expanded body, as the leaf
 *      under the tree rail (Scheduled / Event / Loop children).
 *
 * Restores the full content set the deleted SessionsList.SessionItem
 * used to render — feedback was that the simplified leaf hid too much:
 *
 *   - Avatar with auto-send glow + draft icon overlay + unread dot
 *   - Title + star toggle + relative timestamp
 *   - Optional Issue row (PR link)
 *   - Live status / subtitle (path or "Reasoning… 1.2k tokens")
 *   - Status dot + status text + token usage
 *   - Latest user request preview (autoSend highlight)
 *   - Full tag row: scope (branch/main), provider+model, text badges
 *     (machine, branch name), user tags, autoSend badge
 *
 * Long-press opens an action menu (delete / reactivate / promote to
 * recurring for ad-hoc). Tap navigates to the conversation.
 *
 * Visual variant:
 *   - mode="standalone": rendered as its own card with rounded corners
 *     (ad-hoc workflow main row).
 *   - mode="treeChild": flat, no margins, sits under the tree rail.
 */

import React from "react";
import {
    View,
    Pressable,
    Linking,
} from "react-native";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import {
    useHasUnreadMessages,
    useMachine,
    useSessionTerminalTitle,
    useSessionTerminalStatus,
    storage,
} from "@/sync/storage";
import {
    getSessionName,
    useSessionStatus,
    getSessionSubtitle,
    getSessionAvatarId,
    formatLastSeen,
    getSessionProviderKey,
    isSessionRunning,
    formatTerminalLiveStatus,
} from "@/utils/sessionUtils";
import { Avatar } from "@/components/Avatar";
import { StatusDot } from "@/components/StatusDot";
import { formatTokenCountShort } from "@/utils/formatUsage";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { useHappyAction } from "@/hooks/useHappyAction";
import { sessionDelete, archiveSessionWithKill } from "@/sync/ops";
import { HappyError } from "@/utils/errors";
import { Modal } from "@/modal";
import { useAutoOptionSendEnabled } from "@/hooks/useAutoOptionSendEnabled";
import { useIssueSessionBySessionId } from "@/sync/issueSessionStore";
import {
    ISSUE_STATUS_COLORS,
    ISSUE_STATUS_LABELS,
} from "@/constants/issueStatusColors";
import { SessionProviderTag } from "@/components/session/SessionProviderTag";
import {
    resolveProjectSessionScopeTone,
    resolveProjectSessionTextBadges,
} from "@/components/project/projectSessionBadges";
import { useWebHoverProps } from "@/utils/interactiveSurface";
import { resolveSessionReactivationContext } from "@/hooks/sessionResumeSupport";
import { reactivateArchivedSession } from "@/sync/sessionResumeFlow";
import { runWithSessionReactivationGuard } from "@/sync/sessionResumeGuard";
import { buildSessionRespawnProfile } from "@/hooks/sessionUpgradeProfile";
import { t } from "@/text";
import type { Session } from "@/sync/storageTypes";

interface WorkflowSessionRowProps {
    session: Session;
    /**
     * "standalone": ad-hoc workflow main row — has its own card chrome.
     * "treeChild": inside a multi-session workflow's tree — sits flat.
     */
    mode?: "standalone" | "treeChild";
    /**
     * Optional extra menu entries appended to the long-press menu (e.g.
     * "Make this recurring" for ad-hoc workflows).
     */
    extraMenuActions?: Array<{
        label: string;
        onPress: () => void;
        style?: "default" | "destructive";
    }>;
}

const styles = StyleSheet.create((theme) => ({
    // standalone variant — has own card padding/background
    rowStandalone: {
        flexDirection: "column",
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: theme.colors.surface,
    },
    // treeChild variant — flat (parent provides background)
    rowTreeChild: {
        flexDirection: "column",
        paddingHorizontal: 6,
        paddingVertical: 10,
        marginHorizontal: -6,
        borderRadius: 8,
    },
    rowHovered: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    rowPressed: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    topRow: {
        flexDirection: "row",
        alignItems: "flex-start",
    },
    avatarContainer: {
        position: "relative",
        width: 44,
        height: 44,
    },
    avatarContainerSmall: {
        position: "relative",
        width: 32,
        height: 32,
    },
    draftIconContainer: {
        position: "absolute",
        bottom: -2,
        right: -2,
        width: 18,
        height: 18,
        alignItems: "center",
        justifyContent: "center",
    },
    draftIconOverlay: {
        color: theme.colors.textSecondary,
    },
    content: {
        flex: 1,
        marginLeft: 12,
        minWidth: 0,
        gap: 8,
    },
    contentTree: {
        flex: 1,
        marginLeft: 10,
        minWidth: 0,
        gap: 6,
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    title: {
        fontSize: 15,
        fontWeight: "500",
        flex: 1,
        ...Typography.default("semiBold"),
    },
    titleTree: {
        fontSize: 14,
        flex: 1,
        ...Typography.default("semiBold"),
    },
    titleConnected: {
        color: theme.colors.text,
    },
    titleDisconnected: {
        color: theme.colors.textSecondary,
    },
    starButton: {
        padding: 2,
        alignItems: "center",
        justifyContent: "center",
    },
    timestamp: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    subtitle: {
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    requestPreview: {
        fontSize: 11,
        lineHeight: 14,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    requestPreviewAuto: {
        color: theme.colors.accentPurple,
        textShadowColor: `${theme.colors.accentPurple}66`,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 8,
    },
    statusRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    statusLeft: {
        flexDirection: "row",
        alignItems: "center",
    },
    statusDotContainer: {
        alignItems: "center",
        justifyContent: "center",
        height: 16,
        marginRight: 6,
    },
    statusText: {
        fontSize: 11,
        fontWeight: "500",
        lineHeight: 14,
        ...Typography.default(),
    },
    usageText: {
        fontSize: 10,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    issueRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginBottom: 3,
    },
    issueNumber: {
        fontSize: 11,
        ...Typography.default("semiBold"),
    },
    issueTitle: {
        fontSize: 11,
        ...Typography.default(),
        flex: 1,
    },
    issueStatusDot: {
        width: 5,
        height: 5,
        borderRadius: 2.5,
    },
    issueStatusText: {
        fontSize: 10,
        ...Typography.default("semiBold"),
    },
    issuePrIcon: {
        marginLeft: 2,
        color: theme.colors.accentBlue,
    },
    tagsRow: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
    },
    tag: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: theme.colors.groupped.background,
        maxWidth: "100%",
    },
    tagText: {
        fontSize: 10,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        flexShrink: 1,
    },
    tagBranch: {
        backgroundColor: `${theme.colors.accentPurple}1F`,
    },
    tagBranchText: {
        color: theme.colors.accentPurple,
        ...Typography.default("semiBold"),
    },
    tagMain: {
        backgroundColor: `${theme.colors.success}1F`,
    },
    tagMainText: {
        color: theme.colors.success,
        ...Typography.default("semiBold"),
    },
    autoSendBadge: {
        backgroundColor: `${theme.colors.accentPurple}1F`,
    },
    autoSendBadgeText: {
        color: theme.colors.accentPurple,
        ...Typography.default("semiBold"),
    },
    branchNameTag: {
        backgroundColor: theme.colors.surfaceHighest,
    },
    branchNameTagText: {
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
}));

export const WorkflowSessionRow = React.memo(function WorkflowSessionRow({
    session,
    mode = "standalone",
    extraMenuActions,
}: WorkflowSessionRowProps) {
    const { theme } = useUnistyles();
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const terminalTitle = useSessionTerminalTitle(session.id);
    const terminalStatus = useSessionTerminalStatus(session.id);
    const liveStatus = isSessionRunning(session)
        ? formatTerminalLiveStatus(terminalStatus)
        : null;
    const sessionSubtitle = getSessionSubtitle(session, liveStatus ?? terminalTitle);
    const pickerWaiting =
        isSessionRunning(session) && terminalStatus?.pickerPending === true;

    const navigateToSession = useNavigateToSession();
    const issueLink = useIssueSessionBySessionId(session.id);
    const isAutoOptionSend = useAutoOptionSendEnabled(session.id);

    const machine = useMachine(session.metadata?.machineId ?? "");
    const reactivationContext = resolveSessionReactivationContext(session, machine);
    const reactivationMode = reactivationContext?.mode;
    const canReactivate = reactivationContext !== null;

    const avatarId = React.useMemo(() => getSessionAvatarId(session), [session]);
    const hasUnreadMessages = useHasUnreadMessages(session.id);
    const latestRequestPreview = session.latestUserRequestPreview;
    const scopeTone = React.useMemo(
        () => resolveProjectSessionScopeTone(session),
        [session],
    );
    const textBadges = React.useMemo(
        () =>
            resolveProjectSessionTextBadges({
                session,
                machineLabel: machine?.metadata?.displayName ?? null,
            }),
        [machine?.metadata?.displayName, session],
    );

    const { isHovered, hoverProps } = useWebHoverProps();

    const [deletingSession, performDelete] = useHappyAction(async () => {
        const result = await sessionDelete(session.id);
        if (!result.success) {
            throw new HappyError(
                result.message || t("sessionInfo.failedToDeleteSession"),
                false,
            );
        }
        storage.getState().deleteSession(session.id);
    });

    const [archivingSession, performArchive] = useHappyAction(async () => {
        const result = await archiveSessionWithKill(session.id);
        if (!result.success) {
            throw new HappyError(
                result.message || t("sessionInfo.failedToArchiveSession"),
                false,
            );
        }
        storage.getState().applySessions([{ ...session, active: false }]);
    });

    const [reactivatingSession, performReactivation] = useHappyAction(async () => {
        if (!reactivationContext) {
            throw new HappyError(t("machine.failedToStartSession"), false);
        }
        await runWithSessionReactivationGuard(session.id, async () => {
            const spawnProfile = buildSessionRespawnProfile(
                session,
                storage.getState().settings.profiles ?? [],
            );
            const createResumeRequest = (
                directory?: string,
                approvedNewDirectoryCreation: boolean = false,
            ) => {
                if (reactivationContext.mode !== "resume") {
                    throw new HappyError(t("machine.failedToStartSession"), false);
                }
                return {
                    ...reactivationContext.resumeContext!.baseSpawnOptions,
                    directory:
                        directory ?? reactivationContext.resumeContext!.baseSpawnOptions.directory,
                    approvedNewDirectoryCreation,
                    ...spawnProfile,
                };
            };
            await reactivateArchivedSession({
                sessionId: session.id,
                mode: reactivationContext.mode,
                onSuccess: () => navigateToSession(session.id),
                requestDirectoryApproval: (directory) =>
                    Modal.confirm(
                        t("machine.createDirectoryTitle"),
                        t("machine.createDirectoryMessage", { directory }),
                        { cancelText: t("common.cancel"), confirmText: t("common.create") },
                    ),
                createError: (message) => new HappyError(message, false),
                getStartSessionFallbackMessage: () =>
                    reactivationContext.mode === "unarchive"
                        ? t("sessionInfo.failedToUnarchiveSession")
                        : t("machine.failedToStartSession"),
                createResumeRequest,
            });
        });
    });

    const handleDelete = React.useCallback(() => {
        if (issueLink && (issueLink.status === "processing" || issueLink.prUrl)) {
            Modal.alert("", t("issues.cannotArchiveProcessing"));
            return;
        }
        Modal.alert(
            t("sessionInfo.deleteSession"),
            t("sessionInfo.deleteSessionWarning"),
            [
                { text: t("common.cancel"), style: "cancel" },
                {
                    text: t("sessionInfo.deleteSession"),
                    style: "destructive",
                    onPress: performDelete,
                },
            ],
        );
    }, [performDelete, issueLink]);

    const handleArchive = React.useCallback(() => {
        if (issueLink && (issueLink.status === "processing" || issueLink.prUrl)) {
            Modal.alert("", t("issues.cannotArchiveProcessing"));
            return;
        }
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
    }, [performArchive, issueLink]);

    const handleLongPress = React.useCallback(() => {
        // Action menu instead of swipe — works on all platforms and is
        // discoverable. The exact set of actions depends on reactivation
        // eligibility, archived state, and any extras the caller wants
        // (e.g. "Make this recurring" for ad-hoc workflows).
        const buttons: Array<{
            text: string;
            style?: "cancel" | "destructive" | "default";
            onPress?: () => void;
        }> = [{ text: t("common.cancel"), style: "cancel" }];

        if (canReactivate) {
            buttons.push({
                text: reactivationMode === "resume"
                    ? t("sessionInfo.resumeSession")
                    : t("sessionInfo.unarchiveSession"),
                onPress: performReactivation,
            });
        }
        extraMenuActions?.forEach((action) => {
            buttons.push({
                text: action.label,
                style: action.style === "destructive" ? "destructive" : "default",
                onPress: action.onPress,
            });
        });
        // Active (non-archived) sessions get an Archive entry — parity with
        // the ActiveSessionsGroup swipe menu so ad-hoc workflow rows can
        // be archived without navigating into the session info page.
        if (session.active) {
            buttons.push({
                text: t("sessionInfo.archiveSession"),
                style: "destructive",
                onPress: handleArchive,
            });
        }
        buttons.push({
            text: t("sessionInfo.deleteSession"),
            style: "destructive",
            onPress: handleDelete,
        });

        Modal.alert(sessionName, undefined, buttons);
    }, [sessionName, canReactivate, reactivationMode, performReactivation, extraMenuActions, handleDelete, handleArchive, session.active]);

    const isBusy = deletingSession || reactivatingSession || archivingSession;
    const isTree = mode === "treeChild";
    const avatarSize = isTree ? 32 : 44;

    return (
        <Pressable
            {...hoverProps}
            onPress={() => navigateToSession(session.id)}
            onLongPress={handleLongPress}
            disabled={isBusy}
            style={({ pressed }) => [
                isTree ? styles.rowTreeChild : styles.rowStandalone,
                isHovered && styles.rowHovered,
                pressed && styles.rowPressed,
            ]}
        >
            <View style={styles.topRow}>
                <View style={isTree ? styles.avatarContainerSmall : styles.avatarContainer}>
                    <Avatar
                        id={avatarId}
                        size={avatarSize}
                        monochrome={!sessionStatus.isConnected}
                        flavor={session.metadata?.flavor}
                        provider={getSessionProviderKey(session)}
                        hasUnreadMessages={hasUnreadMessages}
                        glowColor={isAutoOptionSend ? theme.colors.accentPurple : null}
                    />
                    {session.draft && (
                        <View style={styles.draftIconContainer}>
                            <Ionicons
                                name="create-outline"
                                size={12}
                                style={styles.draftIconOverlay}
                            />
                        </View>
                    )}
                </View>
                <View style={isTree ? styles.contentTree : styles.content}>
                    {/* Title line */}
                    <View style={styles.titleRow}>
                        <Text
                            style={[
                                isTree ? styles.titleTree : styles.title,
                                sessionStatus.isConnected
                                    ? styles.titleConnected
                                    : styles.titleDisconnected,
                            ]}
                            numberOfLines={2}
                        >
                            {sessionName}
                        </Text>
                        <Pressable
                            onPress={(e) => {
                                e.stopPropagation();
                                storage.getState().updateSessionStarred(session.id, !session.starred);
                            }}
                            hitSlop={8}
                            style={styles.starButton}
                        >
                            <Ionicons
                                name={session.starred ? "star" : "star-outline"}
                                size={14}
                                color={
                                    session.starred
                                        ? theme.colors.warning
                                        : theme.colors.textSecondary
                                }
                            />
                        </Pressable>
                        <Text style={styles.timestamp}>
                            {formatLastSeen(session.updatedAt ?? 0, false)}
                        </Text>
                    </View>

                    {/* Issue info line */}
                    {issueLink && (() => {
                        const statusColor = ISSUE_STATUS_COLORS[issueLink.status].text;
                        const prUrl = issueLink.prUrl ?? session.metadata?.worktree?.prUrl;
                        return (
                            <View style={styles.issueRow}>
                                <Ionicons name="pricetag-outline" size={11} color={statusColor} />
                                <Text style={[styles.issueNumber, { color: statusColor }]}>
                                    #{issueLink.issueNumber}
                                </Text>
                                <Text
                                    style={[styles.issueTitle, { color: statusColor }]}
                                    numberOfLines={1}
                                >
                                    {issueLink.issueTitle}
                                </Text>
                                <View
                                    style={[styles.issueStatusDot, { backgroundColor: statusColor }]}
                                />
                                <Text style={[styles.issueStatusText, { color: statusColor }]}>
                                    {ISSUE_STATUS_LABELS[issueLink.status]()}
                                </Text>
                                {prUrl ? (
                                    <Pressable
                                        style={styles.issuePrIcon}
                                        onPress={(e) => {
                                            e.stopPropagation();
                                            Linking.openURL(prUrl);
                                        }}
                                        hitSlop={8}
                                    >
                                        <Ionicons
                                            name="git-pull-request-outline"
                                            size={12}
                                            color={styles.issuePrIcon.color}
                                        />
                                    </Pressable>
                                ) : null}
                            </View>
                        );
                    })()}

                    {/* Subtitle (path / live status) */}
                    <Text
                        style={[
                            styles.subtitle,
                            pickerWaiting && { color: theme.colors.warning },
                        ]}
                        numberOfLines={1}
                    >
                        {sessionSubtitle}
                    </Text>

                    {/* Status + token usage */}
                    <View style={styles.statusRow}>
                        <View style={styles.statusLeft}>
                            <View style={styles.statusDotContainer}>
                                <StatusDot
                                    color={sessionStatus.statusDotColor}
                                    isPulsing={sessionStatus.isPulsing}
                                />
                            </View>
                            <Text style={[styles.statusText, { color: sessionStatus.statusColor }]}>
                                {sessionStatus.statusText}
                            </Text>
                        </View>
                        {session.latestUsage ? (
                            <Text style={styles.usageText}>
                                {formatTokenCountShort(
                                    session.latestUsage.totalInputTokens +
                                        session.latestUsage.totalOutputTokens,
                                )}
                            </Text>
                        ) : null}
                    </View>
                    {latestRequestPreview ? (
                        <Text
                            style={[
                                styles.requestPreview,
                                latestRequestPreview.isAutoOptionSend && styles.requestPreviewAuto,
                            ]}
                            numberOfLines={1}
                        >
                            {latestRequestPreview.text}
                        </Text>
                    ) : null}
                </View>
            </View>

            {/* Tags line — full width at bottom. Rendered for both
                standalone and treeChild modes so a session inside a
                multi-session workflow shows the same identity badges
                (scope, provider+model, branch, machine, user tags,
                auto-send) the user sees on its ad-hoc cousin. */}
            <View style={[styles.tagsRow, { marginTop: isTree ? 6 : 8 }]}>
                <View
                    style={[
                        styles.tag,
                        scopeTone === "branch" ? styles.tagBranch : styles.tagMain,
                    ]}
                >
                    <Text
                        style={[
                            styles.tagText,
                            scopeTone === "branch"
                                ? styles.tagBranchText
                                : styles.tagMainText,
                        ]}
                    >
                        {scopeTone === "branch"
                            ? t("sessionInfo.tagBranch")
                            : t("sessionInfo.tagMain")}
                    </Text>
                </View>
                <SessionProviderTag session={session} includeModel />
                {textBadges.map((badge) => (
                    <View
                        key={`${session.id}-${badge.kind}-${badge.value}`}
                        style={[
                            styles.tag,
                            badge.kind === "branchName" && styles.branchNameTag,
                        ]}
                    >
                        {badge.kind === "branchName" ? (
                            <Ionicons
                                name="git-branch-outline"
                                size={11}
                                color={theme.colors.text}
                            />
                        ) : null}
                        <Text
                            style={[
                                styles.tagText,
                                badge.kind === "branchName" && styles.branchNameTagText,
                            ]}
                            numberOfLines={1}
                        >
                            {badge.value}
                        </Text>
                    </View>
                ))}
                {session.metadata?.tags?.map((tag) => (
                    <View
                        key={`${session.id}-user-tag-${tag}`}
                        style={[
                            styles.tag,
                            { backgroundColor: `${theme.colors.accentBlue}1A` },
                        ]}
                    >
                        <Text
                            style={[styles.tagText, { color: theme.colors.accentBlue }]}
                            numberOfLines={1}
                        >
                            {tag}
                        </Text>
                    </View>
                ))}
                {isAutoOptionSend && (
                    <View style={[styles.tag, styles.autoSendBadge]}>
                        <Ionicons
                            name="sparkles"
                            size={10}
                            color={styles.autoSendBadgeText.color}
                            style={{ marginRight: 2 }}
                        />
                        <Text style={[styles.tagText, styles.autoSendBadgeText]}>
                            {t("session.autoOptionSendLabel")}
                        </Text>
                    </View>
                )}
            </View>
        </Pressable>
    );
});
