import * as React from "react";
import { View, TextInput, Pressable, Text } from "react-native";
import { Modal } from "@/modal";
import { useRouter, useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { useHappyAction } from "@/hooks/useHappyAction";
import { roadmapStore, useMilestone } from "@/sync/roadmapStore";
import { MILESTONE_STATUSES, type MilestoneStatus } from "@/sync/roadmapTypes";
import { MILESTONE_STATUS_LABELS as STATUS_LABELS } from "@/sync/roadmapLabels";
import { Ionicons } from "@expo/vector-icons";

function MilestoneDetailScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { id: milestoneId, projectId } = useLocalSearchParams<{
        id: string;
        projectId: string;
    }>();

    const milestone = useMilestone(projectId ?? "", milestoneId ?? "");

    const [title, setTitle] = React.useState(milestone?.title ?? "");
    const [description, setDescription] = React.useState(milestone?.description ?? "");
    const [status, setStatus] = React.useState<MilestoneStatus>(milestone?.status ?? "planning");

    React.useEffect(() => {
        if (milestone) {
            setTitle(milestone.title);
            setDescription(milestone.description);
            setStatus(milestone.status);
        }
    }, [milestone]);

    const hasChanges = milestone && (
        title !== milestone.title ||
        description !== milestone.description ||
        status !== milestone.status
    );

    const [saving, doSave] = useHappyAction(
        React.useCallback(async () => {
            if (!projectId || !milestoneId || !title.trim()) return;
            await roadmapStore.getState().updateMilestone(projectId, milestoneId, {
                title: title.trim(),
                description: description.trim(),
                status,
            });
            router.back();
        }, [projectId, milestoneId, title, description, status, router]),
    );

    const [deleting, doDelete] = useHappyAction(
        React.useCallback(async () => {
            if (!projectId || !milestoneId) return;
            await roadmapStore.getState().deleteMilestone(projectId, milestoneId);
            router.back();
        }, [projectId, milestoneId, router]),
    );

    const handleDelete = React.useCallback(() => {
        Modal.alert(
            t("roadmap.deleteMilestoneConfirmTitle"),
            t("roadmap.deleteMilestoneConfirmMessage"),
            [
                { text: t("common.cancel"), style: "cancel" },
                { text: t("common.delete"), style: "destructive", onPress: doDelete },
            ],
        );
    }, [doDelete]);

    if (!milestone) {
        return (
            <View style={styles.center}>
                <Text style={[styles.notFound, { color: theme.colors.textSecondary }]}>
                    {t("roadmap.milestoneNotFound")}
                </Text>
            </View>
        );
    }

    return (
        <ItemList>
            <ItemGroup title={t("roadmap.details")}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.titleInput, { color: theme.colors.text }]}
                        placeholder={t("roadmap.titlePlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={title}
                        onChangeText={setTitle}
                    />
                </View>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.descInput, { color: theme.colors.text }]}
                        placeholder={t("roadmap.descriptionPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={description}
                        onChangeText={setDescription}
                        multiline
                        numberOfLines={4}
                    />
                </View>
            </ItemGroup>

            <ItemGroup title={t("roadmap.statusLabel")}>
                {MILESTONE_STATUSES.map((s) => (
                    <Item
                        key={s}
                        title={STATUS_LABELS[s]()}
                        onPress={() => setStatus(s)}
                        rightElement={
                            status === s ? (
                                <Ionicons name="checkmark" size={18} color={theme.colors.header.tint} />
                            ) : undefined
                        }
                    />
                ))}
            </ItemGroup>

            <View style={styles.buttonContainer}>
                {hasChanges && (
                    <Pressable
                        style={[styles.saveButton, { backgroundColor: theme.colors.header.tint }]}
                        onPress={doSave}
                        disabled={saving || !title.trim()}
                    >
                        <Text style={styles.buttonText}>
                            {saving ? t("common.loading") : t("common.save")}
                        </Text>
                    </Pressable>
                )}
                <Pressable
                    style={[styles.deleteButton, { backgroundColor: theme.colors.deleteAction }]}
                    onPress={handleDelete}
                    disabled={deleting}
                >
                    <Text style={styles.buttonText}>
                        {deleting ? t("common.loading") : t("common.delete")}
                    </Text>
                </Pressable>
            </View>
        </ItemList>
    );
}

const styles = StyleSheet.create((theme) => ({
    center: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    notFound: {
        ...Typography.default(),
        fontSize: 15,
    },
    inputContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    titleInput: {
        ...Typography.default("semiBold"),
        fontSize: 17,
    },
    descInput: {
        ...Typography.default(),
        fontSize: 15,
        minHeight: 80,
        textAlignVertical: "top",
    },
    buttonContainer: {
        paddingHorizontal: 16,
        paddingTop: 16,
        gap: 12,
    },
    saveButton: {
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: "center",
    },
    deleteButton: {
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: "center",
    },
    buttonText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: theme.colors.button.primary.tint,
    },
}));

export default React.memo(MilestoneDetailScreen);
