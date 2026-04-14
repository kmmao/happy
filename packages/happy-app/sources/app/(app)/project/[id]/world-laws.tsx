import * as React from "react";
import { View, Text, ScrollView, Switch, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { useProject } from "@/hooks/useProjects";
import { ItemGroup } from "@/components/ItemGroup";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateProject } from "@/sync/apiProjects";
import { projectManager } from "@/sync/projectManager";
import { Ionicons } from "@expo/vector-icons";
import { Modal } from "@/modal";
import { layout } from "@/components/layout";
import { generateWorld, type WorldGenerateResult, type WorldElement } from "@/sync/apiWorld";
import {
    type Law,
    CATEGORY_LABELS,
    SEVERITY_COLORS,
    SEVERITY_LABELS,
    generateLawId,
    parseLaws,
} from "@/components/project/worldLawConstants";
import { LawEditor } from "@/components/project/LawEditor";

const ALL_ELEMENTS: { key: WorldElement; icon: string }[] = [
    { key: "narrative", icon: "book-outline" },
    { key: "laws", icon: "shield-checkmark-outline" },
    { key: "roles", icon: "people-outline" },
    { key: "member", icon: "person-outline" },
    { key: "goal", icon: "flag-outline" },
];

const WorldLawsScreen = React.memo(function WorldLawsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const navigation = useNavigation();
    const project = useProject(id);
    const { theme } = useUnistyles();

    const [narrative, setNarrative] = React.useState("");
    const [laws, setLaws] = React.useState<Law[]>([]);
    const [initialNarrative, setInitialNarrative] = React.useState("");
    const [initialLaws, setInitialLaws] = React.useState<Law[]>([]);
    const [saving, setSaving] = React.useState(false);
    const [generating, setGenerating] = React.useState(false);
    const [editingLaw, setEditingLaw] = React.useState<Law | null>(null);

    // Element selection for generation
    const [selectedElements, setSelectedElements] = React.useState<Set<WorldElement>>(
        new Set(ALL_ELEMENTS.map((e) => e.key)),
    );

    const toggleElement = React.useCallback((el: WorldElement) => {
        setSelectedElements((prev) => {
            const next = new Set(prev);
            if (next.has(el)) {
                next.delete(el);
            } else {
                next.add(el);
            }
            return next;
        });
    }, []);

    React.useEffect(() => {
        navigation.setOptions({ title: t("world.title") });
    }, [navigation]);

    React.useEffect(() => {
        if (project) {
            const n = project.narrative ?? "";
            const l = parseLaws(project.laws);
            setNarrative(n);
            setLaws(l);
            setInitialNarrative(n);
            setInitialLaws(l);
        }
    }, [project?.narrative, project?.laws]);

    const isDirty = React.useMemo(
        () => narrative !== initialNarrative || JSON.stringify(laws) !== JSON.stringify(initialLaws),
        [narrative, initialNarrative, laws, initialLaws],
    );

    const mountedRef = React.useRef(true);
    React.useEffect(() => () => { mountedRef.current = false; }, []);

    const handleSave = React.useCallback(async () => {
        if (!project?.serverId || !isDirty) return;
        setSaving(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const narrativeValue = narrative.trim() || null;
            const lawsValue = laws.length > 0 ? JSON.stringify(laws) : null;
            await updateProject(credentials, project.serverId, {
                narrative: narrativeValue,
                laws: lawsValue,
            });
            const localProject = projectManager.getProject(id);
            if (localProject) {
                localProject.narrative = narrativeValue;
                localProject.laws = lawsValue;
            }
            if (!mountedRef.current) return;
            setInitialNarrative(narrative);
            setInitialLaws(laws);
            Modal.toast(t("world.saved"));
        } catch {
            Modal.toast(t("world.saveError"));
        } finally {
            if (mountedRef.current) setSaving(false);
        }
    }, [project?.serverId, isDirty, narrative, laws, id]);

    const addLaw = React.useCallback(() => {
        setEditingLaw({
            id: generateLawId(),
            category: "quality",
            description: "",
            enabled: true,
            severity: "medium",
        });
    }, []);

    const saveLaw = React.useCallback((law: Law) => {
        setLaws((prev) => {
            const idx = prev.findIndex((l) => l.id === law.id);
            return idx >= 0
                ? prev.map((l, i) => (i === idx ? law : l))
                : [...prev, law];
        });
        setEditingLaw(null);
    }, []);

    const deleteLaw = React.useCallback(async (lawId: string) => {
        const confirmed = await Modal.confirm(
            t("world.deleteLawConfirmTitle"),
            t("world.deleteLawConfirmBody"),
        );
        if (confirmed) {
            setLaws((prev) => prev.filter((l) => l.id !== lawId));
        }
    }, []);

    const toggleLaw = React.useCallback((lawId: string) => {
        setLaws((prev) => prev.map((l) => (l.id === lawId ? { ...l, enabled: !l.enabled } : l)));
    }, []);

    const [genMode, setGenMode] = React.useState<"auto" | "custom">("auto");
    const [customPrompt, setCustomPrompt] = React.useState("");

    const applyResult = React.useCallback((result: WorldGenerateResult) => {
        if (result.narrative) setNarrative(result.narrative);
        if (result.laws) setLaws(result.laws);

        const parts: string[] = [];
        if (result.narrative) parts.push(t("world.narrativeLabel"));
        if (result.laws) parts.push(t("world.lawsLabel"));
        if (result.roles && result.roles.length > 0) parts.push(`${result.roles.length} ${t("roles.title")}`);
        if (result.member) parts.push(t("world.elementMember"));
        if (result.goals && result.goals.length > 0) parts.push(`${result.goals.length} ${t("world.goalsOverview")}`);

        const messages: string[] = [t("world.generateSuccess")];

        if (result.skipped.length > 0) {
            const skippedLabel = result.skipped.map((s) => {
                const map: Record<string, string> = {
                    narrative: t("world.narrativeLabel"),
                    laws: t("world.lawsLabel"),
                    roles: t("roles.title"),
                    member: t("world.elementMember"),
                    goal: t("world.goalsOverview"),
                };
                return map[s] ?? s;
            }).join(", ");
            messages.push(`${t("world.generateSkipped")}: ${skippedLabel}`);
        }

        if (result.errors && result.errors.length > 0) {
            messages.push(`${t("world.generatePartialError")}: ${result.errors.join(", ")}`);
        }

        Modal.toast(messages.join("\n"));
    }, []);

    const handleGenerate = React.useCallback(async (mode: "auto" | "custom") => {
        if (!project?.serverId) return;
        if (selectedElements.size === 0) return;

        if (mode === "custom" && !customPrompt.trim()) return;

        if (mode === "custom") {
            const hasExisting = narrative.trim().length > 0 || laws.length > 0;
            if (hasExisting) {
                const confirmed = await Modal.confirm(
                    t("world.generateConfirmTitle"),
                    t("world.generateConfirmBody"),
                );
                if (!confirmed) return;
            }
        }

        setGenerating(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const elements = Array.from(selectedElements);
            const result = await generateWorld(credentials, project.serverId, {
                mode,
                prompt: mode === "custom" ? customPrompt.trim() : undefined,
                elements,
            });
            if (!mountedRef.current) return;
            applyResult(result);
        } catch {
            if (mountedRef.current) Modal.toast(t("world.generateError"));
        } finally {
            if (mountedRef.current) setGenerating(false);
        }
    }, [project?.serverId, customPrompt, narrative, laws, applyResult, selectedElements]);

    if (!project) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.groupped.background }}>
                <ActivityIndicator />
            </View>
        );
    }

    const elementLabelMap: Record<WorldElement, string> = {
        narrative: t("world.narrativeLabel"),
        laws: t("world.lawsLabel"),
        roles: t("roles.title"),
        member: t("world.elementMember"),
        goal: t("world.goalsOverview"),
    };

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* World Initialization Panel */}
                <View style={styles.generateBanner}>
                    <View style={styles.generateBannerContent}>
                        <Ionicons name="sparkles" size={20} color={theme.colors.accentPurple} />
                        <View style={styles.generateBannerText}>
                            <Text style={styles.generateBannerTitle}>{t("world.generateTitle")}</Text>
                            <Text style={styles.generateBannerHint}>{t("world.generateHint")}</Text>
                        </View>
                    </View>

                    {/* Mode Tabs */}
                    <View style={styles.modeTabs}>
                        <Pressable
                            style={[styles.modeTab, genMode === "auto" && styles.modeTabActive]}
                            onPress={() => setGenMode("auto")}
                        >
                            <Ionicons name="flash-outline" size={14} color={genMode === "auto" ? "#fff" : theme.colors.text} />
                            <Text style={[styles.modeTabText, genMode === "auto" && styles.modeTabTextActive]}>
                                {t("world.modeAuto")}
                            </Text>
                        </Pressable>
                        <Pressable
                            style={[styles.modeTab, genMode === "custom" && styles.modeTabActive]}
                            onPress={() => setGenMode("custom")}
                        >
                            <Ionicons name="create-outline" size={14} color={genMode === "custom" ? "#fff" : theme.colors.text} />
                            <Text style={[styles.modeTabText, genMode === "custom" && styles.modeTabTextActive]}>
                                {t("world.modeCustom")}
                            </Text>
                        </Pressable>
                    </View>

                    {/* Mode Description */}
                    <Text style={styles.modeHint}>
                        {genMode === "auto" ? t("world.modeAutoHint") : t("world.modeCustomHint")}
                    </Text>

                    {/* Element Selection Chips */}
                    <View style={styles.elementChips}>
                        {ALL_ELEMENTS.map(({ key, icon }) => {
                            const selected = selectedElements.has(key);
                            return (
                                <Pressable
                                    key={key}
                                    style={[styles.elementChip, selected && styles.elementChipSelected]}
                                    onPress={() => toggleElement(key)}
                                >
                                    <Ionicons
                                        name={selected ? (icon.replace("-outline", "") as any) : (icon as any)}
                                        size={14}
                                        color={selected ? "#fff" : theme.colors.textSecondary}
                                    />
                                    <Text style={[styles.elementChipText, selected && styles.elementChipTextSelected]}>
                                        {elementLabelMap[key]}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    {/* Custom Prompt Input */}
                    {genMode === "custom" && (
                        <TextInput
                            style={styles.customPromptInput}
                            value={customPrompt}
                            onChangeText={setCustomPrompt}
                            placeholder={t("world.customPromptPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            multiline
                            numberOfLines={3}
                            textAlignVertical="top"
                            maxLength={5000}
                        />
                    )}

                    {/* Generate Button */}
                    <Pressable
                        style={[
                            styles.generateButton,
                            (generating || !project.serverId || selectedElements.size === 0 || (genMode === "custom" && !customPrompt.trim())) && { opacity: 0.4 },
                        ]}
                        onPress={() => handleGenerate(genMode)}
                        disabled={generating || !project.serverId || selectedElements.size === 0 || (genMode === "custom" && !customPrompt.trim())}
                    >
                        {generating ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <>
                                <Ionicons name={genMode === "auto" ? "flash" : "color-wand"} size={16} color="#fff" />
                                <Text style={styles.generateButtonText}>
                                    {genMode === "auto" ? t("world.generateAutoAction") : t("world.generateCustomAction")}
                                </Text>
                            </>
                        )}
                    </Pressable>
                </View>

                {/* Narrative */}
                <ItemGroup title={t("world.narrativeLabel")}>
                    <View style={styles.card}>
                        <Text style={styles.desc}>
                            {t("world.narrativeDesc")}
                        </Text>
                        <TextInput
                            style={styles.narrativeInput}
                            value={narrative}
                            onChangeText={setNarrative}
                            placeholder={t("world.narrativePlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            multiline
                            numberOfLines={5}
                            textAlignVertical="top"
                            maxLength={5000}
                        />
                        <Text style={styles.charCount}>
                            {narrative.length}/5000
                        </Text>
                    </View>
                </ItemGroup>

                {/* Laws */}
                <ItemGroup title={t("world.lawsLabel")}>
                    {laws.length === 0 ? (
                        <View style={styles.card}>
                            <Text style={styles.emptyText}>
                                {t("world.emptyLaws")}
                            </Text>
                        </View>
                    ) : (
                        laws.map((law) => (
                            <Pressable
                                key={law.id}
                                style={styles.lawRow}
                                onPress={() => setEditingLaw(law)}
                            >
                                <View style={styles.lawContent}>
                                    <View style={styles.lawHeader}>
                                        <View style={[styles.severityBadge, { backgroundColor: SEVERITY_COLORS[law.severity] ?? "#888" }]}>
                                            <Text style={styles.severityBadgeText}>
                                                {SEVERITY_LABELS[law.severity]?.() ?? law.severity}
                                            </Text>
                                        </View>
                                        <View style={styles.categoryBadge}>
                                            <Text style={styles.categoryBadgeText}>
                                                {CATEGORY_LABELS[law.category]?.() ?? law.category}
                                            </Text>
                                        </View>
                                    </View>
                                    <Text style={[styles.lawDesc, !law.enabled && styles.lawDescDisabled]}>
                                        {law.description || t("world.emptyDescription")}
                                    </Text>
                                </View>
                                <Switch
                                    value={law.enabled}
                                    onValueChange={() => toggleLaw(law.id)}
                                />
                            </Pressable>
                        ))
                    )}
                    <Pressable style={styles.addButton} onPress={addLaw}>
                        <Ionicons name="add-circle-outline" size={20} color={theme.colors.accentPurple} />
                        <Text style={styles.addButtonText}>{t("world.addLaw")}</Text>
                    </Pressable>
                </ItemGroup>
            </ScrollView>

            {/* Save Button */}
            <View style={styles.saveContainer}>
                <Pressable
                    style={[styles.saveButton, (!isDirty || saving) && styles.saveButtonDisabled]}
                    onPress={handleSave}
                    disabled={!isDirty || saving}
                >
                    {saving ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.saveButtonText}>{t("world.save")}</Text>
                    )}
                </Pressable>
            </View>

            {/* Edit Law Modal */}
            {editingLaw && (
                <LawEditor
                    law={editingLaw}
                    onSave={saveLaw}
                    onDelete={deleteLaw}
                    onClose={() => setEditingLaw(null)}
                />
            )}
        </View>
    );
});

export default WorldLawsScreen;

// LawEditor imported from @/components/project/LawEditor

// ── Styles ──

const styles = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollContent: {
        paddingBottom: 100,
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        width: "100%" as const,
    },
    generateBanner: {
        marginHorizontal: 16,
        marginTop: 12,
        marginBottom: 4,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 14,
        gap: 12,
    },
    generateBannerContent: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
    },
    generateBannerText: {
        flex: 1,
    },
    generateBannerTitle: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
    },
    generateBannerHint: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    modeTabs: {
        flexDirection: "row" as const,
        gap: 8,
    },
    modeTab: {
        flex: 1,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 6,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.groupped.background,
    },
    modeTabActive: {
        backgroundColor: theme.colors.accentPurple,
    },
    modeTabText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.text,
    },
    modeTabTextActive: {
        color: "#fff",
    },
    modeHint: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        lineHeight: 16,
    },
    elementChips: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
    },
    elementChip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: theme.colors.groupped.background,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    elementChipSelected: {
        backgroundColor: theme.colors.accentPurple,
        borderColor: theme.colors.accentPurple,
    },
    elementChipText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    elementChipTextSelected: {
        color: "#fff",
    },
    customPromptInput: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 8,
        padding: 12,
        minHeight: 80,
        textAlignVertical: "top" as const,
    },
    generateButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 6,
        backgroundColor: theme.colors.accentPurple,
        borderRadius: 10,
        paddingVertical: 10,
    },
    generateButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: "#fff",
    },
    card: {
        padding: 16,
        gap: 8,
    },
    desc: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },
    narrativeInput: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        padding: 12,
        minHeight: 120,
        textAlignVertical: "top" as const,
    },
    charCount: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        textAlign: "right" as const,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: "center" as const,
        paddingVertical: 20,
    },
    lawRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    lawContent: {
        flex: 1,
        marginRight: 12,
    },
    lawHeader: {
        flexDirection: "row" as const,
        gap: 6,
        marginBottom: 4,
    },
    severityBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    severityBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: "#fff",
    },
    categoryBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
        backgroundColor: theme.colors.divider,
    },
    categoryBadgeText: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    lawDesc: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
    },
    lawDescDisabled: {
        opacity: 0.4,
    },
    addButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        padding: 16,
    },
    addButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.accentPurple,
    },
    saveContainer: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 16,
    },
    saveButton: {
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: "center" as const,
        justifyContent: "center" as const,
    },
    saveButtonDisabled: {
        opacity: 0.4,
    },
    saveButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: "#fff",
    },

}));
