/**
 * Bottom sheet that lets the user pick a *rewind point* — one of the previous
 * user messages in the source session — and duplicate (fork) the session
 * truncated at that message.
 *
 * Each row shows the user prompt text + a timestamp. Tapping a row fires the
 * fork RPC (via sessionForkFlow.forkSessionFromMessage), spawns a new Happy
 * session resumed from the truncated transcript, and navigates the user into
 * the new session.
 *
 * Gating: caller is responsible for showing this component only when the
 * `expResumeSession` experiment toggle is on. We don't gate here so the
 * component stays focused on the picker UX.
 *
 * Architecture notes:
 *   - Pulls messages from useSessionMessages (already cached / paginated).
 *   - Only user-text messages with a non-null `realId` are pickable — that
 *     id is the Claude JSONL message UUID the CLI's forkSession RPC expects
 *     as `upToMessageId`. Messages without a UUID (e.g. local-only
 *     optimistic inserts) render greyed out.
 *   - Source session's spawn profile is reused for the fork — same machine,
 *     same agent, same directory, same env. The CLI returns its own path
 *     because the forked JSONL lives next to the original.
 */

import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    Pressable,
    Modal,
    SafeAreaView,
    ActivityIndicator,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { useSessionMessages } from "@/sync/storage";
import type { Message, UserTextMessage } from "@/sync/typesMessage";
import type { Session } from "@/sync/storageTypes";
import type { SpawnSessionOptions } from "@/sync/ops";
import { forkSessionFromMessage } from "@/sync/sessionForkFlow";
import { useHappyAction } from "@/hooks/useHappyAction";

type Props = {
    readonly visible: boolean;
    readonly session: Session;
    readonly baseSpawnOptions: SpawnSessionOptions;
    readonly onClose: () => void;
    /** Called with the new Happy session id after a successful fork. */
    readonly onSuccess: (newSessionId: string) => void;
};

interface RewindPoint {
    message: UserTextMessage;
    canFork: boolean; // false when realId is missing (no anchor available)
}

function pickUserMessages(messages: Message[]): RewindPoint[] {
    const points: RewindPoint[] = [];
    for (const m of messages) {
        if (m.kind !== "user-text") continue;
        // Skip empty messages — they would result in zero-content forks.
        if (!m.text || m.text.trim().length === 0) continue;
        points.push({
            message: m,
            canFork: typeof m.realId === "string" && m.realId.length > 0,
        });
    }
    return points;
}

