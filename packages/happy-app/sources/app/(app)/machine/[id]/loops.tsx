import * as React from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { layout } from "@/components/layout";
import { Modal } from "@/modal";
import {
    machineEmitAgentLoopEvent,
    machinePauseAgentLoop,
    machineRemoveAgentLoop,
    machineResumeAgentLoop,
    machineRunAgentLoopNow,
    type MachineAgentLoop,
} from "@/sync/ops";
import { t } from "@/text";
import { useMachine } from "@/sync/storage";
import { utf8ToBase64 } from "@/utils/stringUtils";
import {
    getLoopFormLayoutMode,
} from "./loopsLayout";
import { AutoDreamProfileEditorModal } from "./AutoDreamProfileEditorModal";
import { BootstrapProfileEditorModal } from "./BootstrapProfileEditorModal";
import { LoopAutomationSection } from "./LoopAutomationSection";
import { LoopEditorModal } from "./LoopEditorModal";
import { LoopSuggestionsSection } from "./LoopSuggestionsSection";
import { OneClickSetupCard } from "./OneClickSetupCard";
import { BriefSection } from "./BriefSection";
import { useOneClickSetup } from "./useOneClickSetup";
import { useLoopsData } from "./useLoopsData";
import { useLoopSuggestions } from "./useLoopSuggestions";
import {
    getLoopBriefPath,
    getLoopContextPath,
    getLoopDetailMessage,
    getLoopListSubtitleCompact,
    getLoopMemoryPath,
    getLoopPhaseLabel,
    getLoopStatusColor,
    getLoopStatusLabel,
} from "./loopsLabels";

