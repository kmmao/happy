import * as React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { BaseModal } from "@/modal/components/BaseModal";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchSkills } from "@/sync/apiSkills";
import type { ServerSkill } from "@/sync/apiSkills";

interface SkillPickerModalProps {
    visible: boolean;
    onClose: () => void;
    selectedIds: string[];
    onConfirm: (ids: string[], names: string[]) => void;
}

export const SkillPickerModal = React.memo(function SkillPickerModal({
    visible,
    onClose,
    selectedIds,
    onConfirm,
}: SkillPickerModalProps) {
    const { theme } = useUnistyles();
    const [skills, setSkills] = React.useState<ServerSkill[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [selected, setSelected] = React.useState<Set<string>>(new Set(selectedIds));

    React.useEffect(() => {
        if (visible) {
            setSelected(new Set(selectedIds));
        }
    }, [visible, selectedIds]);

    React.useEffect(() => {
        if (!visible) return;
        let cancelled = false;

        void (async () => {
            setLoading(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || cancelled) return;
                const result = await fetchSkills(credentials, { archived: false, limit: 100 });
                if (!cancelled) setSkills(result.skills);
            } catch {
                // Silently fail
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [visible]);

    const toggleSkill = React.useCallback((id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const handleDone = React.useCallback(() => {
        const ids = Array.from(selected);
        const names = skills.filter((s) => selected.has(s.id)).map((s) => s.name);
        onConfirm(ids, names);
        onClose();
    }, [selected, skills, onConfirm, onClose]);

    return (
        <BaseModal visible={visible} onClose={onClose}>
            <View style={[styles.card, { backgroundColor: theme.colors.surfaceHigh }]}>
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        {t("tasks.skillsPick")}
                    </Text>
                    <Pressable onPress={handleDone}>
                        <Text style={[styles.doneText, { color: theme.colors.textLink }]}>
                            {t("tasks.skillsDone")}
                        </Text>
                    </Pressable>
                </View>

                {loading ? (
                    <View style={styles.centerContainer}>
                        <ActivityIndicator />
                    </View>
                ) : skills.length === 0 ? (
                    <View style={styles.centerContainer}>
                        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                            {t("skills.noSkills")}
                        </Text>
                    </View>
                ) : (
                    <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                        {skills.map((skill) => {
                            const isSelected = selected.has(skill.id);
                            return (
                                <Pressable
                                    key={skill.id}
                                    style={[styles.row, { borderBottomColor: theme.colors.divider }]}
                                    onPress={() => toggleSkill(skill.id)}
                                >
                                    <View style={styles.rowContent}>
                                        <Text style={[styles.skillName, { color: theme.colors.text }]}>
                                            {skill.name}
                                        </Text>
                                        {skill.description && (
                                            <Text
                                                style={[styles.skillDesc, { color: theme.colors.textSecondary }]}
                                                numberOfLines={1}
                                            >
                                                {skill.description}
                                            </Text>
                                        )}
                                    </View>
                                    <Ionicons
                                        name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                                        size={22}
                                        color={isSelected ? theme.colors.textLink : theme.colors.textSecondary}
                                    />
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                )}
            </View>
        </BaseModal>
    );
});

const styles = StyleSheet.create({
    card: {
        borderRadius: 16,
        maxHeight: 400,
        width: "100%",
        maxWidth: 400,
        overflow: "hidden",
    },
    header: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        padding: 16,
        borderBottomWidth: 1,
    },
    title: {
        fontSize: 17,
        fontWeight: "600",
    },
    doneText: {
        fontSize: 16,
        fontWeight: "600",
    },
    list: {
        maxHeight: 320,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowContent: {
        flex: 1,
        marginRight: 12,
    },
    skillName: {
        fontSize: 15,
        fontWeight: "500",
    },
    skillDesc: {
        fontSize: 13,
        marginTop: 2,
    },
    centerContainer: {
        padding: 32,
        alignItems: "center",
    },
    emptyText: {
        fontSize: 15,
    },
});
