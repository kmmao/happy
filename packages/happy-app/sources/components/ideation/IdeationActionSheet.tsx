import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal } from "@/modal";
import { hapticsLight } from "@/components/haptics";
import { ideationStore } from "@/sync/ideationStore";
import {
    IDEATION_STATUSES,
    IDEATION_STATUS_LABELS,
    type IdeationIdea,
    type IdeationStatus,
} from "@/sync/ideationTypes";

interface IdeationActionSheetProps {
    idea: IdeationIdea;
    onClose: () => void;
}

const STATUS_ICONS: Record<IdeationStatus, string> = {
    draft: "document-outline",
    active: "flash-outline",
    converted: "checkmark-circle-outline",
    dismissed: "close-circle-outline",
};

export const IdeationActionSheet = React.memo(
    ({ idea, onClose }: IdeationActionSheetProps) => {
        const { theme } = useUnistyles();
        const insets = useSafeAreaInsets();
        const router = useRouter();

        const handleChangeStatus = React.useCallback(
            async (status: IdeationStatus) => {
                hapticsLight();
                onClose();
                const current = ideationStore.getState().ideas[idea.id];
                if (!current) return;
                await ideationStore.getState().saveIdea({
                    ...current,
                    status,
                    updatedAt: Date.now(),
                });
            },
            [idea.id, onClose],
        );

        const handleConvert = React.useCallback(async () => {
            onClose();
            const confirmed = await Modal.confirm(
                t("ideation.convertConfirmTitle"),
                t("ideation.convertConfirmMessage"),
            );
            if (confirmed) {
                const taskId = await ideationStore
                    .getState()
                    .convertToTask(idea.id);
                router.push(`/kanban/task/${taskId}`);
            }
        }, [idea.id, onClose, router]);

        const handleDelete = React.useCallback(async () => {
            onClose();
            const confirmed = await Modal.confirm(
                t("ideation.deleteConfirmTitle"),
                t("ideation.deleteConfirmMessage"),
                { destructive: true },
            );
            if (confirmed) {
                await ideationStore.getState().deleteIdea(idea.id);
            }
        }, [idea.id, onClose]);

        const otherStatuses = IDEATION_STATUSES.filter(
            (s) => s !== idea.status && s !== "converted",
        );

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
                    {/* Title */}
                    <Text
                        style={[
                            styles.sheetTitle,
                            { color: theme.colors.text },
                        ]}
                        numberOfLines={1}
                    >
                        {idea.title}
                    </Text>

                    {/* Change Status section */}
                    <Text
                        style={[
                            styles.sectionLabel,
                            { color: theme.colors.textSecondary },
                        ]}
                    >
                        {t("ideation.actions.changeStatus")}
                    </Text>

                    {otherStatuses.map((status) => (
                        <Pressable
                            key={status}
                            onPress={() => handleChangeStatus(status)}
                            style={({ pressed }) => [
                                styles.actionItem,
                                pressed && { opacity: 0.6 },
                            ]}
                        >
                            <Ionicons
                                name={
                                    STATUS_ICONS[
                                        status
                                    ] as keyof typeof Ionicons.glyphMap
                                }
                                size={18}
                                color={theme.colors.text}
                            />
                            <Text
                                style={[
                                    styles.actionText,
                                    { color: theme.colors.text },
                                ]}
                            >
                                {t(IDEATION_STATUS_LABELS[status])}
                            </Text>
                        </Pressable>
                    ))}

                    {/* Divider */}
                    <View
                        style={[
                            styles.divider,
                            { backgroundColor: theme.colors.divider },
                        ]}
                    />

                    {/* Convert to Task */}
                    {idea.status !== "converted" && (
                        <Pressable
                            onPress={handleConvert}
                            style={({ pressed }) => [
                                styles.actionItem,
                                pressed && { opacity: 0.6 },
                            ]}
                        >
                            <Ionicons
                                name="arrow-forward-circle-outline"
                                size={18}
                                color={theme.colors.header.tint}
                            />
                            <Text
                                style={[
                                    styles.actionText,
                                    { color: theme.colors.header.tint },
                                ]}
                            >
                                {t("ideation.convertToTask")}
                            </Text>
                        </Pressable>
                    )}

                    {/* View Task (if converted) */}
                    {idea.convertedTaskId && (
                        <Pressable
                            onPress={() => {
                                onClose();
                                router.push(
                                    `/kanban/task/${idea.convertedTaskId}`,
                                );
                            }}
                            style={({ pressed }) => [
                                styles.actionItem,
                                pressed && { opacity: 0.6 },
                            ]}
                        >
                            <Ionicons
                                name="open-outline"
                                size={18}
                                color={theme.colors.header.tint}
                            />
                            <Text
                                style={[
                                    styles.actionText,
                                    { color: theme.colors.header.tint },
                                ]}
                            >
                                {t("ideation.viewTask")}
                            </Text>
                        </Pressable>
                    )}

                    {/* Delete */}
                    <Pressable
                        onPress={handleDelete}
                        style={({ pressed }) => [
                            styles.actionItem,
                            pressed && { opacity: 0.6 },
                        ]}
                    >
                        <Ionicons
                            name="trash-outline"
                            size={18}
                            color={theme.colors.deleteAction}
                        />
                        <Text
                            style={[
                                styles.actionText,
                                { color: theme.colors.deleteAction },
                            ]}
                        >
                            {t("common.delete")}
                        </Text>
                    </Pressable>

                    {/* Cancel */}
                    <View
                        style={[
                            styles.divider,
                            { backgroundColor: theme.colors.divider },
                        ]}
                    />
                    <Pressable
                        onPress={onClose}
                        style={({ pressed }) => [
                            styles.cancelItem,
                            pressed && { opacity: 0.6 },
                        ]}
                    >
                        <Text
                            style={[
                                styles.cancelText,
                                { color: theme.colors.header.tint },
                            ]}
                        >
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    },
);

const styles = StyleSheet.create(() => ({
    overlay: {
        width: "100%",
        maxWidth: 400,
    },
    sheet: {
        borderRadius: 14,
        overflow: "hidden",
        paddingTop: 16,
    },
    sheetTitle: {
        fontSize: 15,
        textAlign: "center",
        paddingHorizontal: 16,
        paddingBottom: 12,
        ...Typography.default("semiBold"),
    },
    sectionLabel: {
        fontSize: 11,
        textTransform: "uppercase",
        paddingHorizontal: 16,
        paddingVertical: 6,
        ...Typography.default("semiBold"),
    },
    actionItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 10,
    },
    actionText: {
        fontSize: 15,
        ...Typography.default(),
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
    cancelText: {
        fontSize: 16,
        ...Typography.default("semiBold"),
    },
}));