export default React.memo(function MachineLoopsPage() {
    const { id: machineIdParam, loopId: focusLoopId } = useLocalSearchParams<{ id: string; loopId?: string }>();
    const machineId = typeof machineIdParam === "string" ? machineIdParam : undefined;
    const router = useRouter();
    const { theme } = useUnistyles();
    const { width: viewportWidth } = useWindowDimensions();
    const formLayout = getLoopFormLayoutMode({
        viewportWidth,
        isWeb: Platform.OS === "web",
    });
    const machine = useMachine(machineId ?? "");
    const rpcReady = machine?.rpcReady ?? false;

    const automation = machine?.daemonState?.automation;
    const loopsData = useLoopsData({
        machineId,
        rpcReady,
        pushedLoops: automation?.loops,
        pushedBootstrapProfiles: automation?.bootstrapProfiles,
        pushedAutoDreamProfiles: automation?.autoDreamProfiles,
    });
    const {
        loops,
        loading,
        refreshing,
        bootstrapProfiles,
        autoDreamProfiles,
        upstreamLoopIdsByLoopId,
        automationProfilesRef,
        mutatingBootstrapProfileId,
        editingBootstrapProfile,
        setEditingBootstrapProfile,
        bootstrapProfileEditorVisible,
        setBootstrapProfileEditorVisible,
        mutatingAutoDreamProfileId,
        editingAutoDreamProfile,
        setEditingAutoDreamProfile,
        autoDreamProfileEditorVisible,
        setAutoDreamProfileEditorVisible,
        automationQuickBusy,
        profileId,
        projectId,
        load,
        loadRef,
        runAutomationQuickSetup,
        mutateBootstrapProfile,
        mutateAutoDreamProfile,
    } = loopsData;

    const oneClickSetup = useOneClickSetup(
        machineId,
        automationProfilesRef,
        React.useCallback(() => loadRef.current(), [loadRef]),
        projectId,
        profileId,
    );
    const loopSuggestions = useLoopSuggestions({
        machineId,
        profileId,
        projectId,
        load,
    });
    const {
        suggestions,
        suggesting,
        creatingSuggestionKey,
        adoptingAllSuggestions,
        bootstrapEntries,
        bootstrapScanning,
        bootstrappingRepoPath,
        loadSuggestions,
        adoptSuggestion,
        adoptAllSuggestions,
        scanBootstrapRepos,
        adoptRepoSuggestions,
    } = loopSuggestions;

    const [mutatingLoopId, setMutatingLoopId] = React.useState<string | null>(null);
    const [editingLoop, setEditingLoop] = React.useState<MachineAgentLoop | null>(null);
    const [loopEditorVisible, setLoopEditorVisible] = React.useState(false);
    const [showAutomation, setShowAutomation] = React.useState(true);
    const [searchQuery, setSearchQuery] = React.useState("");
    const focusedLoopRef = React.useRef<string | null>(null);

    const closeLoopEditor = React.useCallback(() => {
        setLoopEditorVisible(false);
        setEditingLoop(null);
    }, []);

    const openCreateLoopEditor = React.useCallback(() => {
        setEditingLoop(null);
        setLoopEditorVisible(true);
    }, []);

    const mutateLoop = React.useCallback(async (loop: MachineAgentLoop, action: "pause" | "resume" | "run-now" | "remove" | "event") => {
        if (!machineId) {
            return;
        }
        setMutatingLoopId(loop.id);
        try {
            const result = action === "pause"
                ? await machinePauseAgentLoop(machineId, loop.id)
                : action === "resume"
                    ? await machineResumeAgentLoop(machineId, loop.id)
                    : action === "run-now"
                        ? await machineRunAgentLoopNow(machineId, loop.id)
                        : action === "event"
                            ? await machineEmitAgentLoopEvent(machineId, loop.id, {
                                source: "ui",
                                title: t("machine.agentLoopTriggerEventTitle"),
                                details: `${t("machine.agentLoopTriggerEventDetailPrefix")}: ${new Date().toLocaleString()}`,
                                autoRun: true,
                            })
                            : await machineRemoveAgentLoop(machineId, loop.id);
            if (!result.success) {
                throw new Error(result.errorMessage || t("common.error"));
            }
            if (editingLoop?.id === loop.id && action === "remove") {
                closeLoopEditor();
            }
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setMutatingLoopId(null);
        }
    }, [closeLoopEditor, editingLoop?.id, load, machineId]);

    const openMachineFileViewer = React.useCallback((title: string, filePath: string) => {
        router.push(`/machine/${machineId}/file?path=${encodeURIComponent(utf8ToBase64(filePath))}&title=${encodeURIComponent(utf8ToBase64(title))}` as any);
    }, [machineId, router]);

    const openLoopActions = React.useCallback((loop: MachineAgentLoop) => {
        const upstreamLoopIds = upstreamLoopIdsByLoopId[loop.id] ?? [];
        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
            {
                text: t("machine.agentLoopEdit"),
                onPress: () => { setEditingLoop(loop); setLoopEditorVisible(true); },
            },
            {
                text: t("machine.agentLoopViewAutomation"),
                onPress: () => router.push(`/machine/${machineId}/automation?q=${encodeURIComponent(loop.id)}` as any),
            },
        ];

        if (loop.lastSessionId) {
            buttons.push({
                text: t("machine.automationOpenSession"),
                onPress: () => router.push(`/session/${loop.lastSessionId}` as any),
            });
        }

        buttons.push({
            text: t("machine.agentLoopRunNow"),
            onPress: () => void mutateLoop(loop, "run-now"),
        });

        buttons.push({
            text: t("machine.agentLoopTriggerEvent"),
            onPress: () => void mutateLoop(loop, "event"),
        });

        if (loop.enabled) {
            buttons.push({
                text: t("machine.agentLoopPause"),
                onPress: () => void mutateLoop(loop, "pause"),
            });
        } else {
            buttons.push({
                text: t("machine.agentLoopResume"),
                onPress: () => void mutateLoop(loop, "resume"),
            });
        }

        buttons.push({
            text: t("machine.agentLoopRemove"),
            style: "destructive",
            onPress: () => {
                Modal.alert(
                    t("machine.agentLoopRemove"),
                    t("machine.agentLoopRemoveMessage"),
                    [
                        { text: t("common.cancel"), style: "cancel" },
                        {
                            text: t("machine.agentLoopRemove"),
                            style: "destructive",
                            onPress: () => void mutateLoop(loop, "remove"),
                        },
                    ],
                );
            },
        });

        if (loop.lastBriefAt) {
            buttons.push({
                text: t("machine.agentLoopViewBrief"),
                onPress: () => openMachineFileViewer(loop.name || loop.id, getLoopBriefPath(loop)),
            });
        }

        buttons.push({
            text: t("machine.agentLoopViewMemory"),
            onPress: () => openMachineFileViewer(`${loop.name || loop.id} • ${t("machine.agentLoopViewMemory")}`, getLoopMemoryPath(loop)),
        });

        buttons.push({
            text: t("machine.agentLoopViewContext"),
            onPress: () => openMachineFileViewer(`${loop.name || loop.id} • ${t("machine.agentLoopViewContext")}`, getLoopContextPath(loop)),
        });

        if (loop.downstreamLoopIds?.length) {
            buttons.push({
                text: t("machine.agentLoopOpenDownstreamLoop"),
                onPress: () => router.push(`/machine/${machineId}/loops?loopId=${encodeURIComponent(loop.downstreamLoopIds![0])}` as any),
            });
        }

        if (upstreamLoopIds.length) {
            buttons.push({
                text: t("machine.agentLoopOpenUpstreamLoop"),
                onPress: () => router.push(`/machine/${machineId}/loops?loopId=${encodeURIComponent(upstreamLoopIds[0])}` as any),
            });
        }

        const detailMessage = getLoopDetailMessage(loop)
            + (upstreamLoopIds.length ? `\n${t("machine.agentLoopUpstreamLoops")}: ${upstreamLoopIds.join(", ")}` : "");
        Modal.alert(loop.name || loop.id, detailMessage, buttons);
    }, [machineId, mutateLoop, openMachineFileViewer, router, upstreamLoopIdsByLoopId]);

    React.useEffect(() => {
        void load("initial");
    }, [load]);

    React.useEffect(() => {
        if (!focusLoopId || focusedLoopRef.current === focusLoopId) {
            return;
        }
        const target = loops.find((loop) => loop.id === focusLoopId);
        if (!target) {
            return;
        }
        focusedLoopRef.current = focusLoopId;
        setTimeout(() => openLoopActions(target), 50);
    }, [focusLoopId, loops, openLoopActions]);

    const filteredLoops = React.useMemo(() => {
        const needle = searchQuery.trim().toLowerCase();
        if (!needle) {
            return loops;
        }
        return loops.filter((loop) => [
            loop.id,
            loop.name,
            loop.prompt,
            loop.directory,
            loop.agent,
            loop.projectId,
            loop.profileId,
            loop.goal,
            loop.currentFocus,
            loop.workingMemory,
            loop.lastReflectionSummary,
            loop.lastError,
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)));
    }, [loops, searchQuery]);

    const loopSectionsByDirectory = React.useMemo(() => {
        const groups = new Map<string, MachineAgentLoop[]>();
        for (const loop of filteredLoops) {
            const dir = (loop.directory ?? "").replace(/\/+$/, "").trim();
            const list = groups.get(dir) ?? [];
            list.push(loop);
            groups.set(dir, list);
        }
        return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [filteredLoops]);

    const enabledCount = React.useMemo(() => loops.filter((loop) => loop.enabled).length, [loops]);
    const suggestionCreatableCount = React.useMemo(() => suggestions.filter((suggestion) => !suggestion.alreadyConfigured).length, [suggestions]);

    const handleSuggestAction = React.useCallback(() => {
        setEditingLoop(null);
        setLoopEditorVisible(true);
    }, []);

    const renderEmptyStateCard = (
        icon: React.ComponentProps<typeof Ionicons>["name"],
        title: string,
        subtitle?: string,
    ) => (
        <View
            style={[
                styles.emptyStateCard,
                { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh },
            ]}
        >
            <Ionicons name={icon} size={20} color={theme.colors.textSecondary} />
            <View style={styles.emptyStateTextWrap}>
                <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>{title}</Text>
                {subtitle ? <Text style={[styles.emptyStateSubtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text> : null}
            </View>
        </View>
    );

    return (
        <>
            <Stack.Screen options={{ title: t("machine.agentLoops") }} />
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} />}
            >
                <OneClickSetupCard
                    setup={oneClickSetup}
                    onRefresh={() => void load("refresh")}
                />

                <ItemGroup title={t("machine.agentLoops")}>
                    <View style={[styles.loopsIntegratedTop, { borderBottomColor: theme.colors.divider }]}>
                        <Text style={[styles.loopsIntegratedHint, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                            {t("machine.loopsFlowSubtitle")}
                        </Text>
                        <View style={styles.searchRow}>
                            <View style={[styles.searchBar, styles.searchBarFlex, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                                <Ionicons name="search-outline" size={18} color={theme.colors.textSecondary} />
                                <TextInput
                                    style={[styles.searchInput, { color: theme.colors.text }]}
                                    placeholder={t("machine.agentLoopSearchPlaceholder")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={searchQuery}
                                    onChangeText={setSearchQuery}
                                />
                            </View>
                            <Pressable
                                style={[styles.refreshIconButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}
                                onPress={() => void load("refresh")}
                            >
                                {refreshing ? (
                                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                ) : (
                                    <Ionicons name="refresh-outline" size={18} color={theme.colors.primary} />
                                )}
                            </Pressable>
                        </View>
                        <View style={styles.loopsQuickRow}>
                            <Pressable
                                style={[styles.loopsQuickChip, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}
                                onPress={openCreateLoopEditor}
                            >
                                <Ionicons name="add-circle-outline" size={18} color={theme.colors.textLink} />
                                <View style={styles.loopsQuickChipTextCol}>
                                    <Text style={[styles.loopsQuickChipTitle, { color: theme.colors.text }]} numberOfLines={1}>
                                        {t("machine.agentLoopCreate")}
                                    </Text>
                                </View>
                                <View style={[styles.loopsQuickChipBadge, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                                    <Text style={[styles.loopsQuickChipBadgeText, { color: theme.colors.textSecondary }]}>{`${enabledCount}/${loops.length}`}</Text>
                                </View>
                            </Pressable>
                            <Pressable
                                style={[styles.loopsQuickChip, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}
                                onPress={handleSuggestAction}
                            >
                                <Ionicons name="sparkles-outline" size={18} color={theme.colors.header.tint} />
                                <View style={styles.loopsQuickChipTextCol}>
                                    <Text style={[styles.loopsQuickChipTitle, { color: theme.colors.text }]} numberOfLines={1}>
                                        {t("machine.agentLoopSuggest")}
                                    </Text>
                                    <Text style={[styles.loopsQuickChipPath, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                        {t("machine.agentLoopPathPlaceholder")}
                                    </Text>
                                </View>
                                {suggesting ? (
                                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                ) : (
                                    <View style={[styles.loopsQuickChipBadge, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                                        <Text style={[styles.loopsQuickChipBadgeText, { color: theme.colors.textSecondary }]}>{String(suggestionCreatableCount)}</Text>
                                    </View>
                                )}
                            </Pressable>
                        </View>
                    </View>
                    {loading ? (
                        <View style={styles.loopSkeletonBlock}>
                            <Text style={[styles.loopSkeletonHint, { color: theme.colors.textSecondary }]}>
                                {t("machine.agentLoopsLoading")}
                            </Text>
                            {Array.from({ length: 6 }, (_, skeletonIndex) => (
                                <View
                                    key={skeletonIndex}
                                    style={[styles.loopSkeletonRow, { borderBottomColor: theme.colors.divider }]}
                                >
                                    <View style={[styles.loopSkeletonIcon, { backgroundColor: theme.colors.surfaceHigh }]} />
                                    <View style={styles.loopSkeletonTextCol}>
                                        <View style={[styles.loopSkeletonLineTitle, { backgroundColor: theme.colors.surfaceHigh }]} />
                                        <View style={[styles.loopSkeletonLineMeta, { backgroundColor: theme.colors.surfaceHigh }]} />
                                    </View>
                                </View>
                            ))}
                        </View>
                    ) : filteredLoops.length === 0 ? (
                        renderEmptyStateCard("repeat-outline", loops.length === 0 ? t("machine.agentLoopsEmpty") : t("machine.agentLoopNoMatches"), t("machine.agentLoopsViewAllHint"))
                    ) : (
                        loopSectionsByDirectory.map(([directoryKey, sectionLoops]) => (
                            <View key={directoryKey || "__nodir__"}>
                                <View
                                    style={[
                                        styles.repoGroupHeader,
                                        { backgroundColor: theme.colors.surfaceHigh, borderBottomColor: theme.colors.divider },
                                    ]}
                                >
                                    <Ionicons name="folder-outline" size={13} color={theme.colors.textSecondary} />
                                    <Text
                                        style={[styles.repoGroupHeaderText, { color: theme.colors.textSecondary }]}
                                        numberOfLines={1}
                                    >
                                        {directoryKey ? directoryKey : t("machine.agentLoopUnknownRepo")}
                                    </Text>
                                </View>
                                {sectionLoops.map((loop) => (
                                    <Item
                                        key={loop.id}
                                        title={loop.name || loop.id}
                                        subtitle={getLoopListSubtitleCompact(loop)}
                                        subtitleLines={1}
                                        detail={loop.lastError ? "\u26A0" : loop.runtimeState === "active" ? getLoopPhaseLabel(loop) : getLoopStatusLabel(loop)}
                                        detailStyle={{
                                            color: loop.lastError ? "#FF3B30" : getLoopStatusColor(loop, theme),
                                            fontWeight: loop.lastError || loop.runtimeState === "active" ? "700" : undefined,
                                        }}
                                        icon={<Ionicons
                                            name={loop.lastError ? "alert-circle" : loop.runtimeState === "active" ? "play-circle" : "repeat-outline"}
                                            size={20}
                                            color={loop.lastError ? "#FF3B30" : getLoopStatusColor(loop, theme)}
                                        />}
                                        onPress={() => openLoopActions(loop)}
                                        showChevron
                                        style={styles.loopListItemCompact}
                                        rightElement={mutatingLoopId === loop.id ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                                    />
                                ))}
                            </View>
                        ))
                    )}
                    <LoopSuggestionsSection
                        suggestions={suggestions}
                        suggestionCreatableCount={suggestionCreatableCount}
                        adoptingAllSuggestions={adoptingAllSuggestions}
                        creatingSuggestionKey={creatingSuggestionKey}
                        adoptSuggestion={adoptSuggestion}
                        adoptAllSuggestions={adoptAllSuggestions}
                        formLayoutStacked={formLayout.modalHeaderStacked}
                    />
                </ItemGroup>

                {/* Recent Briefs from Agent Loops */}
                <BriefSection briefs={machine?.daemonState?.recentBriefs ?? []} />

                {/* Automation -- collapsible, default expanded */}
                <LoopAutomationSection
                    bootstrapProfiles={bootstrapProfiles}
                    autoDreamProfiles={autoDreamProfiles}
                    bootstrapEntries={bootstrapEntries}
                    showAutomation={showAutomation}
                    setShowAutomation={setShowAutomation}
                    automationQuickBusy={automationQuickBusy}
                    mutatingBootstrapProfileId={mutatingBootstrapProfileId}
                    mutatingAutoDreamProfileId={mutatingAutoDreamProfileId}
                    bootstrapScanning={bootstrapScanning}
                    bootstrappingRepoPath={bootstrappingRepoPath}
                    setEditingBootstrapProfile={setEditingBootstrapProfile}
                    setBootstrapProfileEditorVisible={setBootstrapProfileEditorVisible}
                    setEditingAutoDreamProfile={setEditingAutoDreamProfile}
                    setAutoDreamProfileEditorVisible={setAutoDreamProfileEditorVisible}
                    runAutomationQuickSetup={runAutomationQuickSetup}
                    mutateBootstrapProfile={mutateBootstrapProfile}
                    mutateAutoDreamProfile={mutateAutoDreamProfile}
                    scanBootstrapRepos={scanBootstrapRepos}
                    adoptRepoSuggestions={adoptRepoSuggestions}
                    openMachineFileViewer={openMachineFileViewer}
                    formLayoutStacked={formLayout.modalHeaderStacked}
                />
            </ScrollView>

            <LoopEditorModal
                visible={loopEditorVisible}
                onClose={closeLoopEditor}
                onSaved={() => void load("refresh")}
                machineId={machineId}
                editingLoop={editingLoop}
                loopCount={loops.length}
                enabledCount={enabledCount}
                suggesting={suggesting}
                onSuggest={(dir, _agent, _projId, _profId) => void loadSuggestions(dir)}
            />

            <BootstrapProfileEditorModal
                visible={bootstrapProfileEditorVisible}
                onClose={() => setBootstrapProfileEditorVisible(false)}
                onSaved={() => void load("refresh")}
                machineId={machineId}
                editingProfile={editingBootstrapProfile}
            />

            <AutoDreamProfileEditorModal
                visible={autoDreamProfileEditorVisible}
                onClose={() => setAutoDreamProfileEditorVisible(false)}
                onSaved={() => void load("refresh")}
                machineId={machineId}
                editingProfile={editingAutoDreamProfile}
            />
        </>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
        paddingBottom: 32,
    },
    loopSkeletonBlock: {
        paddingBottom: 4,
    },
    loopSkeletonHint: {
        fontSize: 12,
        paddingHorizontal: 16,
        paddingVertical: 6,
    },
    loopSkeletonRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 10,
        borderBottomWidth: 1,
    },
    loopSkeletonIcon: {
        width: 28,
        height: 28,
        borderRadius: 8,
    },
    loopSkeletonTextCol: {
        flex: 1,
        gap: 6,
    },
    loopSkeletonLineTitle: {
        height: 14,
        borderRadius: 4,
        width: "55%",
        maxWidth: 220,
    },
    loopSkeletonLineMeta: {
        height: 11,
        borderRadius: 4,
        width: "88%",
        maxWidth: 320,
    },
    repoGroupHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 5,
        borderBottomWidth: 1,
    },
    repoGroupHeaderText: {
        flex: 1,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.2,
    },
    loopListItemCompact: {
        minHeight: 48,
        paddingVertical: 6,
    },
    searchRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    searchBar: {
        minHeight: 38,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    searchBarFlex: {
        flex: 1,
    },
    loopsIntegratedTop: {
        paddingHorizontal: 10,
        paddingTop: 4,
        paddingBottom: 8,
        gap: 6,
        borderBottomWidth: 1,
    },
    loopsIntegratedHint: {
        fontSize: 11,
        lineHeight: 15,
        paddingHorizontal: 2,
    },
    loopsQuickRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
    },
    loopsQuickChip: {
        flex: 1,
        minWidth: 140,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 42,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    loopsQuickChipTextCol: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    loopsQuickChipTitle: {
        fontSize: 13,
        fontWeight: "700",
    },
    loopsQuickChipPath: {
        fontSize: 10,
        lineHeight: 13,
    },
    loopsQuickChipBadge: {
        minHeight: 26,
        minWidth: 36,
        paddingHorizontal: 8,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    loopsQuickChipBadgeText: {
        fontSize: 12,
        fontWeight: "700",
    },
    refreshIconButton: {
        width: 38,
        height: 38,
        borderWidth: 1,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        paddingVertical: 0,
    },
    emptyStateCard: {
        marginHorizontal: 12,
        marginVertical: 12,
        padding: 16,
        borderWidth: 1,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    emptyStateTextWrap: {
        flex: 1,
        gap: 2,
    },
    emptyStateTitle: {
        fontSize: 14,
        fontWeight: "700",
    },
    emptyStateSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
}));
