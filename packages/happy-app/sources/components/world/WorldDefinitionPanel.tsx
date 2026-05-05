import * as React from "react";
import { View, Animated, TextInput, TouchableOpacity } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateSupervisorConfig } from "@/sync/apiSupervisor";
import { projectManager } from "@/sync/projectManager";
import { useProjects } from "@/sync/storage";

type PolicyMode = "disabled" | "suggest" | "semi-auto" | "auto";
const POLICY_OPTIONS: PolicyMode[] = ["disabled", "suggest", "semi-auto", "auto"];

interface WorldDefinitionPanelProps {
    visible: boolean;
}

export const WorldDefinitionPanel = React.memo(function WorldDefinitionPanel({
    visible,
}: WorldDefinitionPanelProps) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const anim = React.useRef(new Animated.Value(visible ? 1 : 0)).current;

    const projects = useProjects();
    const activeProjects = React.useMemo(
        () => projects.filter((p) => !p.archived && p.serverId),
        [projects],
    );

    const [selectedIdx, setSelectedIdx] = React.useState(0);
    const selectedProject = activeProjects[selectedIdx] ?? null;

    const [laws, setLaws] = React.useState("");
    const [policy, setPolicy] = React.useState<PolicyMode>("suggest");
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        if (!selectedProject) return;
        setLaws(selectedProject.supervisorCustomRules ?? "");
        setPolicy((selectedProject.supervisorMode as PolicyMode) ?? "suggest");
    }, [selectedProject?.id, selectedProject?.supervisorCustomRules, selectedProject?.supervisorMode]);

    React.useEffect(() => {
        Animated.timing(anim, {
            toValue: visible ? 1 : 0,
            duration: 200,
            useNativeDriver: false,
        }).start();
    }, [visible, anim]);

    const handleSave = React.useCallback(async () => {
        if (!selectedProject?.serverId) return;
        setSaving(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            await updateSupervisorConfig(
                credentials,
                selectedProject.serverId,
                null,
                {
                    supervisorMode: policy,
                    supervisorCustomRules: laws.trim() || null,
                },
            );

            const local = projectManager.getProject(selectedProject.id);
            if (local) {
                local.supervisorMode = policy;
                local.supervisorCustomRules = laws.trim() || null;
            }
        } finally {
            setSaving(false);
        }
    }, [selectedProject, policy, laws]);

    const cyclePolicy = React.useCallback(() => {
        setPolicy((prev) => {
            const idx = POLICY_OPTIONS.indexOf(prev);
            return POLICY_OPTIONS[(idx + 1) % POLICY_OPTIONS.length];
        });
    }, []);

    const projectLabel = selectedProject
        ? (selectedProject.key?.path?.split("/").filter(Boolean).pop() ?? selectedProject.id.slice(0, 10))
        : "—";

    const cycleProject = React.useCallback(() => {
        if (activeProjects.length <= 1) return;
        setSelectedIdx((i) => (i + 1) % activeProjects.length);
    }, [activeProjects.length]);

    const hasChanges = selectedProject
        ? laws !== (selectedProject.supervisorCustomRules ?? "") || policy !== (selectedProject.supervisorMode ?? "suggest")
        : false;

    return (
        <Animated.View
            style={[
                styles.panel,
                {
                    maxHeight: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 400],
                    }),
                    opacity: anim,
                    overflow: "hidden",
                },
            ]}
        >
            <View style={styles.inner}>
                {/* Project Selector */}
                <TouchableOpacity style={styles.projectRow} onPress={cycleProject} activeOpacity={0.7}>
                    <Ionicons name="folder-outline" size={14} color={theme.colors.textSecondary} />
                    <Text style={styles.projectLabel}>{projectLabel}</Text>
                    {activeProjects.length > 1 && (
                        <Ionicons name="swap-horizontal" size={12} color={theme.colors.textSecondary} />
                    )}
                </TouchableOpacity>

                {/* Policy */}
                <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{t("world.policy")}</Text>
                    <TouchableOpacity style={styles.policyButton} onPress={cyclePolicy} activeOpacity={0.7}>
                        <Text style={styles.policyText}>{policy}</Text>
                        <Ionicons name="chevron-forward" size={12} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                </View>

                {/* Laws (customRules) */}
                <View style={styles.fieldColumn}>
                    <Text style={styles.fieldLabel}>{t("world.laws")}</Text>
                    <TextInput
                        style={styles.lawsInput}
                        value={laws}
                        onChangeText={setLaws}
                        placeholder={t("world.notSet")}
                        placeholderTextColor={theme.colors.textSecondary}
                        multiline
                        numberOfLines={3}
                    />
                </View>

                {/* Save */}
                {hasChanges && (
                    <TouchableOpacity
                        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                        onPress={handleSave}
                        disabled={saving}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="checkmark" size={16} color="#fff" />
                        <Text style={styles.saveText}>{saving ? "..." : "Save"}</Text>
                    </TouchableOpacity>
                )}
            </View>
        </Animated.View>
    );
});

const useStyles = () => {
    const { theme } = useUnistyles();
    const styles = StyleSheet.create({
        panel: {
            backgroundColor: theme.colors.surfaceHighest,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.divider,
        },
        inner: {
            paddingHorizontal: 16,
            paddingVertical: 12,
            gap: 10,
        },
        projectRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingBottom: 6,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.divider,
        },
        projectLabel: {
            flex: 1,
            fontSize: 13,
            fontWeight: "600",
            color: theme.colors.text,
        },
        fieldRow: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
        },
        fieldColumn: {
            gap: 4,
        },
        fieldLabel: {
            fontSize: 12,
            color: theme.colors.textSecondary,
        },
        policyButton: {
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 12,
            backgroundColor: theme.colors.surfaceHigh,
        },
        policyText: {
            fontSize: 13,
            color: theme.colors.text,
        },
        lawsInput: {
            fontSize: 13,
            color: theme.colors.text,
            backgroundColor: theme.colors.surfaceHigh,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
            minHeight: 60,
            textAlignVertical: "top",
        },
        saveButton: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor: theme.colors.primary,
        },
        saveButtonDisabled: {
            opacity: 0.5,
        },
        saveText: {
            fontSize: 14,
            fontWeight: "600",
            color: "#fff",
        },
    });
    return { styles };
};
