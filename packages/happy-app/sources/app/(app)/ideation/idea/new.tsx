import * as React from "react";
import { View, ScrollView, TextInput, Pressable, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Header } from "@/components/navigation/Header";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ideationStore } from "@/sync/ideationStore";
import {
    IDEATION_CATEGORIES,
    IDEATION_CATEGORY_LABELS,
    IDEATION_PRIORITIES,
    IDEATION_PRIORITY_LABELS,
    type IdeationCategory,
    type IdeationPriority,
} from "@/sync/ideationTypes";
import { useHappyAction } from "@/hooks/useHappyAction";

const NewIdea = React.memo(() => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    // Form state
    const [title, setTitle] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [category, setCategory] =
        React.useState<IdeationCategory>("feature");
    const [priority, setPriority] =
        React.useState<IdeationPriority>("medium");

    const [saving, performSave] = useHappyAction(async () => {
        if (!title.trim()) {
            throw { message: t("ideation.titleRequired") };
        }

        await ideationStore.getState().createIdea({
            title: title.trim(),
            description: description.trim(),
            category,
            priority,
        });

        router.back();
    });

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: theme.colors.groupped.background },
            ]}
        >
            <Header
                title={t("ideation.newIdea")}
                headerRight={() => (
                    <Pressable
                        onPress={performSave}
                        disabled={saving || !title.trim()}
                        hitSlop={15}
                    >
                        <Text
                            style={[
                                styles.saveButton,
                                {
                                    color: title.trim()
                                        ? theme.colors.header.tint
                                        : theme.colors.textSecondary,
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
                <ItemGroup title={t("ideation.details")}>
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
                            placeholder={t("ideation.titlePlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={title}
                            onChangeText={setTitle}
                            autoFocus
                        />
                        <View
                            style={[
                                styles.divider,
                                {
                                    backgroundColor: theme.colors.divider,
                                },
                            ]}
                        />
                        <TextInput
                            style={[
                                styles.descriptionInput,
                                { color: theme.colors.text },
                            ]}
                            placeholder={t("ideation.descriptionPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={description}
                            onChangeText={setDescription}
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                        />
                    </View>
                </ItemGroup>

                {/* Category selection */}
                <ItemGroup title={t("ideation.categoryLabel")}>
                    {IDEATION_CATEGORIES.map((cat, idx) => (
                        <Item
                            key={cat}
                            title={t(IDEATION_CATEGORY_LABELS[cat])}
                            onPress={() => setCategory(cat)}
                            selected={cat === category}
                            showDivider={
                                idx !== IDEATION_CATEGORIES.length - 1
                            }
                        />
                    ))}
                </ItemGroup>

                {/* Priority selection */}
                <ItemGroup title={t("ideation.priorityLabel")}>
                    {IDEATION_PRIORITIES.map((p, idx) => (
                        <Item
                            key={p}
                            title={t(IDEATION_PRIORITY_LABELS[p])}
                            onPress={() => setPriority(p)}
                            selected={p === priority}
                            showDivider={
                                idx !== IDEATION_PRIORITIES.length - 1
                            }
                        />
                    ))}
                </ItemGroup>
            </ScrollView>
        </View>
    );
});

export default NewIdea;

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
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
}));
