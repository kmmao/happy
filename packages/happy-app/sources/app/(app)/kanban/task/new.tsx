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
import { kanbanStore } from "@/sync/kanbanStore";
import {
    KANBAN_COLUMNS,
    KANBAN_COLUMN_LABELS,
    KANBAN_PRIORITIES,
    KANBAN_PRIORITY_LABELS,
    type KanbanColumnId,
    type KanbanPriority,
} from "@/sync/kanbanTypes";
import {
    KANBAN_COLUMN_COLORS,
    PRIORITY_COLORS,
} from "@/components/project/designTokens";
import { useHappyAction } from "@/hooks/useHappyAction";
import { useAllMachines, useSetting, useAllSessions } from "@/sync/storage";
import { isMachineOnline } from "@/utils/machineUtils";
import { StatusDot } from "@/components/StatusDot";
import { Ionicons } from "@expo/vector-icons";
import { Modal } from "@/modal";
import { PromptTemplatePicker } from "@/components/kanban/PromptTemplatePicker";
import type { PromptTemplate } from "@/sync/promptTemplateTypes";
import { expandTemplate } from "@/sync/promptTemplateExpand";
import { useIsBoardLayout } from "@/hooks/useIsBoardLayout";

// ---------------------------------------------------------------------------
// Pill selector sub-components
// ---------------------------------------------------------------------------

interface PillOption<T extends string> {
    readonly id: T;
    readonly label: string;
    readonly color: string;
}

interface PillSelectorProps<T extends string> {
    readonly options: ReadonlyArray<PillOption<T>>;
    readonly selected: T;
    readonly onSelect: (id: T) => void;
}

