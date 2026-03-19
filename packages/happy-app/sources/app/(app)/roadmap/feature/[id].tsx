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
import { roadmapStore, useFeature } from "@/sync/roadmapStore";
import {
    FEATURE_STATUSES,
    MOSCOW_PRIORITIES,
    FEATURE_COMPLEXITIES,
    type FeatureStatus,
    type MoscowPriority,
    type FeatureComplexity,
} from "@/sync/roadmapTypes";
import { COMPLEXITY_LABELS, MOSCOW_LABELS, FEATURE_STATUS_LABELS } from "@/sync/roadmapLabels";
import { MOSCOW_ICONS, MOSCOW_COLORS, COMPLEXITY_ICONS, COMPLEXITY_COLORS } from "@/sync/roadmapChipConfig";
import { ChipSelector, type ChipOption } from "@/components/ChipSelector";
import { Ionicons } from "@expo/vector-icons";

function FeatureDetailScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { id: featureId, projectId } = useLocalSearchParams<{
        id: string;
        projectId: string;
    }>();

    const feature = useFeature(projectId ?? "", featureId ?? "");

    const [title, setTitle] = React.useState(feature?.title ?? "");
    const [description, setDescription] = React.useState(feature?.description ?? "");
    const [status, setStatus] = React.useState<FeatureStatus>(feature?.status ?? "planned");
    const [moscow, setMoscow] = React.useState<MoscowPriority>(feature?.moscow ?? "should_have");
    const [complexity, setComplexity] = React.useState<FeatureComplexity>(feature?.complexity ?? "moderate");

    React.useEffect(() => {
        if (feature) {
            setTitle(feature.title);
            setDescription(feature.description);
            setStatus(feature.status);
            setMoscow(feature.moscow);
            setComplexity(feature.complexity);
        }
    }, [feature]);

    const moscowOptions = React.useMemo<readonly ChipOption<MoscowPriority>[]>(
        () =>
            MOSCOW_PRIORITIES.map((p) => ({
                value: p,
                label: MOSCOW_LABELS[p](),
                icon: MOSCOW_ICONS[p],
                color: MOSCOW_COLORS[p],
            })),
        [],
    );

    const complexityOptions = React.useMemo<readonly ChipOption<FeatureComplexity>[]>(
        () =>
            FEATURE_COMPLEXITIES.map((c) => ({
                value: c,
                label: COMPLEXITY_LABELS[c](),
                icon: COMPLEXITY_ICONS[c],
                color: COMPLEXITY_COLORS[c],
            })),
        [],
    );

    const handleMoscowToggle = React.useCallback((value: MoscowPriority) => {
        setMoscow(value);
    }, []);

    const handleComplexityToggle = React.useCallback((value: FeatureComplexity) => {
        setComplexity(value);
    }, []);

    const hasChanges = feature && (
        title !== feature.title ||
        description !== feature.description ||
        status !== feature.status ||
        moscow !== feature.moscow ||
        complexity !== feature.complexity
    );

    const [saving, doSave] = useHappyAction(
        React.useCallback(async () => {
            if (!projectId || !featureId || !title.trim()) return;
            await roadmapStore.getState().updateFeature(projectId, featureId, {
                title: title.trim(),
                description: description.trim(),
                status,
                moscow,
                complexity,
            });
            router.back();
        }, [projectId, featureId, title, description, status, moscow, complexity, router]),
    );

    const [deleting, doDelete] = useHappyAction(
        React.useCallback(async () => {
            if (!projectId || !featureId) return;
            await roadmapStore.getState().deleteFeature(projectId, featureId);
            router.back();
        }, [projectId, featureId, router]),
    );

    const handleDelete = React.useCallback(() => {
        Modal.alert(
            t("roadmap.deleteFeatureConfirmTitle"),
            t("roadmap.deleteFeatureConfirmMessage"),
            [
                { text: t("common.cancel"), style: "cancel" },
                { text: t("common.delete"), style: "destructive", onPress: doDelete },
            ],
        );
    }, [doDelete]);

    if (!feature) {
        return (
            <View style={styles.center}>
                <Text style={[styles.notFound, { color: theme.colors.textSecondary }]}>
                    {t("roadmap.featureNotFound")}
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
                {FEATURE_STATUSES.map((s) => (
                    <Item
                        key={s}
                        title={FEATURE_STATUS_LABELS[s]()}
                        onPress={() => setStatus(s)}
                        rightElement={
                            status === s ? (
                                <Ionicons name="checkmark" size={18} color={theme.colors.header.tint} />
                            ) : undefined
                        }
                    />
                ))}
            </ItemGroup>

            <ItemGroup title={t("roadmap.moscowLabel")}>
                <ChipSelector
                    options={moscowOptions}
                    selected={[moscow]}
                    onToggle={handleMoscowToggle}
                />
            </ItemGroup>

            <ItemGroup title={t("roadmap.complexityLabel")}>
                <ChipSelector
                    options={complexityOptions}
                    selected={[complexity]}
                    onToggle={handleComplexityToggle}
                />
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

export default React.memo(FeatureDetailScreen);
