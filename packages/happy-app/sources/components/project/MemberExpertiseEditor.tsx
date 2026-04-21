import * as React from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { projectFormSheetStyles as pfs } from "./projectFormSheetStyles";

interface MemberExpertiseEditorProps {
    expertise: string[];
    onExpertiseChange: React.Dispatch<React.SetStateAction<string[]>>;
}

export const MemberExpertiseEditor = React.memo(function MemberExpertiseEditor({
    expertise,
    onExpertiseChange,
}: MemberExpertiseEditorProps) {
    const { theme } = useUnistyles();
    const [newTag, setNewTag] = React.useState("");

    const addTag = React.useCallback(() => {
        const trimmedTag = newTag.trim().toLowerCase();
        if (trimmedTag && expertise.length < 20 && !expertise.includes(trimmedTag)) {
            onExpertiseChange((previousExpertise) => [...previousExpertise, trimmedTag]);
            setNewTag("");
        }
    }, [expertise, newTag, onExpertiseChange]);

    const removeTag = React.useCallback((tagIndex: number) => {
        onExpertiseChange((previousExpertise) =>
            previousExpertise.filter((_, index) => index !== tagIndex),
        );
    }, [onExpertiseChange]);

    return (
        <>
            <Text style={pfs.fieldLabel}>{t("members.expertiseLabel")}</Text>
            <View style={styles.expertiseRow}>
                {expertise.map((tag, tagIndex) => (
                    <Pressable
                        key={tag}
                        style={styles.expertiseChip}
                        onPress={() => removeTag(tagIndex)}
                    >
                        <Text style={styles.expertiseChipText}>{tag}</Text>
                        <Ionicons name="close-circle" size={14} color={theme.colors.textSecondary} />
                    </Pressable>
                ))}
            </View>
            {expertise.length < 20 ? (
                <View style={styles.addTagRow}>
                    <TextInput
                        style={[pfs.textInput, { flex: 1 }]}
                        value={newTag}
                        onChangeText={setNewTag}
                        placeholder={t("members.expertisePlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        maxLength={50}
                        autoCapitalize="none"
                        onSubmitEditing={addTag}
                    />
                    <Pressable style={styles.addTagButton} onPress={addTag}>
                        <Ionicons name="add" size={20} color={theme.colors.accentPurple} />
                    </Pressable>
                </View>
            ) : null}
        </>
    );
});

const styles = StyleSheet.create((theme) => ({
    expertiseRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 6,
        marginTop: 8,
    },
    expertiseChip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        backgroundColor: theme.dark
            ? "rgba(139,92,246,0.15)"
            : "rgba(109,40,217,0.08)",
    },
    expertiseChipText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.accentPurple,
    },
    addTagRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
    },
    addTagButton: {
        padding: 8,
    },
}));
