import * as React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchSkills, archiveSkill, deleteSkill } from "@/sync/apiSkills";
import type { ServerSkill } from "@/sync/apiSkills";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { useLayout } from "@/components/layout";
import { Modal } from "@/modal";
import { describeSkillRouting } from "@/utils/skillRouting";
import { t } from "@/text";

/** Subtitle including Phase 3 front-matter routing (model / user-only). */
function skillSubtitle(skill: ServerSkill): string {
    const base = skill.description ?? t("skills.contentPreview", { chars: skill.content.length });
    const routing = describeSkillRouting(skill.content);
    if (!routing) return base;
    const parts = [routing.model, routing.userOnly ? t("skills.userOnlyBadge") : null].filter(
        Boolean,
    );
    return parts.length > 0 ? `${base} · ${parts.join(" · ")}` : base;
}

function SkillListPage() {
    const layout = useLayout();
    const router = useRouter();
    const { theme } = useUnistyles();

    const [skills, setSkills] = React.useState<ServerSkill[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);

    const load = React.useCallback(async (kind: "initial" | "refresh") => {
        kind === "initial" ? setLoading(true) : setRefreshing(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const result = await fetchSkills(credentials, { archived: false, limit: 200 });
            setSkills(result.skills);
        } catch {
            // Will retry on refresh
        } finally {
            kind === "initial" ? setLoading(false) : setRefreshing(false);
        }
    }, []);

    React.useEffect(() => {
        void load("initial");
    }, [load]);

    const handleSkillPress = React.useCallback((skill: ServerSkill) => {
        const buttons: Array<{ text: string; style?: "cancel" | "destructive"; onPress?: () => void }> = [];

        buttons.push({
            text: t("skills.editSkill"),
            onPress: () => router.push(`/skills/${skill.id}/edit` as any),
        });

        buttons.push({
            text: skill.archived ? t("skills.unarchive") : t("skills.archive"),
            onPress: async () => {
                try {
                    const credentials = await TokenStorage.getCredentials();
                    if (!credentials) return;
                    await archiveSkill(credentials, skill.id);
                    void load("refresh");
                } catch (error) {
                    Modal.alert(t("common.error"), String(error));
                }
            },
        });

        buttons.push({
            text: t("skills.delete"),
            style: "destructive",
            onPress: () => {
                Modal.alert(t("skills.delete"), t("skills.confirmDelete"), [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                        text: t("common.delete"),
                        style: "destructive",
                        onPress: async () => {
                            try {
                                const credentials = await TokenStorage.getCredentials();
                                if (!credentials) return;
                                await deleteSkill(credentials, skill.id);
                                setSkills((prev) => prev.filter((s) => s.id !== skill.id));
                            } catch (error) {
                                Modal.alert(t("common.error"), String(error));
                            }
                        },
                    },
                ]);
            },
        });

        buttons.push({ text: t("common.cancel"), style: "cancel" });
        Modal.alert(skill.name, skill.description ?? "", buttons);
    }, [router, load]);

    const { globalSkills, projectSkills } = React.useMemo(() => {
        const global: ServerSkill[] = [];
        const project: ServerSkill[] = [];
        for (const skill of skills) {
            if (skill.projectId) {
                project.push(skill);
            } else {
                global.push(skill);
            }
        }
        return { globalSkills: global, projectSkills: project };
    }, [skills]);

    if (loading) {
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: theme.colors.surface }}
            contentContainerStyle={{ maxWidth: layout.maxWidth, width: "100%", alignSelf: "center" as const, paddingBottom: 80 }}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => void load("refresh")}
                />
            }
        >
            {/* Global Skills */}
            <ItemGroup title={t("skills.globalSkills")}>
                {globalSkills.length === 0 ? (
                    <Item title={t("skills.noSkills")} />
                ) : (
                    globalSkills.map((skill) => (
                        <Item
                            key={skill.id}
                            title={skill.name}
                            subtitle={skillSubtitle(skill)}
                            onPress={() => handleSkillPress(skill)}
                            showChevron
                        />
                    ))
                )}
            </ItemGroup>

            {/* Project Skills */}
            {projectSkills.length > 0 && (
                <ItemGroup title={t("skills.projectSkills")}>
                    {projectSkills.map((skill) => (
                        <Item
                            key={skill.id}
                            title={skill.name}
                            subtitle={skillSubtitle(skill)}
                            onPress={() => handleSkillPress(skill)}
                            showChevron
                        />
                    ))}
                </ItemGroup>
            )}

            {/* FAB */}
            <Pressable
                style={[styles.fab, { backgroundColor: theme.colors.textLink }]}
                onPress={() => router.push("/skills/new" as any)}
            >
                <Ionicons name="add" size={28} color="#FFF" />
            </Pressable>
        </ScrollView>
    );
}

export default React.memo(SkillListPage);

const styles = StyleSheet.create({
    fab: {
        position: "absolute",
        right: 20,
        bottom: 24,
        width: 56,
        height: 56,
        borderRadius: 28,
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
});
