import * as React from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { resolveActiveTint } from "@/constants/activeTint";
import { useHappyAction } from "@/hooks/useHappyAction";
import { TokenStorage } from "@/auth/tokenStorage";
import { createSkill } from "@/sync/apiSkills";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { t } from "@/text";

function NewSkillPage() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const params = useLocalSearchParams<{
        fromTitle?: string;
        fromContent?: string;
        fromProjectId?: string;
    }>();

    const [name, setName] = React.useState(params.fromTitle ?? "");
    const [description, setDescription] = React.useState("");
    const [content, setContent] = React.useState(params.fromContent ?? "");

    const canSubmit = name.trim().length > 0 && content.trim().length > 0;

    const [loading, doCreate] = useHappyAction(
        React.useCallback(async () => {
            if (!name.trim() || !content.trim()) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            try {
                await createSkill(credentials, {
                    name: name.trim(),
                    description: description.trim() || undefined,
                    content: content.trim(),
                    projectId: params.fromProjectId || undefined,
                });
            } catch (error) {
                if (String(error).includes("skill-name-conflict")) {
                    throw new Error(t("skills.nameTaken"));
                }
                throw error;
            }
            router.back();
        }, [name, description, content, router]),
    );

    return (
        <ItemList>
            {/* Name */}
            <ItemGroup title={t("skills.name")}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.textInput, { color: theme.colors.text }]}
                        placeholder={t("skills.namePlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={name}
                        onChangeText={setName}
                        autoCapitalize="sentences"
                    />
                </View>
            </ItemGroup>

            {/* Description */}
            <ItemGroup title={t("skills.description")}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.textInput, { color: theme.colors.text }]}
                        placeholder={t("skills.descriptionPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={description}
                        onChangeText={setDescription}
                        autoCapitalize="sentences"
                    />
                </View>
            </ItemGroup>

            {/* Content */}
            <ItemGroup title={t("skills.content")}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[styles.textArea, { color: theme.colors.text }]}
                        placeholder={t("skills.contentPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={content}
                        onChangeText={setContent}
                        multiline
                        numberOfLines={10}
                        textAlignVertical="top"
                    />
                </View>
            </ItemGroup>

            {/* Submit */}
            <View style={styles.buttonContainer}>
                <Pressable
                    style={[
                        styles.createButton,
                        {
                            backgroundColor: canSubmit && !loading
                                ? resolveActiveTint(theme)
                                : theme.colors.textSecondary,
                        },
                    ]}
                    onPress={doCreate}
                    disabled={!canSubmit || loading}
                >
                    {loading ? (
                        <ActivityIndicator color="#FFF" />
                    ) : (
                        <Text style={styles.createButtonText}>
                            {t("skills.newSkill")}
                        </Text>
                    )}
                </Pressable>
            </View>
        </ItemList>
    );
}

export default React.memo(NewSkillPage);

const styles = StyleSheet.create({
    inputContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    textInput: {
        ...Typography.default(),
        fontSize: 15,
    },
    textArea: {
        ...Typography.default(),
        fontSize: 15,
        minHeight: 180,
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
        color: "#FFFFFF",
    },
});