function formatPreview(text: string, max: number = 140): string {
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function formatTimestamp(createdAt: number): string {
    const date = new Date(createdAt);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function DuplicateSheet({ visible, session, baseSpawnOptions, onClose, onSuccess }: Props) {
    if (!visible) return null;
    return (
        <DuplicateSheetInner
            session={session}
            baseSpawnOptions={baseSpawnOptions}
            onClose={onClose}
            onSuccess={onSuccess}
        />
    );
}

function DuplicateSheetInner({
    session,
    baseSpawnOptions,
    onClose,
    onSuccess,
}: Omit<Props, "visible">) {
    const { theme } = useUnistyles();
    const { messages, isLoaded } = useSessionMessages(session.id);

    // User messages first → most recent at top, so users typing recently can
    // grab the latest prompt without scrolling.
    const rewindPoints = React.useMemo(() => {
        const list = pickUserMessages(messages);
        return list.reverse();
    }, [messages]);

    // Picked anchor lives in a ref so the wrapped thunk can be parameterized
    // without breaking useHappyAction's `() => Promise<void>` contract.
    const pendingAnchorRef = React.useRef<RewindPoint | null>(null);
    const [duplicating, runDuplicate] = useHappyAction(async () => {
        const anchor = pendingAnchorRef.current;
        if (!anchor) return;
        const realId = anchor.message.realId;
        if (!realId) {
            // UI gates non-forkable rows, but guard anyway in case the row
            // becomes pickable mid-flight.
            return;
        }
        const result = await forkSessionFromMessage({
            sourceSessionId: session.id,
            baseSpawnOptions,
            upToMessageId: realId,
        });
        if (result.type === "success") {
            onClose();
            onSuccess(result.sessionId);
            return;
        }
        if (result.type === "error") {
            throw new Error(result.errorMessage);
        }
        // requestToApproveDirectoryCreation — we don't ask the user inside
        // the sheet; surface as an error and let the caller deal with it
        // via the explicit fork-on-session-info path that has the modal
        // approval flow wired up.
        throw new Error(t("session.forkFailed"));
    });

    const duplicate = React.useCallback((anchor: RewindPoint) => {
        pendingAnchorRef.current = anchor;
        runDuplicate();
    }, [runDuplicate]);

    return (
        <Modal
            visible
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <SafeAreaView
                style={[styles.container, { backgroundColor: theme.colors.surface }]}
            >
                <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
                    <View style={styles.headerLeft}>
                        <Text style={[styles.title, { color: theme.colors.text }]}>
                            {t("session.duplicateTitle")}
                        </Text>
                        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                            {t("session.duplicateSubtitle")}
                        </Text>
                    </View>
                    <Pressable onPress={onClose} hitSlop={10}>
                        <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>

                {!isLoaded ? (
                    <View style={styles.centered}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : rewindPoints.length === 0 ? (
                    <View style={styles.centered}>
                        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                            {t("session.duplicateEmpty")}
                        </Text>
                    </View>
                ) : (
                    <ScrollView
                        style={styles.list}
                        contentContainerStyle={styles.listContent}
                    >
                        {rewindPoints.map((point) => (
                            <RewindRow
                                key={point.message.id}
                                point={point}
                                disabled={duplicating}
                                onPick={() => duplicate(point)}
                            />
                        ))}
                    </ScrollView>
                )}
            </SafeAreaView>
        </Modal>
    );
}

function RewindRow({
    point,
    disabled,
    onPick,
}: {
    point: RewindPoint;
    disabled: boolean;
    onPick: () => void;
}) {
    const { theme } = useUnistyles();
    const tappable = point.canFork && !disabled;
    return (
        <Pressable
            onPress={tappable ? onPick : undefined}
            disabled={!tappable}
            style={({ pressed }) => [
                styles.row,
                {
                    backgroundColor: pressed
                        ? theme.colors.surfaceHigh
                        : theme.colors.surface,
                    borderBottomColor: theme.colors.divider,
                    opacity: tappable ? 1 : 0.45,
                },
            ]}
        >
            <View style={styles.rowMain}>
                <Text
                    style={[styles.rowPreview, { color: theme.colors.text }]}
                    numberOfLines={3}
                >
                    {formatPreview(point.message.text)}
                </Text>
                <View style={styles.rowMeta}>
                    <Text style={[styles.rowTime, { color: theme.colors.textSecondary }]}>
                        {formatTimestamp(point.message.createdAt)}
                    </Text>
                    {!point.canFork && (
                        <Text style={[styles.rowHint, { color: theme.colors.textSecondary }]}>
                            {t("session.duplicateNoAnchor")}
                        </Text>
                    )}
                </View>
            </View>
            <Ionicons
                name="git-branch-outline"
                size={20}
                color={tappable ? theme.colors.accentBlue : theme.colors.textSecondary}
            />
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 12,
    },
    headerLeft: {
        flex: 1,
        gap: 4,
    },
    title: {
        fontSize: 17,
        fontWeight: "600",
    },
    subtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
    centered: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
    },
    emptyText: {
        fontSize: 14,
        textAlign: "center",
        lineHeight: 20,
    },
    list: {
        flex: 1,
    },
    listContent: {
        paddingBottom: 32,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowMain: {
        flex: 1,
        gap: 6,
    },
    rowPreview: {
        fontSize: 15,
        lineHeight: 20,
    },
    rowMeta: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    rowTime: {
        fontSize: 12,
    },
    rowHint: {
        fontSize: 12,
        fontStyle: "italic",
    },
}));
