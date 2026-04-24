import * as React from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { resolveActiveTint } from "@/constants/activeTint";
import { useHappyAction } from "@/hooks/useHappyAction";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchSkill, updateSkill } from "@/sync/apiSkills";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { t } from "@/text";

function EditSkillPage() {
    const { id: skillId } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();

    const [name, setName] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [content, setContent] = React.useState("");
    const [initialLoading, setInitialLoading] = React.useState(true);

    React.useEffect(() => {
        if (!skillId) return;
        void (async () => {
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const skill = await fetchSkill(credentials, skillId);
                setName(skill.name);
                setDescription(skill.description ?? "");
                setContent(skill.content);
            } catch {
                // Will show empty form
            } finally {
                setInitialLoading(false);
            }
        })();
    }, [skillId]);

    const canSubmit = name.trim().length > 0 && content.trim().length > 0;

    const [saving, doSave] = useHappyAction(
        React.useCallback(async () => {
            if (!skillId || !name.trim() || !content.trim()) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            try {
                await updateSkill(credentials, skillId, {
                    name: name.trim(),
                    description: description.trim() || null,
                    content: content.trim(),
                });
            } catch (error) {
                if (String(error).includes("skill-name-conflict")) {
                    throw new Error(t("skills.nameTaken"));
                }
                throw error;
            }
            router.back();
        }, [skillId, name, description, content, router]),
    );

    if (initialLoading) {
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <ItemList>
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

            <View style={styles.buttonContainer}>
                <Pressable
                    style={[
                        styles.saveButton,
                        {
                            backgroundColor: canSubmit && !saving
                                ? resolveActiveTint(theme)
                                : theme.colors.textSecondary,
                        },
                    ]}
                    onPress={doSave}
                    disabled={!canSubmit || saving}
                >
                    {saving ? (
                        <ActivityIndicator color="#FFF" />
                    ) : (
                        <Text style={styles.saveButtonText}>
                            {t("skills.editSkill")}
                        </Text>
                    )}
                </Pressable>
            </View>
        </ItemList>
    );
}

export default React.memo(EditSkillPage);

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
    saveButton: {
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: "center",
    },
    saveButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: "#FFFFFF",
    },
});
