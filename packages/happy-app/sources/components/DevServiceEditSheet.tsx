/**
 * Modal sheet for editing or creating a dev service configuration.
 *
 * Presented as a pageSheet modal with sectioned form:
 * - Basic info (name, command, cwd, port)
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
import { RoundButton } from "@/components/RoundButton";
import type { DevService, DevConfigFile, DevExposeConfig } from "@/utils/devYmlParser";

type Props = {
    readonly service: DevService | null;
    readonly allServiceKeys: readonly string[];
    readonly onSave: (updated: DevService) => void;
    readonly onClose: () => void;
    readonly onBrowse?: () => void;
};

function DevServiceEditSheetInner({ service, allServiceKeys, onSave, onClose, onBrowse }: Props) {
    const { theme } = useUnistyles();
    const isNew = service === null;

    // Form state
    const [key, setKey] = React.useState(service?.key ?? "");
    const [name, setName] = React.useState(service?.name ?? "");
    const [command, setCommand] = React.useState(service?.command ?? "");
    const [cwd, setCwd] = React.useState(service?.cwd ?? "");
    const [portText, setPortText] = React.useState(
        service?.port != null ? String(service.port) : "",
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

    // Available deps: all service keys except self
    const availableDeps = React.useMemo(
        () => allServiceKeys.filter((k) => k !== (service?.key ?? key)),
        [allServiceKeys, service, key],
    );

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

    const handleSave = React.useCallback(() => {
        const port = parseInt(portText, 10);

        const expose: DevExposeConfig | undefined =
            caddyHostname.trim()
                ? { caddy: { hostname: caddyHostname.trim() } }
                : undefined;

        const updated: DevService = {
            key: isNew ? key.trim() || name.trim().toLowerCase().replace(/\s+/g, "-") : service!.key,
            name: name.trim(),
            command: command.trim(),
            ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
            ...(Number.isInteger(port) && port > 0 ? { port } : {}),
            ...(selectedDeps.length > 0 ? { depends_on: selectedDeps } : {}),
            ...(configFiles.length > 0 ? { configFiles } : {}),
            ...(expose ? { expose } : {}),
        };

        onSave(updated);
    }, [
        isNew, service, key, name, command, cwd, portText,
        selectedDeps, configFiles, caddyHostname, onSave,
    ]);

    const isValid = name.trim().length > 0 && command.trim().length > 0;

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
                        <View style={[styles.fieldColumn, { borderBottomColor: theme.colors.divider }]}>
                            <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>Command</Text>
                            <TextInput
                                style={[styles.fieldInputMultiline, { color: theme.colors.text }]}
                                value={command}
                                onChangeText={setCommand}
                                placeholder="mvn spring-boot:run"
                                placeholderTextColor={theme.colors.textSecondary}
                                autoCapitalize="none"
                                autoCorrect={false}
                                multiline
                                numberOfLines={3}
                            />
                        </View>
                        <View style={[styles.fieldRow, { borderBottomColor: theme.colors.divider }]}>
                            <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>Working Dir</Text>
                            <TextInput
                                style={[styles.fieldInput, { color: theme.colors.text, fontFamily: "Menlo", fontSize: 13 }]}
                                value={cwd}
                                onChangeText={setCwd}
                                placeholder="./backend"
                                placeholderTextColor={theme.colors.textSecondary}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                        </View>
                        <View style={styles.fieldRowLast}>
                            <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>Port</Text>
                            <TextInput
                                style={[styles.fieldInput, { color: theme.colors.text }]}
                                value={portText}
                                onChangeText={setPortText}
                                placeholder="8080"
                                placeholderTextColor={theme.colors.textSecondary}
                                keyboardType="number-pad"
                            />
                        </View>
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
                                    onPress={onBrowse}
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
    fieldColumn: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    fieldInputMultiline: {
        fontSize: 13,
        fontFamily: "Menlo",
        paddingVertical: 6,
        marginTop: 6,
        minHeight: 60,
        textAlignVertical: "top",
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
