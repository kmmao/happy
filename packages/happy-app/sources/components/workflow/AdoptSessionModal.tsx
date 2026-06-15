/**
 * AdoptSessionModal — Phase 2 / sessionAdopt UI for binding an existing
 * Session to an automation owner. Currently covers the `existing-loop`
 * variant — the most common case (the user has a manually-started Session
 * and wants it to count as the next iteration of an existing loop).
 *
 * `new-schedule` adoption is reachable through MakeRecurringModal which
 * was retro-fitted to call sessionAdopt under the hood. `new-loop` adoption
 * is a two-step flow today: create the loop via CreateLoopModal, then
 * attach this Session via "existing loops" here.
 *
 * UI conventions follow MakeRecurringModal.tsx: BottomSheet shell, sticky
 * footer with Cancel + Confirm, hand-rolled styles via unistyles.
 */

import * as React from "react";
import { View, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { Modal as AlertModal } from "@/modal";
import { BottomSheet, BottomSheetHandle } from "@/components/BottomSheet";
import { webInteractive } from "@/utils/interactiveSurface";
import { t } from "@/text";
import { useWorkflows, type Workflow } from "@/hooks/useWorkflows";
import { sessionAdopt } from "@/sync/apiSessionAdopt";
import type { Session } from "@/sync/storageTypes";
import { CreateLoopModal } from "./CreateLoopModal";

interface AdoptSessionModalProps {
    visible: boolean;
    onClose: () => void;
    session: Session;
}

const styles = StyleSheet.create((theme) => ({
    info: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        padding: 10,
        backgroundColor: `${theme.colors.accentBlue}14`,
        borderRadius: 8,
    },
    infoText: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.text,
        ...Typography.default(),
        lineHeight: 17,
    },
    sectionLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.1,
        ...Typography.default("semiBold"),
        marginBottom: 6,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        ...webInteractive,
    },
    rowActive: {
        borderColor: theme.colors.accentBlue,
        backgroundColor: `${theme.colors.accentBlue}10`,
    },
    rowKindBadge: {
        width: 30,
        height: 30,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    rowCenter: { flex: 1, minWidth: 0, gap: 2 },
    rowTitle: {
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    rowMeta: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    list: { gap: 8 },
    empty: {
        paddingVertical: 18,
        alignItems: "center",
        gap: 10,
    },
    emptyText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        textAlign: "center",
    },
    emptyCreateButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: `${theme.colors.accentBlue}14`,
        borderWidth: 1,
        borderColor: theme.colors.accentBlue,
        ...webInteractive,
    },
    emptyCreateButtonText: {
        fontSize: 13,
        color: theme.colors.accentBlue,
        ...Typography.default("semiBold"),
    },
    button: {
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderRadius: 10,
        minWidth: 88,
        alignItems: "center",
        justifyContent: "center",
        ...webInteractive,
    },
    buttonCancel: { backgroundColor: theme.colors.surfaceHigh },
    buttonPrimary: { backgroundColor: theme.colors.button.primary.background },
    buttonPrimaryDisabled: {
        backgroundColor: theme.colors.surfaceHigh,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    buttonText: { fontSize: 14, ...Typography.default("semiBold") },
    buttonTextPrimary: { color: theme.colors.button.primary.tint },
    buttonTextPrimaryDisabled: { color: theme.colors.textSecondary },
    buttonTextCancel: { color: theme.colors.textSecondary },
}));

// Same icon/color scheme as WorkflowList — keeps the picker visually
// consistent with the list the user just came from.
const KIND_ICON: Record<Workflow["kind"], React.ComponentProps<typeof Ionicons>["name"]> = {
    adhoc: "chatbubble-ellipses-outline",
    scheduled: "timer-outline",
    event: "flash-outline",
    loop: "repeat-outline",
};
const KIND_COLOR: Record<Workflow["kind"], string> = {
    adhoc: "#8E8E93",
    scheduled: "#34C759",
    event: "#0A84FF",
    loop: "#BF5AF2",
};

