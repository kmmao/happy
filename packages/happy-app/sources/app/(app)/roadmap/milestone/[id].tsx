import * as React from "react";
import {
    View,
    ScrollView,
    TextInput,
    Pressable,
    Text,
    ActivityIndicator,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Header } from "@/components/navigation/Header";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import {
    roadmapStore,
    useRoadmapMilestone,
    useRoadmapFeatures,
} from "@/sync/roadmapStore";
import {
    type RoadmapMilestone,
    featuresForMilestone,
} from "@/sync/roadmapTypes";
import { useHappyAction } from "@/hooks/useHappyAction";
import { Modal } from "@/modal";
import { Ionicons } from "@expo/vector-icons";
import { RoadmapProgressBar } from "@/components/roadmap/RoadmapProgressBar";
import { milestoneProgress } from "@/sync/roadmapTypes";

const MilestoneDetail = React.memo(() => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { id } = useLocalSearchParams<{ id: string }>();
    const insets = useSafeAreaInsets();
    const milestone = useRoadmapMilestone(id);
    const allFeatures = useRoadmapFeatures();

    // Form state
    const [title, setTitle] = React.useState("");
    const [description, setDescription] = React.useState("");

    // Hydrate form
    React.useEffect(() => {
        if (milestone) {
            setTitle(milestone.title);
            setDescription(milestone.description);
        }
    }, [milestone?.id]);

    const hasChanges = React.useMemo(() => {
        if (!milestone) return false;
        return (
            title !== milestone.title ||
            description !== milestone.description
        );
    }, [milestone, title, description]);

    const milestoneFeatures = React.useMemo(
        () => (milestone ? featuresForMilestone(allFeatures, milestone.id) : []),
        [allFeatures, milestone?.id],
    );

    const progress = React.useMemo(
        () =>
            milestone
                ? milestoneProgress(allFeatures, milestone.id)
                : { total: 0, completed: 0, percentage: 0 },
        [allFeatures, milestone?.id],
    );

    const [saving, performSave] = useHappyAction(async () => {
        if (!milestone || !title.trim()) return;

        const updated: RoadmapMilestone = {
            ...milestone,
            title: title.trim(),
            description: description.trim(),
        };

        await roadmapStore.getState().saveMilestone(updated);
        router.back();
    });

    const [deleting, performDelete] = useHappyAction(async () => {
        if (!milestone) return;

        Modal.alert(
            t("roadmap.deleteMilestoneConfirmTitle"),
            t("roadmap.deleteMilestoneConfirmMessage"),
            [
                { text: t("common.cancel"), style: "cancel" },
                {
                    text: t("common.delete"),
                    style: "destructive",
                    onPress: async () => {
                        await roadmapStore
                            .getState()
                            .deleteMilestone(milestone.id);
                        router.back();
                    },
                },
            ],
        );
    });

    if (!milestone) {
        return (
            <View
                style={[
                    styles.container,
                    {
                        backgroundColor:
                            theme.colors.groupped.background,
                    },
                ]}
            >
                <Header title={t("roadmap.milestoneNotFound")} />
                <View style={styles.centered}>
                    <ActivityIndicator
                        size="small"
                        color={theme.colors.textSecondary}
                    />
                </View>
            </View>
        );
    }

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: theme.colors.groupped.background },
            ]}
        >
            <Header
                title={t("roadmap.milestoneDetail")}
                headerRight={() => (
                    <Pressable
                        onPress={performSave}
                        disabled={
                            saving || !hasChanges || !title.trim()
                        }
                        hitSlop={15}
                    >
                        <Text
                            style={[
                                styles.saveButton,
                                {
                                    color:
                                        hasChanges && title.trim()
                                            ? theme.colors.header.tint
                                            : theme.colors
                                                  .textSecondary,
                                },
                            ]}
                        >
                            {t("common.save")}
                        </Text>
                    </Pressable>
                )}
            />
            <ScrollView
                contentContainerStyle={{
                    paddingBottom: insets.bottom + 24,
                }}
                keyboardDismissMode="on-drag"
            >
                {/* Title & Description */}
                <ItemGroup title={t("roadmap.details")}>
                    <View
                        style={[
                            styles.inputWrapper,
                            { backgroundColor: theme.colors.surface },
                        ]}
                    >
                        <TextInput
                            style={[
                                styles.titleInput,
                                { color: theme.colors.text },
                            ]}
                            placeholder={t("roadmap.titlePlaceholder")}
                            placeholderTextColor={
                                theme.colors.textSecondary
                            }
                            value={title}
                            onChangeText={setTitle}
                        />
                        <View
                            style={[
                                styles.divider,
                                {
                                    backgroundColor:
                                        theme.colors.divider,
                                },
                            ]}
                        />
                        <TextInput
                            style={[
                                styles.descriptionInput,
                                { color: theme.colors.text },
                            ]}
                            placeholder={t(
                                "roadmap.descriptionPlaceholder",
                            )}
                            placeholderTextColor={
                                theme.colors.textSecondary
                            }
                            value={description}
                            onChangeText={setDescription}
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                        />
                    </View>
                </ItemGroup>

                {/* Progress */}
                <ItemGroup title={t("roadmap.features")}>
                    <View
                        style={[
                            styles.progressWrapper,
                            { backgroundColor: theme.colors.surface },
                        ]}
                    >
                        <RoadmapProgressBar
                            completed={progress.completed}
                            total={progress.total}
                        />
                    </View>
                </ItemGroup>

                {/* Features list */}
                {milestoneFeatures.length > 0 && (
                    <ItemGroup>
                        {milestoneFeatures.map((f, idx) => (
                            <Item
                                key={f.id}
                                title={f.title}
                                onPress={() =>
                                    router.push(
                                        `/roadmap/feature/${f.id}`,
                                    )
                                }
                                showDivider={
                                    idx !==
                                    milestoneFeatures.length - 1
                                }
                            />
                        ))}
                    </ItemGroup>
                )}

                {/* Add Feature */}
                <ItemGroup>
                    <Item
                        title={t("roadmap.newFeature")}
                        icon={
                            <Ionicons
                                name="add-circle-outline"
                                size={22}
                                color={theme.colors.header.tint}
                            />
                        }
                        onPress={() =>
                            router.push(
                                `/roadmap/feature/new?milestoneId=${milestone.id}`,
                            )
                        }
                        showDivider
                    />
                    <Item
                        title={t("common.delete")}
                        onPress={performDelete}
                        loading={deleting}
                        destructive
                    />
                </ItemGroup>
            </ScrollView>
        </View>
    );
});

export default MilestoneDetail;

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
    },
    centered: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    saveButton: {
        fontSize: 17,
        ...Typography.default("semiBold"),
    },
    inputWrapper: {
        borderRadius: 10,
        overflow: "hidden",
    },
    titleInput: {
        fontSize: 17,
        paddingHorizontal: 16,
        paddingVertical: 12,
        ...Typography.default(),
    },
    divider: {
        height: 1,
        marginLeft: 16,
    },
    descriptionInput: {
        fontSize: 15,
        paddingHorizontal: 16,
        paddingVertical: 12,
        minHeight: 80,
        ...Typography.default(),
    },
    progressWrapper: {
        borderRadius: 10,
        padding: 14,
    },
}));