function PillSelector<T extends string>({
    options,
    selected,
    onSelect,
}: PillSelectorProps<T>) {
    const { theme } = useUnistyles();

    return (
        <View
            style={[
                styles.pillTrack,
                { backgroundColor: theme.colors.groupped.background },
            ]}
        >
            {options.map((opt) => {
                const isActive = opt.id === selected;
                return (
                    <Pressable
                        key={opt.id}
                        onPress={() => onSelect(opt.id)}
                        style={[
                            styles.pill,
                            isActive && { backgroundColor: opt.color },
                        ]}
                    >
                        <Text
                            style={[
                                styles.pillText,
                                { color: isActive ? "#FFFFFF" : theme.colors.text },
                            ]}
                            numberOfLines={1}
                        >
                            {opt.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const NewKanbanTask = React.memo(() => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const machines = useAllMachines();
    const recentMachinePaths = useSetting("recentMachinePaths");
    const allSessions = useAllSessions();
    const isWide = useIsBoardLayout();

    // Form state
    const [title, setTitle] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [columnId, setColumnId] = React.useState<KanbanColumnId>("todo");
    const [priority, setPriority] = React.useState<KanbanPriority>("medium");
    const [machineId, setMachineId] = React.useState<string | null>(null);
    const [directory, setDirectory] = React.useState("");
    const [sessionPrompt, setSessionPrompt] = React.useState("");

    // Pill options (memoized once)
    const columnOptions = React.useMemo<ReadonlyArray<PillOption<KanbanColumnId>>>(
        () =>
            KANBAN_COLUMNS.map((col) => ({
                id: col,
                label: t(KANBAN_COLUMN_LABELS[col]),
                color: KANBAN_COLUMN_COLORS[col],
            })),
        [],
    );

    const priorityOptions = React.useMemo<ReadonlyArray<PillOption<KanbanPriority>>>(
        () =>
            KANBAN_PRIORITIES.map((p) => ({
                id: p,
                label: t(KANBAN_PRIORITY_LABELS[p]),
                color: PRIORITY_COLORS[p],
            })),
        [],
    );

    // Pick first online machine by default
    React.useEffect(() => {
        if (!machineId) {
            const online = machines.find((m) => isMachineOnline(m));
            if (online) {
                setMachineId(online.id);
            }
        }
    }, [machines, machineId]);

    const pathSuggestions = React.useMemo(() => {
        if (!machineId) return [];

        const paths = new Set<string>();

        for (const entry of recentMachinePaths ?? []) {
            if (entry.machineId === machineId && entry.path) {
                paths.add(entry.path);
            }
        }

        for (const s of allSessions) {
            if (s.metadata?.machineId === machineId && s.metadata?.path) {
                paths.add(s.metadata.path);
            }
        }

        const current = directory.trim();
        return Array.from(paths)
            .filter((p) => p !== current)
            .slice(0, 5);
    }, [machineId, recentMachinePaths, allSessions, directory]);

    const handlePickTemplate = React.useCallback(() => {
        const onSelect = (template: PromptTemplate) => {
            const expanded = expandTemplate(template.content, {
                title,
                description,
                directory: directory || null,
                tags: [],
            });
            setSessionPrompt(expanded);
        };
        Modal.show({
            component: PromptTemplatePicker,
            props: { onSelect },
        });
    }, [title, description, directory]);

    const [saving, performSave] = useHappyAction(async () => {
        if (!title.trim()) {
            throw { message: t("kanban.titleRequired") };
        }

        await kanbanStore.getState().createTask({
            title: title.trim(),
            description: description.trim(),
            columnId,
            priority,
            machineId,
            directory: directory.trim() || null,
            sessionPrompt: sessionPrompt.trim() || null,
        });

        router.back();
    });

    // -----------------------------------------------------------------------
    // Shared form sections
    // -----------------------------------------------------------------------

    const titleSection = (
        <ItemGroup title={t("kanban.details")}>
            <View
                style={[
                    styles.inputWrapper,
                    { backgroundColor: theme.colors.surface },
                ]}
            >
                <TextInput
                    style={[styles.titleInput, { color: theme.colors.text }]}
                    placeholder={t("kanban.titlePlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={title}
                    onChangeText={setTitle}
                    autoFocus
                />
                <View
                    style={[
                        styles.divider,
                        { backgroundColor: theme.colors.divider },
                    ]}
                />
                <TextInput
                    style={[styles.descriptionInput, { color: theme.colors.text }]}
                    placeholder={t("kanban.descriptionPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                />
            </View>
        </ItemGroup>
    );

    const promptSection = (
        <ItemGroup
            title={t("kanban.sessionPromptLabel")}
            footer={t("kanban.sessionPromptHint")}
        >
            <Pressable
                onPress={handlePickTemplate}
                style={({ pressed }) => [
                    styles.templateButton,
                    { backgroundColor: theme.colors.surface },
                    pressed && { opacity: 0.7 },
                ]}
            >
                <Ionicons
                    name="document-text-outline"
                    size={18}
                    color={theme.colors.header.tint}
                />
                <Text
                    style={[
                        styles.templateButtonText,
                        { color: theme.colors.header.tint },
                    ]}
                >
                    {t("kanban.templates.useTemplate")}
                </Text>
            </Pressable>
            <View
                style={[
                    styles.inputWrapper,
                    { backgroundColor: theme.colors.surface },
                ]}
            >
                <TextInput
                    style={[styles.descriptionInput, { color: theme.colors.text }]}
                    placeholder={t("kanban.sessionPromptPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={sessionPrompt}
                    onChangeText={setSessionPrompt}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                />
            </View>
        </ItemGroup>
    );

    const columnSection = (
        <ItemGroup title={t("kanban.column")}>
            <PillSelector
                options={columnOptions}
                selected={columnId}
                onSelect={setColumnId}
            />
        </ItemGroup>
    );

    const prioritySection = (
        <ItemGroup title={t("kanban.priorityLabel")}>
            <PillSelector
                options={priorityOptions}
                selected={priority}
                onSelect={setPriority}
            />
        </ItemGroup>
    );

    const machineSection = machines.length > 0 ? (
        <ItemGroup title={t("kanban.machine")}>
            {machines.map((m) => {
                const online = isMachineOnline(m);
                return (
                    <Item
                        key={m.id}
                        title={m.metadata?.displayName ?? m.id.substring(0, 8)}
                        subtitle={
                            online
                                ? t("kanban.machineOnline")
                                : t("kanban.machineOffline")
                        }
                        leftElement={
                            <View style={styles.machineIcon}>
                                <Ionicons
                                    name="desktop-outline"
                                    size={20}
                                    color={theme.colors.textSecondary}
                                />
                                <StatusDot
                                    color={
                                        online
                                            ? theme.colors.status.connected
                                            : theme.colors.textSecondary
                                    }
                                    isPulsing={online}
                                    size={8}
                                    style={styles.machineStatusDot}
                                />
                            </View>
                        }
                        onPress={() => setMachineId(m.id)}
                        selected={m.id === machineId}
                        showDivider
                    />
                );
            })}
        </ItemGroup>
    ) : null;

    const directorySection = (
        <ItemGroup
            title={t("kanban.directory")}
            footer={t("kanban.directoryHint")}
        >
            <View
                style={[
                    styles.inputWrapper,
                    { backgroundColor: theme.colors.surface },
                ]}
            >
                <TextInput
                    style={[styles.singleInput, { color: theme.colors.text }]}
                    placeholder="/path/to/project"
                    placeholderTextColor={theme.colors.textSecondary}
                    value={directory}
                    onChangeText={setDirectory}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
            </View>
            {pathSuggestions.length > 0 && (
                <View style={styles.pathSuggestions}>
                    {pathSuggestions.map((path) => (
                        <Pressable
                            key={path}
                            onPress={() => setDirectory(path)}
                            style={({ pressed }) => [
                                styles.pathSuggestionItem,
                                { backgroundColor: theme.colors.surface },
                                pressed && { opacity: 0.7 },
                            ]}
                        >
                            <Ionicons
                                name="folder-outline"
                                size={16}
                                color={theme.colors.textSecondary}
                            />
                            <Text
                                style={[
                                    styles.pathSuggestionText,
                                    { color: theme.colors.text },
                                ]}
                                numberOfLines={1}
                            >
                                {path}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            )}
        </ItemGroup>
    );

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: theme.colors.groupped.background },
            ]}
        >
            <Header
                title={t("kanban.newTask")}
                headerLeft={() => (
                    <Pressable onPress={router.back} hitSlop={15}>
                        <Text
                            style={[
                                styles.cancelButton,
                                { color: theme.colors.header.tint },
                            ]}
                        >
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                )}
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
                contentContainerStyle={[
                    { paddingBottom: insets.bottom + 24 },
                    isWide && styles.wideScrollContent,
                ]}
                keyboardDismissMode="on-drag"
            >
                {isWide ? (
                    <View style={styles.twoColumnRow}>
                        {/* Left column: text-heavy inputs */}
                        <View style={styles.columnLeft}>
                            {titleSection}
                            {promptSection}
                        </View>
                        {/* Right column: selections & config */}
                        <View style={styles.columnRight}>
                            {columnSection}
                            {prioritySection}
                            {machineSection}
                            {directorySection}
                        </View>
                    </View>
                ) : (
                    <>
                        {titleSection}
                        {columnSection}
                        {prioritySection}
                        {machineSection}
                        {directorySection}
                        {promptSection}
                    </>
                )}
            </ScrollView>
        </View>
    );
});

export default NewKanbanTask;

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    cancelButton: {
        fontSize: 17,
        ...Typography.default(),
    },
    saveButton: {
        fontSize: 17,
        ...Typography.default("semiBold"),
    },

    // Two-column layout (wide)
    wideScrollContent: {
        maxWidth: 900,
        alignSelf: "center",
        width: "100%",
    },
    twoColumnRow: {
        flexDirection: "row",
        gap: 16,
    },
    columnLeft: {
        flex: 3,
    },
    columnRight: {
        flex: 2,
    },

    // Pill selector
    pillTrack: {
        flexDirection: "row",
        borderRadius: 10,
        padding: 3,
        gap: 2,
    },
    pill: {
        flex: 1,
        alignItems: "center",
        paddingVertical: 8,
        borderRadius: 8,
    },
    pillText: {
        fontSize: 13,
        ...Typography.default("semiBold"),
    },

    // Form inputs
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
    singleInput: {
        fontSize: 15,
        paddingHorizontal: 16,
        paddingVertical: 12,
        ...Typography.default(),
    },
    machineIcon: {
        width: 28,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
    },
    machineStatusDot: {
        position: "absolute",
        bottom: -1,
        right: -1,
    },
    pathSuggestions: {
        marginTop: 4,
        gap: 2,
    },
    pathSuggestionItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        gap: 8,
    },
    pathSuggestionText: {
        flex: 1,
        fontSize: 13,
        ...Typography.mono(),
    },
    templateButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 10,
        borderRadius: 10,
        marginBottom: 8,
        gap: 6,
    },
    templateButtonText: {
        fontSize: 14,
        ...Typography.default("semiBold"),
    },
}));
