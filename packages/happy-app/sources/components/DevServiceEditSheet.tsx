/**
 * Modal sheet for editing or creating a dev service configuration.
 *
 * Presented as a pageSheet modal with sectioned form:
 * - Basic info (name, port)
 * - Launch modes (multiple modes with command/cwd/port/env each)
 * - Dependencies (multi-select tags)
 * - Config files (list + add)
 * - Port mapping (Caddy hostname, Tailscale funnel toggle)
 */

import * as React from "react";
import {
    View,
    ScrollView,
    Pressable,
    TextInput,
    Modal,
    SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { FilePickerModal } from "@/components/FilePickerModal";
import type { DevService, DevConfigFile, DevExposeConfig, DevServiceMode } from "@/utils/devYmlParser";

type ModeEditState = {
    readonly label: string;
    readonly command: string;
    readonly cwd: string;
    readonly port: string;
};

type Props = {
    readonly service: DevService | null;
    readonly allServiceKeys: readonly string[];
    readonly onSave: (updated: DevService) => void;
    readonly onClose: () => void;
    readonly sessionId: string;
};

function initModes(service: DevService | null): Record<string, ModeEditState> {
    if (service?.modes && Object.keys(service.modes).length > 0) {
        const result: Record<string, ModeEditState> = {};
        for (const [k, m] of Object.entries(service.modes)) {
            result[k] = {
                label: m.label,
                command: m.command,
                cwd: m.cwd ?? "",
                port: m.port != null ? String(m.port) : "",
            };
        }
        return result;
    }
    // Legacy single-command service → convert to one "local" mode
    return {
        local: {
            label: "Local",
            command: service?.command ?? "",
            cwd: service?.cwd ?? "",
            port: "",
        },
    };
}

function DevServiceEditSheetInner({ service, allServiceKeys, onSave, onClose, sessionId }: Props) {
    const { theme } = useUnistyles();
    const isNew = service === null;

    // Form state
    const [key, setKey] = React.useState(service?.key ?? "");
    const [name, setName] = React.useState(service?.name ?? "");
    const [portText, setPortText] = React.useState(
        service?.port != null ? String(service.port) : "",
    );

    // Modes
    const [modes, setModes] = React.useState<Record<string, ModeEditState>>(() => initModes(service));
    const [activeMode, setActiveMode] = React.useState<string>(
        service?.activeMode ?? Object.keys(initModes(service))[0] ?? "local",
    );
    const [expandedMode, setExpandedMode] = React.useState<string | null>(
        Object.keys(initModes(service))[0] ?? null,
    );

    // Dependencies
    const [selectedDeps, setSelectedDeps] = React.useState<readonly string[]>(
        service?.depends_on ?? [],
    );

    // Config files
    const [configFiles, setConfigFiles] = React.useState<readonly DevConfigFile[]>(
        service?.configFiles ?? [],
    );
    const [newFilePath, setNewFilePath] = React.useState("");
    const [newFileLabel, setNewFileLabel] = React.useState("");

    // Expose (Caddy only)
    const [caddyHostname, setCaddyHostname] = React.useState(
        service?.expose?.caddy?.hostname ?? "",
    );

    // File picker
    const [showFilePicker, setShowFilePicker] = React.useState(false);

    // Available deps: all service keys except self
    const availableDeps = React.useMemo(
        () => allServiceKeys.filter((k) => k !== (service?.key ?? key)),
        [allServiceKeys, service, key],
    );

    const modeKeys = Object.keys(modes);

    const toggleDep = React.useCallback((dep: string) => {
        setSelectedDeps((prev) =>
            prev.includes(dep) ? prev.filter((d) => d !== dep) : [...prev, dep],
        );
    }, []);

    const handleAddConfigFile = React.useCallback(() => {
        if (!newFilePath.trim()) return;
        const newFile: DevConfigFile = {
            path: newFilePath.trim(),
            label: newFileLabel.trim() || newFilePath.trim(),
        };
        setConfigFiles((prev) => [...prev, newFile]);
        setNewFilePath("");
        setNewFileLabel("");
    }, [newFilePath, newFileLabel]);

    const handleRemoveConfigFile = React.useCallback((index: number) => {
        setConfigFiles((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const updateMode = React.useCallback((modeKey: string, field: keyof ModeEditState, value: string) => {
        setModes((prev) => ({
            ...prev,
            [modeKey]: { ...prev[modeKey], [field]: value },
        }));
    }, []);

    const handleAddMode = React.useCallback(() => {
        const newKey = `mode${modeKeys.length + 1}`;
        setModes((prev) => ({
            ...prev,
            [newKey]: { label: "Docker", command: "", cwd: "", port: "" },
        }));
        setExpandedMode(newKey);
    }, [modeKeys.length]);

    const handleRemoveMode = React.useCallback((modeKey: string) => {
        setModes((prev) => {
            const next = { ...prev };
            delete next[modeKey];
            return next;
        });
        if (activeMode === modeKey) {
            const remaining = modeKeys.filter((k) => k !== modeKey);
            setActiveMode(remaining[0] ?? "");
        }
        if (expandedMode === modeKey) {
            setExpandedMode(null);
        }
    }, [activeMode, modeKeys, expandedMode]);

    const handleSave = React.useCallback(() => {
        const port = parseInt(portText, 10);

        const expose: DevExposeConfig | undefined =
            caddyHostname.trim()
                ? { caddy: { hostname: caddyHostname.trim() } }
                : undefined;

        // Build modes for the service
        const builtModes: Record<string, DevServiceMode> = {};
        for (const [mk, ms] of Object.entries(modes)) {
            if (!ms.command.trim()) continue;
            const modePort = parseInt(ms.port, 10);
            builtModes[mk] = {
                label: ms.label.trim() || mk,
                command: ms.command.trim(),
                ...(ms.cwd.trim() ? { cwd: ms.cwd.trim() } : {}),
                ...(Number.isInteger(modePort) && modePort > 0 ? { port: modePort } : {}),
            };
        }

        const validModeKeys = Object.keys(builtModes);
        const useModes = validModeKeys.length >= 2;
        const singleMode = validModeKeys.length === 1 ? builtModes[validModeKeys[0]] : null;

        const updated: DevService = {
            key: isNew ? key.trim() || name.trim().toLowerCase().replace(/\s+/g, "-") : service!.key,
            name: name.trim(),
            // Single mode → flat format; multi mode → modes format
            ...(useModes
                ? {
                    modes: builtModes,
                    activeMode: validModeKeys.includes(activeMode) ? activeMode : validModeKeys[0],
                }
                : {
                    command: singleMode?.command ?? "",
                    ...(singleMode?.cwd ? { cwd: singleMode.cwd } : {}),
                }),
            ...(Number.isInteger(port) && port > 0 ? { port } : {}),
            ...(selectedDeps.length > 0 ? { depends_on: selectedDeps } : {}),
            ...(configFiles.length > 0 ? { configFiles } : {}),
            ...(expose ? { expose } : {}),
        };

        onSave(updated);
    }, [
        isNew, service, key, name, portText, modes, activeMode,
        selectedDeps, configFiles, caddyHostname, onSave,
    ]);

    const isValid = name.trim().length > 0 && Object.values(modes).some((m) => m.command.trim().length > 0);

    return (
        <Modal
            visible
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <SafeAreaView
                style={[styles.container, { backgroundColor: theme.colors.surface }]}
            >
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
                    <Pressable onPress={onClose} hitSlop={10}>
                        <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                    </Pressable>
                    <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                        {isNew ? "New Service" : `Edit ${service!.name}`}
                    </Text>
                    <Pressable
                        onPress={handleSave}
                        disabled={!isValid}
                        hitSlop={10}
                    >
                        <Text
                            style={[
                                styles.saveButton,
                                { color: isValid ? theme.colors.textLink : theme.colors.textSecondary },
                            ]}
                        >
                            Save
                        </Text>
                    </Pressable>
                </View>

                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                >
                    {/* Basic Info */}
                    <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                        BASIC INFO
                    </Text>
                    <View style={[styles.formGroup, { backgroundColor: theme.colors.surfaceHigh }]}>
                        {isNew && (
                            <View style={[styles.fieldRow, { borderBottomColor: theme.colors.divider }]}>
                                <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>Key</Text>
                                <TextInput
                                    style={[styles.fieldInput, { color: theme.colors.text }]}
                                    value={key}
                                    onChangeText={setKey}
                                    placeholder="service-key"
                                    placeholderTextColor={theme.colors.textSecondary}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            </View>
                        )}
                        <View style={[styles.fieldRow, { borderBottomColor: theme.colors.divider }]}>
                            <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>Name</Text>
                            <TextInput
                                style={[styles.fieldInput, { color: theme.colors.text }]}
                                value={name}
                                onChangeText={setName}
                                placeholder="Java Backend"
                                placeholderTextColor={theme.colors.textSecondary}
                                autoFocus={isNew}
                            />
                        </View>
                        <View style={styles.fieldRowLast}>
                            <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>Port</Text>
                            <TextInput
                                style={[styles.fieldInput, { color: theme.colors.text }]}
                                value={portText}
                                onChangeText={setPortText}
                                placeholder="8080 (shared default)"
                                placeholderTextColor={theme.colors.textSecondary}
                                keyboardType="number-pad"
                            />
                        </View>
                    </View>

                    {/* Launch Modes */}
                    <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                        LAUNCH MODES
                    </Text>
                    <View style={[styles.formGroup, { backgroundColor: theme.colors.surfaceHigh }]}>
                        {modeKeys.map((modeKey, idx) => {
                            const mode = modes[modeKey];
                            const isExpanded = expandedMode === modeKey;
                            const isActive = modeKey === activeMode;
                            const isLast = idx === modeKeys.length - 1;
                            const canDelete = modeKeys.length > 1;

                            return (
                                <View key={modeKey}>
                                    {/* Mode header — tap to expand/collapse */}
                                    <Pressable
                                        style={[
                                            styles.modeHeader,
                                            !isExpanded && !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider },
                                        ]}
                                        onPress={() => setExpandedMode(isExpanded ? null : modeKey)}
                                    >
                                        <Pressable
                                            style={[
                                                styles.modeRadio,
                                                {
                                                    borderColor: isActive ? theme.colors.textLink : theme.colors.divider,
                                                    backgroundColor: isActive ? theme.colors.textLink : "transparent",
                                                },
                                            ]}
                                            onPress={() => setActiveMode(modeKey)}
                                        >
                                            {isActive && (
                                                <View style={styles.modeRadioInner} />
                                            )}
                                        </Pressable>
                                        <View style={styles.modeHeaderText}>
                                            <Text style={[styles.modeKey, { color: theme.colors.text }]}>
                                                {modeKey}
                                            </Text>
                                            <Text style={[styles.modeLabel, { color: theme.colors.textSecondary }]}>
                                                {mode.label || modeKey}
                                            </Text>
                                        </View>
                                        <View style={styles.modeHeaderRight}>
                                            {canDelete && (
                                                <Pressable
                                                    onPress={() => handleRemoveMode(modeKey)}
                                                    hitSlop={8}
                                                >
                                                    <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                                                </Pressable>
                                            )}
                                            <Ionicons
                                                name={isExpanded ? "chevron-up" : "chevron-down"}
                                                size={16}
                                                color={theme.colors.textSecondary}
                                            />
                                        </View>
                                    </Pressable>

                                    {/* Expanded mode fields */}
                                    {isExpanded && (
                                        <View style={[styles.modeFields, { borderBottomColor: isLast ? "transparent" : theme.colors.divider }]}>
                                            <View style={[styles.modeFieldRow, { borderBottomColor: theme.colors.divider }]}>
                                                <Text style={[styles.modeFieldLabel, { color: theme.colors.textSecondary }]}>Label</Text>
                                                <TextInput
                                                    style={[styles.fieldInput, { color: theme.colors.text }]}
                                                    value={mode.label}
                                                    onChangeText={(v) => updateMode(modeKey, "label", v)}
                                                    placeholder="Local Dev"
                                                    placeholderTextColor={theme.colors.textSecondary}
                                                />
                                            </View>
                                            <View style={[styles.modeFieldColumn, { borderBottomColor: theme.colors.divider }]}>
                                                <Text style={[styles.modeFieldLabel, { color: theme.colors.textSecondary }]}>Command</Text>
                                                <TextInput
                                                    style={[styles.fieldInputMultiline, { color: theme.colors.text }]}
                                                    value={mode.command}
                                                    onChangeText={(v) => updateMode(modeKey, "command", v)}
                                                    placeholder="yarn serve"
                                                    placeholderTextColor={theme.colors.textSecondary}
                                                    autoCapitalize="none"
                                                    autoCorrect={false}
                                                    multiline
                                                    numberOfLines={2}
                                                />
                                            </View>
                                            <View style={[styles.modeFieldRow, { borderBottomColor: theme.colors.divider }]}>
                                                <Text style={[styles.modeFieldLabel, { color: theme.colors.textSecondary }]}>Working Dir</Text>
                                                <TextInput
                                                    style={[styles.fieldInput, { color: theme.colors.text, fontFamily: "Menlo", fontSize: 13 }]}
                                                    value={mode.cwd}
                                                    onChangeText={(v) => updateMode(modeKey, "cwd", v)}
                                                    placeholder="./backend"
                                                    placeholderTextColor={theme.colors.textSecondary}
                                                    autoCapitalize="none"
                                                    autoCorrect={false}
                                                />
                                            </View>
                                            <View style={styles.modeFieldRowLast}>
                                                <Text style={[styles.modeFieldLabel, { color: theme.colors.textSecondary }]}>Port</Text>
                                                <TextInput
                                                    style={[styles.fieldInput, { color: theme.colors.text }]}
                                                    value={mode.port}
                                                    onChangeText={(v) => updateMode(modeKey, "port", v)}
                                                    placeholder="Override"
                                                    placeholderTextColor={theme.colors.textSecondary}
                                                    keyboardType="number-pad"
                                                />
                                            </View>
                                        </View>
                                    )}
                                </View>
                            );
                        })}

                        {/* Add mode button */}
                        <Pressable
                            style={[styles.addModeButton, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider }]}
                            onPress={handleAddMode}
                        >
                            <Ionicons name="add" size={16} color={theme.colors.textLink} />
                            <Text style={{ fontSize: 13, color: theme.colors.textLink }}>
                                Add Mode
                            </Text>
                        </Pressable>
                    </View>

                    {/* Dependencies */}
                    {availableDeps.length > 0 && (
                        <>
                            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                                DEPENDENCIES
                            </Text>
                            <View style={[styles.formGroup, { backgroundColor: theme.colors.surfaceHigh }]}>
                                <View style={styles.tagsContainer}>
                                    {availableDeps.map((dep) => {
                                        const isSelected = selectedDeps.includes(dep);
                                        return (
                                            <Pressable
                                                key={dep}
                                                style={[
                                                    styles.tag,
                                                    {
                                                        backgroundColor: isSelected
                                                            ? `${theme.colors.textLink}20`
                                                            : theme.colors.surface,
                                                        borderColor: isSelected
                                                            ? theme.colors.textLink
                                                            : theme.colors.divider,
                                                    },
                                                ]}
                                                onPress={() => toggleDep(dep)}
                                            >
                                                <Text
                                                    style={[
                                                        styles.tagText,
                                                        {
                                                            color: isSelected
                                                                ? theme.colors.textLink
                                                                : theme.colors.text,
                                                        },
                                                    ]}
                                                >
                                                    {dep}
                                                </Text>
                                                {isSelected && (
                                                    <Ionicons
                                                        name="checkmark"
                                                        size={14}
                                                        color={theme.colors.textLink}
                                                    />
                                                )}
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            </View>
                        </>
                    )}

                    {/* Config Files */}
                    <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                        CONFIG FILES
                    </Text>
                    <View style={[styles.formGroup, { backgroundColor: theme.colors.surfaceHigh }]}>
                        {configFiles.map((cf, index) => (
                            <View
                                key={`${cf.path}-${index}`}
                                style={[styles.configFileRow, { borderBottomColor: theme.colors.divider }]}
                            >
                                <View style={styles.configFileInfo}>
                                    <Text style={[styles.configFileLabel, { color: theme.colors.text }]}>
                                        {cf.label}
                                    </Text>
                                    <Text style={[styles.configFilePath, { color: theme.colors.textSecondary }]}>
                                        {cf.path}
                                    </Text>
                                </View>
                                <Pressable onPress={() => handleRemoveConfigFile(index)} hitSlop={8}>
                                    <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                                </Pressable>
                            </View>
                        ))}
                        <View style={styles.addConfigSection}>
                            <View style={styles.pathInputRow}>
                                <TextInput
                                    style={[styles.configInput, { flex: 1, borderColor: theme.colors.divider, color: theme.colors.text, backgroundColor: theme.colors.surface }]}
                                    value={newFilePath}
                                    onChangeText={setNewFilePath}
                                    placeholder="File path (e.g. .env)"
                                    placeholderTextColor={theme.colors.textSecondary}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                                <Pressable
                                    style={[styles.browseButton, { backgroundColor: `${theme.colors.textLink}12` }]}
                                    onPress={() => setShowFilePicker(true)}
                                    hitSlop={4}
                                >
                                    <Ionicons name="folder-open-outline" size={16} color={theme.colors.textLink} />
                                </Pressable>
                            </View>
                            <TextInput
                                style={[styles.configInput, { borderColor: theme.colors.divider, color: theme.colors.text, backgroundColor: theme.colors.surface }]}
                                value={newFileLabel}
                                onChangeText={setNewFileLabel}
                                placeholder="Label (optional)"
                                placeholderTextColor={theme.colors.textSecondary}
                            />
                            <Pressable
                                style={[
                                    styles.addFileButton,
                                    {
                                        backgroundColor: newFilePath.trim()
                                            ? `${theme.colors.textLink}15`
                                            : theme.colors.surface,
                                    },
                                ]}
                                onPress={handleAddConfigFile}
                                disabled={!newFilePath.trim()}
                            >
                                <Ionicons
                                    name="add"
                                    size={16}
                                    color={newFilePath.trim() ? theme.colors.textLink : theme.colors.textSecondary}
                                />
                                <Text
                                    style={{
                                        fontSize: 13,
                                        color: newFilePath.trim() ? theme.colors.textLink : theme.colors.textSecondary,
                                    }}
                                >
                                    Add File
                                </Text>
                            </Pressable>
                        </View>
                    </View>

                    {/* Expose / Port Mapping */}
                    <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                        PORT MAPPING
                    </Text>
                    <View style={[styles.formGroup, { backgroundColor: theme.colors.surfaceHigh }]}>
                        <View style={styles.fieldRowLast}>
                            <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>
                                Caddy Hostname
                            </Text>
                            <TextInput
                                style={[styles.fieldInput, { color: theme.colors.text, fontFamily: "Menlo", fontSize: 13 }]}
                                value={caddyHostname}
                                onChangeText={setCaddyHostname}
                                placeholder="api.example.dev"
                                placeholderTextColor={theme.colors.textSecondary}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                        </View>
                    </View>

                    <View style={styles.bottomSpacer} />
                </ScrollView>

                {/* File picker overlay */}
                <FilePickerModal
                    visible={showFilePicker}
                    sessionId={sessionId}
                    onSelect={(filePath) => {
                        setNewFilePath(filePath);
                        const filename = filePath.split("/").pop() ?? filePath;
                        setNewFileLabel(filename.replace(/\.[^.]+$/, ""));
                        setShowFilePicker(false);
                    }}
                    onClose={() => setShowFilePicker(false)}
                />
            </SafeAreaView>
        </Modal>
    );
}

export const DevServiceEditSheet = React.memo(DevServiceEditSheetInner);

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: "600",
        ...Typography.default("semiBold"),
    },
    saveButton: {
        fontSize: 17,
        fontWeight: "600",
        ...Typography.default("semiBold"),
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 16,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: "500",
        marginTop: 24,
        marginBottom: 8,
        marginLeft: 4,
        letterSpacing: 0.5,
    },
    formGroup: {
        borderRadius: 10,
        overflow: "hidden",
    },
    fieldRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    fieldRowLast: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    fieldLabel: {
        fontSize: 15,
        width: 100,
        flexShrink: 0,
    },
    fieldInput: {
        flex: 1,
        fontSize: 15,
        textAlign: "right",
        paddingVertical: 0,
    },
    fieldInputMultiline: {
        fontSize: 13,
        fontFamily: "Menlo",
        paddingVertical: 6,
        marginTop: 4,
        minHeight: 44,
        textAlignVertical: "top",
    },
    // Mode editing styles
    modeHeader: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 10,
    },
    modeRadio: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
    },
    modeRadioInner: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: "#fff",
    },
    modeHeaderText: {
        flex: 1,
    },
    modeKey: {
        fontSize: 14,
        fontWeight: "600",
        ...Typography.default("semiBold"),
    },
    modeLabel: {
        fontSize: 12,
        marginTop: 1,
    },
    modeHeaderRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    modeFields: {
        paddingLeft: 46,
        paddingRight: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    modeFieldRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    modeFieldRowLast: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 8,
    },
    modeFieldColumn: {
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    modeFieldLabel: {
        fontSize: 13,
        width: 80,
        flexShrink: 0,
    },
    addModeButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        paddingVertical: 10,
    },
    tagsContainer: {
        flexDirection: "row",
        flexWrap: "wrap",
        padding: 12,
        gap: 8,
    },
    tag: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
    },
    tagText: {
        fontSize: 13,
        fontWeight: "500",
    },
    configFileRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    configFileInfo: {
        flex: 1,
        marginRight: 12,
    },
    configFileLabel: {
        fontSize: 14,
        fontWeight: "500",
    },
    configFilePath: {
        fontSize: 11,
        fontFamily: "Menlo",
        marginTop: 2,
    },
    addConfigSection: {
        padding: 12,
        gap: 8,
    },
    pathInputRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    browseButton: {
        width: 36,
        height: 36,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    configInput: {
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        fontSize: 14,
    },
    addFileButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        paddingVertical: 8,
        borderRadius: 8,
    },
    bottomSpacer: {
        height: 40,
    },
}));
