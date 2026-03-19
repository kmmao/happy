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

function NewMilestoneScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { projectId } = useLocalSearchParams<{ projectId: string }>();

    const [title, setTitle] = React.useState("");
    const [description, setDescription] = React.useState("");

    const canSubmit = title.trim().length > 0;

    const [loading, doCreate] = useHappyAction(
        React.useCallback(async () => {
            if (!projectId || !title.trim()) return;
            await roadmapStore.getState().createMilestone(projectId, {
                title: title.trim(),
                description: description.trim(),
                targetDate: null,
            });
            router.back();
        }, [projectId, title, description, router]),
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

export default React.memo(NewMilestoneScreen);
