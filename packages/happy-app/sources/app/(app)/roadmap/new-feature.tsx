import * as React from "react";
import { View, TextInput, Pressable, Text } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { useHappyAction } from "@/hooks/useHappyAction";
import { roadmapStore } from "@/sync/roadmapStore";
import { MOSCOW_PRIORITIES, FEATURE_COMPLEXITIES, type MoscowPriority, type FeatureComplexity } from "@/sync/roadmapTypes";
import { COMPLEXITY_LABELS, MOSCOW_LABELS } from "@/sync/roadmapLabels";
import { MOSCOW_ICONS, MOSCOW_COLORS, COMPLEXITY_ICONS, COMPLEXITY_COLORS } from "@/sync/roadmapChipConfig";
import { ChipSelector, type ChipOption } from "@/components/ChipSelector";

function NewFeatureScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { projectId, milestoneId } = useLocalSearchParams<{
        projectId: string;
        milestoneId: string;
    }>();

    const [title, setTitle] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [moscow, setMoscow] = React.useState<MoscowPriority>("should_have");
    const [complexity, setComplexity] = React.useState<FeatureComplexity>("moderate");

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

    const canSubmit = title.trim().length > 0;

    const [loading, doCreate] = useHappyAction(
        React.useCallback(async () => {
            if (!projectId || !milestoneId || !title.trim()) return;
            await roadmapStore.getState().createFeature(projectId, {
                milestoneId,
                title: title.trim(),
                description: description.trim(),
                moscow,
                complexity,
            });
            router.back();
        }, [projectId, milestoneId, title, description, moscow, complexity, router]),
    );

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
                        autoFocus
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
                <Pressable
                    style={[
                        styles.createButton,
                        {
                            backgroundColor: canSubmit && !loading
                                ? theme.colors.header.tint
                                : theme.colors.textSecondary,
                        },
                    ]}
                    onPress={doCreate}
                    disabled={!canSubmit || loading}
                >
                    <Text style={styles.createButtonText}>
                        {loading ? t("common.loading") : t("common.create")}
                    </Text>
                </Pressable>
            </View>
        </ItemList>
    );
}

const styles = StyleSheet.create((theme) => ({
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
    },
    createButton: {
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: "center",
    },
    createButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: theme.colors.button.primary.tint,
    },
}));

export default React.memo(NewFeatureScreen);
