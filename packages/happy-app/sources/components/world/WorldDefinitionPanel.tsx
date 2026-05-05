import * as React from "react";
import { View, Animated, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { kvGet, kvSet } from "@/sync/apiKv";

const WORLD_CONFIG_KEY = "world.config";

type PolicyMode = "disabled" | "suggest" | "semi-auto" | "auto";
const POLICY_OPTIONS: PolicyMode[] = ["disabled", "suggest", "semi-auto", "auto"];

interface WorldConfig {
    narrative: string;
    laws: string;
    policy: PolicyMode;
}

interface WorldDefinitionPanelProps {
    visible: boolean;
}

export const WorldDefinitionPanel = React.memo(function WorldDefinitionPanel({
    visible,
}: WorldDefinitionPanelProps) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const anim = React.useRef(new Animated.Value(visible ? 1 : 0)).current;

    const [narrative, setNarrative] = React.useState("");
    const [laws, setLaws] = React.useState("");
    const [policy, setPolicy] = React.useState<PolicyMode>("suggest");
    const [savedVersion, setSavedVersion] = React.useState(-1);
    const [loading, setLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);

    // Load global world config from KV on mount
    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || cancelled) return;
                const item = await kvGet(credentials, WORLD_CONFIG_KEY);
                if (cancelled) return;
                if (item) {
                    try {
                        const cfg = JSON.parse(item.value) as Partial<WorldConfig>;
                        setNarrative(cfg.narrative ?? "");
                        setLaws(cfg.laws ?? "");
                        setPolicy(cfg.policy ?? "suggest");
                        setSavedVersion(item.version);
                    } catch {
                        // ignore parse errors, keep defaults
                    }
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    React.useEffect(() => {
        Animated.timing(anim, {
            toValue: visible ? 1 : 0,
            duration: 200,
            useNativeDriver: false,
        }).start();
    }, [visible, anim]);

    const handleSave = React.useCallback(async () => {
        setSaving(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const config: WorldConfig = {
                narrative: narrative.trim(),
                laws: laws.trim(),
                policy,
            };
            const newVersion = await kvSet(
                credentials,
                WORLD_CONFIG_KEY,
                JSON.stringify(config),
                savedVersion,
            );
            setSavedVersion(newVersion);
        } finally {
            setSaving(false);
        }
    }, [narrative, laws, policy, savedVersion]);

    const cyclePolicy = React.useCallback(() => {
        setPolicy((prev) => {
            const idx = POLICY_OPTIONS.indexOf(prev);
            return POLICY_OPTIONS[(idx + 1) % POLICY_OPTIONS.length];
        });
    }, []);

    return (
        <Animated.View
            style={[
                styles.panel,
                {
                    maxHeight: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 480],
                    }),
                    opacity: anim,
                    overflow: "hidden",
                },
            ]}
        >
            <View style={styles.inner}>
                {loading ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                    <>
                        {/* Narrative */}
                        <View style={styles.fieldColumn}>
                            <Text style={styles.fieldLabel}>{t("world.narrative")}</Text>
                            <TextInput
                                style={styles.textInput}
                                value={narrative}
                                onChangeText={setNarrative}
                                placeholder={t("world.narrativePlaceholder")}
                                placeholderTextColor={theme.colors.textSecondary}
                                multiline
                                numberOfLines={3}
                            />
                        </View>

                        {/* Laws */}
                        <View style={styles.fieldColumn}>
                            <Text style={styles.fieldLabel}>{t("world.laws")}</Text>
                            <TextInput
                                style={styles.textInput}
                                value={laws}
                                onChangeText={setLaws}
                                placeholder={t("world.notSet")}
                                placeholderTextColor={theme.colors.textSecondary}
                                multiline
                                numberOfLines={3}
                            />
                        </View>

                        {/* Policy */}
                        <View style={styles.fieldRow}>
                            <Text style={styles.fieldLabel}>{t("world.policy")}</Text>
                            <TouchableOpacity style={styles.policyButton} onPress={cyclePolicy} activeOpacity={0.7}>
                                <Text style={styles.policyText}>{policy}</Text>
                                <Ionicons name="chevron-forward" size={12} color={theme.colors.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        {/* Save */}
                        <TouchableOpacity
                            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                            onPress={handleSave}
                            disabled={saving}
                            activeOpacity={0.7}
                        >
                            {saving
                                ? <ActivityIndicator size="small" color="#fff" />
                                : <Ionicons name="checkmark" size={16} color="#fff" />
                            }
                            <Text style={styles.saveText}>{saving ? "..." : "Save"}</Text>
                        </TouchableOpacity>
                    </>
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
        textInput: {
            fontSize: 13,
            color: theme.colors.text,
            backgroundColor: theme.colors.surfaceHigh,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
            minHeight: 60,
            textAlignVertical: "top",
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