export const AdoptSessionModal = React.memo(function AdoptSessionModal({
    visible,
    onClose,
    session,
}: AdoptSessionModalProps) {
    const { theme } = useUnistyles();
    const sheetRef = React.useRef<BottomSheetHandle>(null);
    const { workflows } = useWorkflows();
    const [pickedLoopId, setPickedLoopId] = React.useState<string | null>(null);
    const [submitting, setSubmitting] = React.useState(false);
    // Empty-state fallback: when no loops exist yet, the user clicks
    // "Create one" to jump straight into CreateLoopModal in adopt mode
    // (new-loop atomic path). We close the picker first so two
    // BottomSheets don't fight for the screen on web/native.
    const [createLoopVisible, setCreateLoopVisible] = React.useState(false);

    React.useEffect(() => {
        if (!visible) return;
        setPickedLoopId(null);
        setSubmitting(false);
    }, [visible]);

    // Only loop workflows are valid existing-loop adoption targets. Scheduled
    // / Event workflows would need their own SessionAdoptTarget kinds (which
    // wire schema doesn't yet have — see sessionAdopt.ts).
    const candidates = React.useMemo(
        () => workflows.filter((w): w is Extract<Workflow, { kind: "loop" }> => w.kind === "loop"),
        [workflows],
    );

    const valid = pickedLoopId !== null;

    const handleConfirm = async () => {
        if (!valid || submitting) return;
        setSubmitting(true);
        try {
            const result = await sessionAdopt({
                sessionId: session.id,
                target: { kind: "existing-loop", loopId: pickedLoopId! },
            });
            if (!result.success) {
                throw new Error(result.errorMessage);
            }
            sheetRef.current?.requestClose();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            AlertModal.alert(t("workflows.adoptErrorTitle"), message);
            setSubmitting(false);
        }
    };

    const handleCreateNewLoop = () => {
        sheetRef.current?.requestClose();
        // Wait for the picker sheet's slide-out animation before mounting
        // CreateLoopModal so the two sheets don't overlap mid-transition.
        setTimeout(() => setCreateLoopVisible(true), 250);
    };

    return (
        <>
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            busy={submitting}
            title={t("workflows.adoptModalTitle")}
            subtitle={t("workflows.adoptModalSubtitle")}
            footer={
                <>
                    <Pressable
                        style={[styles.button, styles.buttonCancel]}
                        onPress={() => sheetRef.current?.requestClose()}
                        disabled={submitting}
                    >
                        <Text style={[styles.buttonText, styles.buttonTextCancel]}>
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                    <Pressable
                        style={[
                            styles.button,
                            valid && !submitting
                                ? styles.buttonPrimary
                                : styles.buttonPrimaryDisabled,
                        ]}
                        onPress={handleConfirm}
                        disabled={!valid || submitting}
                    >
                        {submitting ? (
                            <ActivityIndicator
                                size="small"
                                color={theme.colors.button.primary.tint}
                            />
                        ) : (
                            <Text style={[
                                styles.buttonText,
                                valid && !submitting
                                    ? styles.buttonTextPrimary
                                    : styles.buttonTextPrimaryDisabled,
                            ]}>
                                {t("workflows.adoptConfirm")}
                            </Text>
                        )}
                    </Pressable>
                </>
            }
        >
            <View style={styles.info}>
                <Ionicons
                    name="information-circle"
                    size={16}
                    color={theme.colors.accentBlue}
                />
                <Text style={styles.infoText}>{t("workflows.adoptModalInfo")}</Text>
            </View>

            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.adoptSectionExistingLoops")}
                </Text>
                {candidates.length === 0 ? (
                    <View style={styles.empty}>
                        <Text style={styles.emptyText}>{t("workflows.adoptEmptyLoops")}</Text>
                        <Pressable
                            style={styles.emptyCreateButton}
                            onPress={handleCreateNewLoop}
                        >
                            <Ionicons
                                name="add-circle-outline"
                                size={14}
                                color={theme.colors.accentBlue}
                            />
                            <Text style={styles.emptyCreateButtonText}>
                                {t("workflows.adoptEmptyCreateLink")}
                            </Text>
                        </Pressable>
                    </View>
                ) : (
                    <ScrollView style={{ maxHeight: 320 }}>
                        <View style={styles.list}>
                            {candidates.map((w) => {
                                const active = pickedLoopId === w.loop.id;
                                return (
                                    <Pressable
                                        key={w.id}
                                        style={[styles.row, active && styles.rowActive]}
                                        onPress={() => setPickedLoopId(w.loop.id)}
                                    >
                                        <View
                                            style={[
                                                styles.rowKindBadge,
                                                { backgroundColor: `${KIND_COLOR[w.kind]}18` },
                                            ]}
                                        >
                                            <Ionicons
                                                name={KIND_ICON[w.kind]}
                                                size={16}
                                                color={KIND_COLOR[w.kind]}
                                            />
                                        </View>
                                        <View style={styles.rowCenter}>
                                            <Text style={styles.rowTitle} numberOfLines={1}>
                                                {w.displayName}
                                            </Text>
                                            <Text style={styles.rowMeta} numberOfLines={1}>
                                                {w.loop.directory}
                                            </Text>
                                        </View>
                                        {active ? (
                                            <Ionicons
                                                name="checkmark-circle"
                                                size={20}
                                                color={theme.colors.accentBlue}
                                            />
                                        ) : null}
                                    </Pressable>
                                );
                            })}
                        </View>
                    </ScrollView>
                )}
            </View>
        </BottomSheet>
        {/* The "Create one" link in the empty state opens CreateLoopModal
            in adopt mode (new-loop kind). When it closes we don't reopen
            the picker — the new loop just becomes available on next
            adopt invocation. */}
        <CreateLoopModal
            session={session}
            visible={createLoopVisible}
            onClose={() => setCreateLoopVisible(false)}
        />
        </>
    );
});
