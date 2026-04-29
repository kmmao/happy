import * as React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import type { SupervisorProfileOption } from "@/components/project/supervisorProfileSelection";

/**
 * Reusable AI backend profile selector.
 *
 * Abstracts the expand-to-pick pattern pioneered in `supervisor-settings.tsx`
 * so Config Tab sections (health / research) and per-record editors
 * (Cron / Webhook) can share the same interaction without duplicating ~100
 * lines of Pressable+Ionicons markup.
 *
 * - `value = null` means "inherit the project default"; render as
 *   `defaultOptionLabel` and show the radio-selected indicator.
 * - `profiles` is the merged list (built-in + account overrides) already
 *   sorted by the caller; see `getSupervisorAvailableProfiles`.
 * - Pass `missingProfileName` when the currently-bound profileId no longer
 *   resolves (archived / deleted / cross-account) to surface an inline
 *   warning banner.
 */

export interface ProfilePickerProps {
    value: string | null;
    onChange: (profileId: string | null) => void;
    profiles: ReadonlyArray<SupervisorProfileOption>;
    defaultOptionLabel: string;
    description?: string;
    missingProfileName?: string | null;
    missingMessage?: string;
    onRefresh?: () => void | Promise<void>;
    refreshing?: boolean;
    refreshLabel?: string;
    builtInLabel?: string;
    initialOpen?: boolean;
    /**
     * Optional "currently effective" label rendered as a small footer row.
     * Typically driven by the runtime-profile preview API so the user can
     * see what the binding actually resolves to after Save.
     */
    effectiveLabel?: string;
    /** Color hint for the effective label row. `warning` tints it orange. */
    effectiveTone?: "ok" | "warning";
    /**
     * Optional tap handler for the effective label row. When provided, the
     * row renders as a Pressable with a trailing chevron to indicate the
     * user can drill into the source (e.g. project supervisor settings) to
     * change the underlying default.
     */
    onEffectivePress?: () => void;
}

