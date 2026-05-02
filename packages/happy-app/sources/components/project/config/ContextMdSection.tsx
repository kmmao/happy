import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useRouter } from "expo-router";
import { Project } from "@/sync/projectManager";
import { storage } from "@/sync/storage";

interface Props {
    project: Project;
}

export const ContextMdSection = React.memo<Props>(({ project }) => {
    const { theme } = useUnistyles();
    const router = useRouter();

    const activeSessionId = React.useMemo(() => {
        const sessions = storage.getState().sessions;
        return project.sessionIds.find((id) => sessions[id]?.active) ?? null;
    }, [project.sessionIds]);

    const canEdit = activeSessionId !== null;

    return (
        <Pressable
            style={[styles.card, { backgroundColor: theme.colors.surface }]}
            onPress={() => {
                if (!canEdit) return;
                router.push(`/project/${project.id}/context-md` as any);
            }}
            disabled={!canEdit}
        >
            <View style={styles.header}>
                <View style={[styles.iconBadge, { backgroundColor: `${theme.colors.accentPurple}1A` }]}>
                    <Ionicons name="document-text-outline" size={16} color={theme.colors.accentPurple} />
                </View>
                <Text style={[styles.title, { color: theme.colors.text }]}>
                    {t("projectConfig.sectionContextMd")}
                </Text>
                {canEdit && (
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                )}
            </View>
            <Text style={[styles.desc, { color: theme.colors.textSecondary }]}>
                {t("projectConfig.contextMdDesc")}
            </Text>
            {!canEdit && (
                <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
                    {t("projectConfig.contextMdNoSession")}
                </Text>
            )}
            {canEdit && (
                <View style={[styles.editRow, { borderTopColor: theme.colors.divider }]}>
                    <Ionicons name="create-outline" size={14} color={theme.colors.header.tint} />
                    <Text style={[styles.editText, { color: theme.colors.header.tint }]}>
                        {t("projectConfig.contextMdEdit")}
                    </Text>
                </View>
            )}
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 12,
        padding: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginBottom: 8,
    },
    iconBadge: {
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        flex: 1,
    },
    desc: {
        ...Typography.default("regular"),
        fontSize: 13,
        lineHeight: 18,
    },
    hint: {
        ...Typography.default("regular"),
        fontSize: 12,
        marginTop: 6,
    },
    editRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 12,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    editText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
}));
