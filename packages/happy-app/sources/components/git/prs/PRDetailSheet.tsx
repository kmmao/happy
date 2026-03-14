import * as React from "react";
import {
    View,
    Pressable,
    ScrollView,
    Linking,
    ActivityIndicator,
    ActionSheetIOS,
    Alert,
    Platform,
} from "react-native";
import { Ionicons, Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "@/text";
import { Modal } from "@/modal";
import { useHappyAction } from "@/hooks/useHappyAction";
import { prStore } from "@/sync/prStore";
import { fetchPRFiles, fetchPRReviews, fetchPRComments, fetchPRChecks } from "@/sync/prFetch";
import type { AggregatedPR, PRFileDiff, PRReview, PRComment, CheckRun, MergeMethod, CheckStatus, ReviewState } from "@/sync/prTypes";
import { PRFileItem } from "./PRFileItem";

interface PRDetailSheetProps {
    readonly pr: AggregatedPR;
    readonly sessionId: string;
    readonly repoPath?: string;
    readonly onClose: () => void;
}

const STATE_ICON: Record<string, React.ComponentProps<typeof Octicons>["name"]> = {
    open: "git-pull-request",
    closed: "git-pull-request-closed",
    merged: "git-merge",
};

function checkStatusColor(status: CheckStatus, colors: { success: string; deleteAction: string; textSecondary: string }): string {
    if (status === "success") return colors.success;
    if (status === "failure" || status === "error") return colors.deleteAction;
    return colors.textSecondary;
}

function reviewStateColor(state: ReviewState, colors: { success: string; deleteAction: string; textSecondary: string }): string {
    if (state === "approved") return colors.success;
    if (state === "changes_requested") return colors.deleteAction;
    return colors.textSecondary;
}

export const PRDetailSheet = React.memo<PRDetailSheetProps>(
    function PRDetailSheet({ pr, sessionId, repoPath, onClose }) {
        const { theme } = useUnistyles();
        const insets = useSafeAreaInsets();
        const [prState, setPRState] = React.useState(pr.state);
        const [files, setFiles] = React.useState<readonly PRFileDiff[]>([]);
        const [filesLoading, setFilesLoading] = React.useState(false);
        const [filesLoaded, setFilesLoaded] = React.useState(false);
        const [showFiles, setShowFiles] = React.useState(false);

        const [checks, setChecks] = React.useState<readonly CheckRun[]>([]);
        const [checksLoading, setChecksLoading] = React.useState(false);
        const [checksLoaded, setChecksLoaded] = React.useState(false);
        const [showChecks, setShowChecks] = React.useState(false);

        const [reviews, setReviews] = React.useState<readonly PRReview[]>([]);
        const [reviewsLoading, setReviewsLoading] = React.useState(false);
        const [reviewsLoaded, setReviewsLoaded] = React.useState(false);
        const [showReviews, setShowReviews] = React.useState(false);

        const [comments, setComments] = React.useState<readonly PRComment[]>([]);
        const [commentsLoading, setCommentsLoading] = React.useState(false);
        const [commentsLoaded, setCommentsLoaded] = React.useState(false);
        const [showComments, setShowComments] = React.useState(false);

        const isOpen = prState === "open";
        const isMerged = prState === "merged";

        const stateColor = isOpen
            ? theme.colors.success
            : isMerged
              ? "#8957e5"
              : theme.colors.textSecondary;

        const handleOpenInBrowser = React.useCallback(() => {
            if (pr.url) {
                Linking.openURL(pr.url);
            }
        }, [pr.url]);

        // Load changed files
        const handleToggleFiles = React.useCallback(async () => {
            if (filesLoading) return;
            if (showFiles) {
                setShowFiles(false);
                return;
            }
            if (!filesLoaded) {
                setFilesLoading(true);
                try {
                    const repoInfo =
                        prStore.getState().repoInfoByProject[pr.projectKey];
                    if (repoInfo && repoInfo.provider !== "unknown") {
                        const result = await fetchPRFiles(
                            sessionId,
                            repoInfo,
                            pr.number,
                            repoPath,
                        );
                        setFiles(result.files);
                    }
                    setFilesLoaded(true);
                } catch (err) {
                    Modal.toast(err instanceof Error ? err.message : t("prs.loadFailed"));
                } finally {
                    setFilesLoading(false);
                }
            }
            setShowFiles(true);
        }, [filesLoading, showFiles, filesLoaded, sessionId, pr.projectKey, pr.number, repoPath]);

        const getRepoInfo = React.useCallback(() => {
            const repoInfo = prStore.getState().repoInfoByProject[pr.projectKey];
            return repoInfo && repoInfo.provider !== "unknown" ? repoInfo : null;
        }, [pr.projectKey]);

        // Load CI checks
        const handleToggleChecks = React.useCallback(async () => {
            if (checksLoading) return;
            if (showChecks) {
                setShowChecks(false);
                return;
            }
            if (!checksLoaded) {
                setChecksLoading(true);
                try {
                    const repoInfo = getRepoInfo();
                    if (repoInfo) {
                        const result = await fetchPRChecks(sessionId, repoInfo, pr.number, repoPath);
                        setChecks(result);
                    }
                    setChecksLoaded(true);
                } catch (err) {
                    Modal.toast(err instanceof Error ? err.message : t("prs.loadFailed"));
                } finally {
                    setChecksLoading(false);
                }
            }
            setShowChecks(true);
        }, [checksLoading, showChecks, checksLoaded, sessionId, pr.number, repoPath, getRepoInfo]);

        // Load reviews
        const handleToggleReviews = React.useCallback(async () => {
            if (reviewsLoading) return;
            if (showReviews) {
                setShowReviews(false);
                return;
            }
            if (!reviewsLoaded) {
                setReviewsLoading(true);
                try {
                    const repoInfo = getRepoInfo();
                    if (repoInfo) {
                        const result = await fetchPRReviews(sessionId, repoInfo, pr.number, repoPath);
                        setReviews(result);
                    }
                    setReviewsLoaded(true);
                } catch (err) {
                    Modal.toast(err instanceof Error ? err.message : t("prs.loadFailed"));
                } finally {
                    setReviewsLoading(false);
                }
            }
            setShowReviews(true);
        }, [reviewsLoading, showReviews, reviewsLoaded, sessionId, pr.number, repoPath, getRepoInfo]);

        // Load comments
        const handleToggleComments = React.useCallback(async () => {
            if (commentsLoading) return;
            if (showComments) {
                setShowComments(false);
                return;
            }
            if (!commentsLoaded) {
                setCommentsLoading(true);
                try {
                    const repoInfo = getRepoInfo();
                    if (repoInfo) {
                        const result = await fetchPRComments(sessionId, repoInfo, pr.number, repoPath);
                        setComments(result);
                    }
                    setCommentsLoaded(true);
                } catch (err) {
                    Modal.toast(err instanceof Error ? err.message : t("prs.loadFailed"));
                } finally {
                    setCommentsLoading(false);
                }
            }
            setShowComments(true);
        }, [commentsLoading, showComments, commentsLoaded, sessionId, pr.number, repoPath, getRepoInfo]);

        // Merge PR
        const [mergeLoading, doMerge] = useHappyAction(
            React.useCallback(async () => {
                const methods: { label: string; method: MergeMethod }[] = [
                    { label: t("prs.mergeCommit"), method: "merge" },
                    { label: t("prs.squashMerge"), method: "squash" },
                    { label: t("prs.rebaseMerge"), method: "rebase" },
                ];

                const pickMethod = (): Promise<MergeMethod | null> =>
                    new Promise((resolve) => {
                        const cancelLabel = t("common.cancel");
                        if (Platform.OS === "ios") {
                            ActionSheetIOS.showActionSheetWithOptions(
                                {
                                    title: t("prs.chooseMergeMethod"),
                                    options: [
                                        ...methods.map((m) => m.label),
                                        cancelLabel,
                                    ],
                                    cancelButtonIndex: methods.length,
                                },
                                (index) => {
                                    if (index < methods.length) {
                                        resolve(methods[index]!.method);
                                    } else {
                                        resolve(null);
                                    }
                                },
                            );
                        } else {
                            Alert.alert(t("prs.chooseMergeMethod"), undefined, [
                                ...methods.map((m) => ({
                                    text: m.label,
                                    onPress: () => resolve(m.method),
                                })),
                                {
                                    text: cancelLabel,
                                    style: "cancel" as const,
                                    onPress: () => resolve(null),
                                },
                            ]);
                        }
                    });

                const method = await pickMethod();
                if (!method) return;

                await prStore
                    .getState()
                    .mergePR(
                        pr.projectKey,
                        pr.number,
                        method,
                        sessionId,
                        undefined,
                        repoPath,
                    );
                setPRState("merged");
            }, [pr.projectKey, pr.number, sessionId, repoPath]),
        );

        // Approve PR
        const [approveLoading, doApprove] = useHappyAction(
            React.useCallback(async () => {
                await prStore
                    .getState()
                    .submitReview(
                        pr.projectKey,
                        pr.number,
                        "APPROVE",
                        sessionId,
                        undefined,
                        repoPath,
                    );
                Modal.toast(t("prs.approved"));
            }, [pr.projectKey, pr.number, sessionId, repoPath]),
        );

        // Close PR
        const [closeLoading, doClose] = useHappyAction(
            React.useCallback(async () => {
                await prStore
                    .getState()
                    .closePR(pr.projectKey, pr.number, sessionId, repoPath);
                setPRState("closed");
            }, [pr.projectKey, pr.number, sessionId, repoPath]),
        );

        // Add Comment
        const [commentLoading, doAddComment] = useHappyAction(
            React.useCallback(async () => {
                const body = await Modal.prompt(t("prs.addComment"), "", {
                    placeholder: t("prs.commentPlaceholder"),
                });
                if (!body || body.trim() === "") return;
                await prStore
                    .getState()
                    .addComment(
                        pr.projectKey,
                        pr.number,
                        body.trim(),
                        sessionId,
                        repoPath,
                    );
            }, [pr.projectKey, pr.number, sessionId, repoPath]),
        );

        const formattedDate =
            pr.createdAt > 0
                ? new Date(pr.createdAt).toLocaleDateString()
                : "";

        return (
            <View style={styles.overlay}>
                <View
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: theme.colors.surface,
                            paddingBottom: Math.max(insets.bottom, 16),
                        },
                    ]}
                >
                    {/* Header: state icon + number + state badge */}
                    <View style={styles.header}>
                        <Octicons
                            name={STATE_ICON[prState] ?? "git-pull-request"}
                            size={18}
                            color={stateColor}
                        />
                        <Text
                            style={{
                                fontSize: 13,
                                color: theme.colors.textSecondary,
                                ...Typography.mono(),
                            }}
                        >
                            #{pr.number}
                        </Text>
                        <View
                            style={[
                                styles.stateBadge,
                                { backgroundColor: stateColor + "20" },
                            ]}
                        >
                            <Text
                                style={{
                                    fontSize: 11,
                                    fontWeight: "600",
                                    color: stateColor,
                                    ...Typography.default(),
                                }}
                            >
                                {isMerged
                                    ? t("prs.merged")
                                    : isOpen
                                      ? t("prs.open")
                                      : t("prs.closed")}
                            </Text>
                        </View>
                        {pr.draft && (
                            <View
                                style={[
                                    styles.stateBadge,
                                    {
                                        backgroundColor:
                                            theme.colors.textSecondary + "20",
                                    },
                                ]}
                            >
                                <Text
                                    style={{
                                        fontSize: 11,
                                        fontWeight: "600",
                                        color: theme.colors.textSecondary,
                                        ...Typography.default(),
                                    }}
                                >
                                    {t("prs.draft")}
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Title */}
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        {pr.title}
                    </Text>

                    {/* Branch info */}
                    <Text
                        style={{
                            fontSize: 12,
                            color: theme.colors.textSecondary,
                            paddingHorizontal: 16,
                            marginBottom: 4,
                            ...Typography.mono(),
                        }}
                        numberOfLines={1}
                    >
                        {pr.headBranch} → {pr.baseBranch}
                    </Text>

                    {/* Meta row: author + date + changes */}
                    <View style={styles.metaRow}>
                        <Text
                            style={{
                                fontSize: 13,
                                color: theme.colors.textSecondary,
                                ...Typography.default(),
                            }}
                        >
                            {pr.author}
                            {formattedDate !== "" && ` · ${formattedDate}`}
                        </Text>
                        <View style={{ flexDirection: "row", gap: 6 }}>
                            {pr.additions > 0 && (
                                <Text
                                    style={{
                                        fontSize: 12,
                                        fontWeight: "500",
                                        color: theme.colors.success,
                                        ...Typography.mono(),
                                    }}
                                >
                                    +{pr.additions}
                                </Text>
                            )}
                            {pr.deletions > 0 && (
                                <Text
                                    style={{
                                        fontSize: 12,
                                        fontWeight: "500",
                                        color: theme.colors.deleteAction,
                                        ...Typography.mono(),
                                    }}
                                >
                                    -{pr.deletions}
                                </Text>
                            )}
                            {pr.changedFiles > 0 && (
                                <Text
                                    style={{
                                        fontSize: 12,
                                        color: theme.colors.textSecondary,
                                        ...Typography.mono(),
                                    }}
                                >
                                    {pr.changedFiles} {t("prs.files")}
                                </Text>
                            )}
                        </View>
                    </View>

                    {/* CI + Review status badges */}
                    {(pr.checksStatus || pr.reviewDecision) && (
                        <View style={styles.badgeRow}>
                            {pr.checksStatus && (
                                <View
                                    style={[
                                        styles.statusBadge,
                                        {
                                            backgroundColor:
                                                checkStatusColor(pr.checksStatus, theme.colors) + "20",
                                        },
                                    ]}
                                >
                                    <Octicons
                                        name={
                                            pr.checksStatus === "success"
                                                ? "check"
                                                : pr.checksStatus ===
                                                        "failure" ||
                                                    pr.checksStatus === "error"
                                                  ? "x"
                                                  : "clock"
                                        }
                                        size={12}
                                        color={checkStatusColor(pr.checksStatus, theme.colors)}
                                    />
                                    <Text
                                        style={{
                                            fontSize: 12,
                                            fontWeight: "600",
                                            color: checkStatusColor(pr.checksStatus, theme.colors),
                                            ...Typography.default(),
                                        }}
                                    >
                                        CI: {t(`prs.ci_${pr.checksStatus}`)}
                                    </Text>
                                </View>
                            )}
                            {pr.reviewDecision && (
                                <View
                                    style={[
                                        styles.statusBadge,
                                        {
                                            backgroundColor:
                                                reviewStateColor(pr.reviewDecision, theme.colors) + "20",
                                        },
                                    ]}
                                >
                                    <Text
                                        style={{
                                            fontSize: 12,
                                            fontWeight: "600",
                                            color: reviewStateColor(pr.reviewDecision, theme.colors),
                                            ...Typography.default(),
                                        }}
                                    >
                                        {t(
                                            `prs.review_${pr.reviewDecision}`,
                                        )}
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Body */}
                    <View
                        style={[
                            styles.bodyContainer,
                            { backgroundColor: theme.colors.surfaceHigh },
                        ]}
                    >
                        {pr.body !== "" ? (
                            <ScrollView
                                style={styles.bodyScroll}
                                contentContainerStyle={styles.bodyContent}
                            >
                                <Text
                                    style={{
                                        fontSize: 14,
                                        color: theme.colors.text,
                                        lineHeight: 20,
                                        ...Typography.default(),
                                    }}
                                >
                                    {pr.body}
                                </Text>
                            </ScrollView>
                        ) : (
                            <Text
                                style={{
                                    fontSize: 13,
                                    color: theme.colors.textSecondary,
                                    fontStyle: "italic",
                                    textAlign: "center",
                                    paddingVertical: 12,
                                    ...Typography.default(),
                                }}
                            >
                                {t("prs.noBody")}
                            </Text>
                        )}
                    </View>

                    {/* Changed files section */}
                    <Pressable
                        onPress={handleToggleFiles}
                        style={styles.filesToggle}
                    >
                        <Ionicons
                            name={
                                showFiles
                                    ? "chevron-down"
                                    : "chevron-forward"
                            }
                            size={16}
                            color={theme.colors.textLink}
                        />
                        <Octicons
                            name="diff"
                            size={16}
                            color={theme.colors.textLink}
                        />
                        <Text
                            style={{
                                fontSize: 14,
                                fontWeight: "600",
                                color: theme.colors.textLink,
                                ...Typography.default(),
                            }}
                        >
                            {t("prs.viewChanges")} ({pr.changedFiles})
                        </Text>
                        {filesLoading && (
                            <ActivityIndicator
                                size="small"
                                color={theme.colors.textLink}
                            />
                        )}
                    </Pressable>

                    {showFiles && files.length > 0 && (
                        <ScrollView
                            style={styles.filesScroll}
                            nestedScrollEnabled
                        >
                            {files.map((file) => (
                                <PRFileItem key={file.filename} file={file} />
                            ))}
                        </ScrollView>
                    )}

                    {/* CI Checks section */}
                    <Pressable
                        onPress={handleToggleChecks}
                        style={styles.filesToggle}
                    >
                        <Ionicons
                            name={showChecks ? "chevron-down" : "chevron-forward"}
                            size={16}
                            color={theme.colors.textLink}
                        />
                        <Octicons name="check-circle" size={16} color={theme.colors.textLink} />
                        <Text
                            style={{
                                fontSize: 14,
                                fontWeight: "600",
                                color: theme.colors.textLink,
                                ...Typography.default(),
                            }}
                        >
                            {t("prs.ciChecks")}
                        </Text>
                        {checksLoading && (
                            <ActivityIndicator size="small" color={theme.colors.textLink} />
                        )}
                    </Pressable>

                    {showChecks && checks.length > 0 && (
                        <View style={styles.detailSection}>
                            {checks.map((check, i) => (
                                <Pressable
                                    key={`${check.name}-${i}`}
                                    onPress={() => check.url ? Linking.openURL(check.url) : undefined}
                                    style={styles.checkItem}
                                >
                                    <Octicons
                                        name={
                                            check.status === "success" ? "check-circle" :
                                            check.status === "failure" || check.status === "error" ? "x-circle" :
                                            "clock"
                                        }
                                        size={14}
                                        color={checkStatusColor(check.status, theme.colors)}
                                    />
                                    <Text
                                        style={{
                                            fontSize: 13,
                                            color: theme.colors.text,
                                            flex: 1,
                                            ...Typography.default(),
                                        }}
                                        numberOfLines={1}
                                    >
                                        {check.name}
                                    </Text>
                                    <Text
                                        style={{
                                            fontSize: 12,
                                            color: checkStatusColor(check.status, theme.colors),
                                            ...Typography.default(),
                                        }}
                                    >
                                        {t(`prs.ci_${check.status}`)}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                    )}

                    {showChecks && checks.length === 0 && !checksLoading && (
                        <Text style={[styles.emptyHint, { color: theme.colors.textSecondary }]}>
                            {t("prs.noChecks")}
                        </Text>
                    )}

                    {/* Reviews section */}
                    <Pressable
                        onPress={handleToggleReviews}
                        style={styles.filesToggle}
                    >
                        <Ionicons
                            name={showReviews ? "chevron-down" : "chevron-forward"}
                            size={16}
                            color={theme.colors.textLink}
                        />
                        <Octicons name="code-review" size={16} color={theme.colors.textLink} />
                        <Text
                            style={{
                                fontSize: 14,
                                fontWeight: "600",
                                color: theme.colors.textLink,
                                ...Typography.default(),
                            }}
                        >
                            {t("prs.reviews")}
                        </Text>
                        {reviewsLoading && (
                            <ActivityIndicator size="small" color={theme.colors.textLink} />
                        )}
                    </Pressable>

                    {showReviews && reviews.length > 0 && (
                        <View style={styles.detailSection}>
                            {reviews.map((review, i) => (
                                <View key={`${review.author}-${review.submittedAt}-${i}`} style={styles.reviewItem}>
                                    <View style={styles.reviewHeader}>
                                        <Text
                                            style={{
                                                fontSize: 13,
                                                fontWeight: "600",
                                                color: theme.colors.text,
                                                ...Typography.default(),
                                            }}
                                        >
                                            {review.author}
                                        </Text>
                                        <View
                                            style={[
                                                styles.reviewBadge,
                                                {
                                                    backgroundColor:
                                                        reviewStateColor(review.state, theme.colors) + "20",
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={{
                                                    fontSize: 11,
                                                    fontWeight: "600",
                                                    color: reviewStateColor(review.state, theme.colors),
                                                    ...Typography.default(),
                                                }}
                                            >
                                                {t(`prs.review_${review.state}`)}
                                            </Text>
                                        </View>
                                        <Text
                                            style={{
                                                fontSize: 11,
                                                color: theme.colors.textSecondary,
                                                ...Typography.default(),
                                            }}
                                        >
                                            {review.submittedAt > 0
                                                ? new Date(review.submittedAt).toLocaleDateString()
                                                : ""}
                                        </Text>
                                    </View>
                                    {review.body !== "" && (
                                        <Text
                                            style={{
                                                fontSize: 13,
                                                color: theme.colors.text,
                                                marginTop: 4,
                                                lineHeight: 18,
                                                ...Typography.default(),
                                            }}
                                            numberOfLines={4}
                                        >
                                            {review.body}
                                        </Text>
                                    )}
                                </View>
                            ))}
                        </View>
                    )}

                    {showReviews && reviews.length === 0 && !reviewsLoading && (
                        <Text style={[styles.emptyHint, { color: theme.colors.textSecondary }]}>
                            {t("prs.noReviews")}
                        </Text>
                    )}

                    {/* Comments section */}
                    <Pressable
                        onPress={handleToggleComments}
                        style={styles.filesToggle}
                    >
                        <Ionicons
                            name={showComments ? "chevron-down" : "chevron-forward"}
                            size={16}
                            color={theme.colors.textLink}
                        />
                        <Octicons name="comment-discussion" size={16} color={theme.colors.textLink} />
                        <Text
                            style={{
                                fontSize: 14,
                                fontWeight: "600",
                                color: theme.colors.textLink,
                                ...Typography.default(),
                            }}
                        >
                            {t("prs.comments")} ({pr.commentCount})
                        </Text>
                        {commentsLoading && (
                            <ActivityIndicator size="small" color={theme.colors.textLink} />
                        )}
                    </Pressable>

                    {showComments && comments.length > 0 && (
                        <ScrollView style={styles.commentsScroll} nestedScrollEnabled>
                            {comments.map((comment) => (
                                <View key={comment.id} style={styles.commentItem}>
                                    <View style={styles.commentHeader}>
                                        <Text
                                            style={{
                                                fontSize: 13,
                                                fontWeight: "600",
                                                color: theme.colors.text,
                                                ...Typography.default(),
                                            }}
                                        >
                                            {comment.author}
                                        </Text>
                                        <Text
                                            style={{
                                                fontSize: 11,
                                                color: theme.colors.textSecondary,
                                                ...Typography.default(),
                                            }}
                                        >
                                            {comment.createdAt > 0
                                                ? new Date(comment.createdAt).toLocaleDateString()
                                                : ""}
                                        </Text>
                                    </View>
                                    <Text
                                        style={{
                                            fontSize: 13,
                                            color: theme.colors.text,
                                            marginTop: 4,
                                            lineHeight: 18,
                                            ...Typography.default(),
                                        }}
                                        numberOfLines={6}
                                    >
                                        {comment.body}
                                    </Text>
                                </View>
                            ))}
                        </ScrollView>
                    )}

                    {showComments && comments.length === 0 && !commentsLoading && (
                        <Text style={[styles.emptyHint, { color: theme.colors.textSecondary }]}>
                            {t("prs.noComments")}
                        </Text>
                    )}

                    {/* Actions */}
                    <View style={styles.actions}>
                        {/* Merge — only for open PRs */}
                        {isOpen && (
                            <Pressable
                                onPress={doMerge}
                                disabled={mergeLoading}
                                style={styles.actionItem}
                            >
                                {mergeLoading ? (
                                    <ActivityIndicator
                                        size={18}
                                        color="#8957e5"
                                    />
                                ) : (
                                    <Octicons
                                        name="git-merge"
                                        size={18}
                                        color="#8957e5"
                                    />
                                )}
                                <Text
                                    style={{
                                        fontSize: 15,
                                        fontWeight: "600",
                                        color: "#8957e5",
                                        ...Typography.default("semiBold"),
                                    }}
                                >
                                    {t("prs.merge")}
                                </Text>
                            </Pressable>
                        )}

                        {/* Approve — only for open PRs */}
                        {isOpen && (
                            <Pressable
                                onPress={doApprove}
                                disabled={approveLoading}
                                style={styles.actionItem}
                            >
                                {approveLoading ? (
                                    <ActivityIndicator
                                        size={18}
                                        color={theme.colors.success}
                                    />
                                ) : (
                                    <Octicons
                                        name="check"
                                        size={18}
                                        color={theme.colors.success}
                                    />
                                )}
                                <Text
                                    style={{
                                        fontSize: 15,
                                        color: theme.colors.success,
                                        ...Typography.default(),
                                    }}
                                >
                                    {t("prs.approve")}
                                </Text>
                            </Pressable>
                        )}

                        {/* Close — only for open PRs */}
                        {isOpen && (
                            <Pressable
                                onPress={doClose}
                                disabled={closeLoading}
                                style={styles.actionItem}
                            >
                                {closeLoading ? (
                                    <ActivityIndicator
                                        size={18}
                                        color={theme.colors.box.warning.text}
                                    />
                                ) : (
                                    <Octicons
                                        name="git-pull-request-closed"
                                        size={18}
                                        color={theme.colors.box.warning.text}
                                    />
                                )}
                                <Text
                                    style={{
                                        fontSize: 15,
                                        color: theme.colors.box.warning.text,
                                        ...Typography.default(),
                                    }}
                                >
                                    {t("prs.closePR")}
                                </Text>
                            </Pressable>
                        )}

                        {/* Add Comment */}
                        <Pressable
                            onPress={doAddComment}
                            disabled={commentLoading}
                            style={styles.actionItem}
                        >
                            {commentLoading ? (
                                <ActivityIndicator
                                    size={18}
                                    color={theme.colors.text}
                                />
                            ) : (
                                <Octicons
                                    name="comment-discussion"
                                    size={18}
                                    color={theme.colors.text}
                                />
                            )}
                            <Text
                                style={{
                                    fontSize: 15,
                                    color: theme.colors.text,
                                    ...Typography.default(),
                                }}
                            >
                                {t("prs.addComment")}
                            </Text>
                        </Pressable>

                        {/* Open in Browser */}
                        {pr.url !== "" && (
                            <Pressable
                                onPress={handleOpenInBrowser}
                                style={styles.actionItem}
                            >
                                <Ionicons
                                    name="open-outline"
                                    size={18}
                                    color={theme.colors.text}
                                />
                                <Text
                                    style={{
                                        fontSize: 15,
                                        color: theme.colors.text,
                                        ...Typography.default(),
                                    }}
                                >
                                    {t("prs.openInBrowser")}
                                </Text>
                            </Pressable>
                        )}
                    </View>

                    {/* Cancel */}
                    <View
                        style={[
                            styles.divider,
                            { backgroundColor: theme.colors.divider },
                        ]}
                    />
                    <Pressable onPress={onClose} style={styles.cancelItem}>
                        <Text
                            style={{
                                fontSize: 15,
                                fontWeight: "600",
                                color: theme.colors.header.tint,
                                ...Typography.default(),
                            }}
                        >
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    overlay: {
        width: "100%",
        maxWidth: 500,
        minWidth: 320,
    },
    sheet: {
        borderRadius: 14,
        overflow: "hidden",
        paddingTop: 16,
        minHeight: 400,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 16,
        marginBottom: 8,
    },
    stateBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    statusBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
    },
    title: {
        fontSize: 17,
        fontWeight: "600",
        paddingHorizontal: 16,
        marginBottom: 4,
        ...Typography.default("semiBold"),
    },
    metaRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        marginBottom: 8,
    },
    badgeRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        paddingHorizontal: 16,
        marginBottom: 8,
    },
    bodyContainer: {
        marginHorizontal: 16,
        marginBottom: 8,
        borderRadius: 8,
        minHeight: 40,
        justifyContent: "center",
    },
    bodyScroll: {
        maxHeight: 160,
    },
    bodyContent: {
        padding: 12,
    },
    filesToggle: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    filesScroll: {
        maxHeight: 300,
        marginHorizontal: 8,
        marginBottom: 8,
        borderRadius: 8,
    },
    detailSection: {
        marginHorizontal: 16,
        marginBottom: 8,
        gap: 1,
    },
    checkItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 8,
    },
    reviewItem: {
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    reviewHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    reviewBadge: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 8,
    },
    commentItem: {
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    commentHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    commentsScroll: {
        maxHeight: 250,
        marginHorizontal: 16,
        marginBottom: 8,
    },
    emptyHint: {
        fontSize: 13,
        fontStyle: "italic",
        textAlign: "center",
        paddingVertical: 8,
        paddingHorizontal: 16,
        ...Typography.default(),
    },
    actions: {
        gap: 0,
    },
    actionItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 10,
    },
    divider: {
        height: 0.5,
        marginHorizontal: 16,
        marginVertical: 4,
    },
    cancelItem: {
        alignItems: "center",
        paddingVertical: 14,
    },
}));