export const ProfilePicker = React.memo<ProfilePickerProps>((props) => {
    const {
        value,
        onChange,
        profiles,
        defaultOptionLabel,
        description,
        missingProfileName,
        missingMessage,
        onRefresh,
        refreshing = false,
        refreshLabel,
        builtInLabel = "Built-in",
        initialOpen = false,
        effectiveLabel,
        effectiveTone = "ok",
        onEffectivePress,
    } = props;

    const { theme } = useUnistyles();
    const [open, setOpen] = React.useState(initialOpen);

    const selectedProfile = value
        ? profiles.find((p) => p.id === value)
        : null;
    const triggerLabel = selectedProfile
        ? (selectedProfile.name ?? value)
        : value ?? defaultOptionLabel;

    return (
        <View style={styles.card}>
            {description && (
                <Text style={[styles.description, { color: theme.colors.textSecondary }]}>
                    {description}
                </Text>
            )}

            <View style={styles.headerRow}>
                <Pressable
                    style={[styles.trigger, { borderColor: theme.colors.divider }]}
                    onPress={() => setOpen((prev) => !prev)}
                >
                    <Text
                        style={[styles.triggerText, { color: theme.colors.text }]}
                        numberOfLines={1}
                    >
                        {triggerLabel}
                    </Text>
                    <Ionicons
                        name={open ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>

                {onRefresh && (
                    <Pressable
                        style={styles.refreshButton}
                        onPress={onRefresh}
                        disabled={refreshing}
                    >
                        {refreshing ? (
                            <ActivityIndicator size="small" color={theme.colors.header.tint} />
                        ) : (
                            <Ionicons
                                name="refresh"
                                size={14}
                                color={theme.colors.header.tint}
                            />
                        )}
                        {refreshLabel && (
                            <Text
                                style={[styles.refreshText, { color: theme.colors.header.tint }]}
                            >
                                {refreshLabel}
                            </Text>
                        )}
                    </Pressable>
                )}
            </View>

            {missingProfileName && missingMessage && (
                <View style={[styles.warningBanner, { backgroundColor: `${theme.colors.warning ?? "#FF9500"}1A` }] }>
                    <Ionicons name="alert-circle-outline" size={16} color="#FF9500" />
                    <Text style={[styles.warningText, { color: theme.colors.text }]}>
                        {missingMessage}
                    </Text>
                </View>
            )}

            {effectiveLabel && (onEffectivePress ? (
                <Pressable
                    style={[
                        styles.effectiveRow,
                        {
                            backgroundColor:
                                effectiveTone === "warning"
                                    ? `${theme.colors.warning ?? "#FF9500"}1A`
                                    : `${theme.colors.textLink}12`,
                        },
                    ]}
                    onPress={onEffectivePress}
                >
                    <Ionicons
                        name={effectiveTone === "warning" ? "alert-circle-outline" : "information-circle-outline"}
                        size={14}
                        color={effectiveTone === "warning" ? "#FF9500" : theme.colors.textLink}
                    />
                    <Text
                        style={[
                            styles.effectiveText,
                            { color: theme.colors.text },
                        ]}
                        numberOfLines={2}
                    >
                        {effectiveLabel}
                    </Text>
                    <Ionicons
                        name="chevron-forward"
                        size={14}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>
            ) : (
                <View
                    style={[
                        styles.effectiveRow,
                        {
                            backgroundColor:
                                effectiveTone === "warning"
                                    ? `${theme.colors.warning ?? "#FF9500"}1A`
                                    : `${theme.colors.textLink}12`,
                        },
                    ]}
                >
                    <Ionicons
                        name={effectiveTone === "warning" ? "alert-circle-outline" : "information-circle-outline"}
                        size={14}
                        color={effectiveTone === "warning" ? "#FF9500" : theme.colors.textLink}
                    />
                    <Text
                        style={[
                            styles.effectiveText,
                            { color: theme.colors.text },
                        ]}
                        numberOfLines={2}
                    >
                        {effectiveLabel}
                    </Text>
                </View>
            ))}

            {open && (
                <View style={[styles.optionList, { borderTopColor: theme.colors.divider }]}>
                    <Pressable
                        style={styles.optionRow}
                        onPress={() => {
                            onChange(null);
                            setOpen(false);
                        }}
                    >
                        <Ionicons
                            name={value === null ? "radio-button-on" : "radio-button-off"}
                            size={18}
                            color={value === null ? theme.colors.header.tint : theme.colors.textSecondary}
                        />
                        <Text style={[styles.optionLabel, { color: theme.colors.text }]}>
                            {defaultOptionLabel}
                        </Text>
                    </Pressable>

                    {profiles.map((p) => (
                        <Pressable
                            key={p.id}
                            style={[styles.optionRow, styles.optionRowDivided, { borderTopColor: theme.colors.divider }]}
                            onPress={() => {
                                onChange(p.id);
                                setOpen(false);
                            }}
                        >
                            <Ionicons
                                name={value === p.id ? "radio-button-on" : "radio-button-off"}
                                size={18}
                                color={value === p.id ? theme.colors.header.tint : theme.colors.textSecondary}
                            />
                            <Text
                                style={[styles.optionLabel, styles.optionLabelFlex, { color: theme.colors.text }]}
                                numberOfLines={1}
                            >
                                {p.name ?? p.id}
                            </Text>
                            {p.isBuiltIn && (
                                <Text style={[styles.builtInTag, { color: theme.colors.textSecondary }]}>
                                    {builtInLabel}
                                </Text>
                            )}
                        </Pressable>
                    ))}
                </View>
            )}
        </View>
    );
});

const styles = StyleSheet.create((_, rt) => ({
    card: {
        gap: 8,
    },
    description: {
        ...Typography.default("regular"),
        fontSize: 13,
        lineHeight: 18,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    trigger: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 8,
    },
    triggerText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        flex: 1,
    },
    refreshButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    refreshText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
    warningBanner: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        padding: 10,
        borderRadius: 8,
    },
    warningText: {
        ...Typography.default("regular"),
        fontSize: 13,
        flex: 1,
    },
    optionList: {
        borderTopWidth: 0.5,
    },
    optionRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 10,
        gap: 8,
    },
    optionRowDivided: {
        borderTopWidth: 0.5,
    },
    optionLabel: {
        ...Typography.default(),
        fontSize: 14,
    },
    optionLabelFlex: {
        flex: 1,
    },
    builtInTag: {
        ...Typography.default(),
        fontSize: 11,
    },
    effectiveRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 6,
    },
    effectiveText: {
        ...Typography.default(),
        fontSize: 12,
        flex: 1,
    },
}));

ProfilePicker.displayName = "ProfilePicker";
