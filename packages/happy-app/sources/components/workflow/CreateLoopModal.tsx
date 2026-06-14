/**
 * CreateLoopModal — gated "Create a Loop" guidance sheet. Real creation
 * is blocked on ADR-0022 Phase 3b (CLI daemon endpoint + server wire RPC
 * both pending). Surfaces machine-by-machine CLI version readiness +
 * upgrade hint so users discover the gating in context instead of asking
 * why "Create a Loop" feels broken.
 *
 * Shell, animation, gestures owned by <BottomSheet>; this file only
 * owns the version compare logic + status badges.
 */

import * as React from "react";
import { View, Pressable, Linking } from "react-native";
import { Text } from "@/components/StyledText";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { webInteractive } from "@/utils/interactiveSurface";
import { t } from "@/text";
import { useAllMachines } from "@/sync/storage";
import type { Machine } from "@/sync/storageTypes";
import { isMachineOnline } from "@/utils/machineUtils";
import { BottomSheet, BottomSheetHandle } from "@/components/BottomSheet";

interface CreateLoopModalProps {
    visible: boolean;
    onClose: () => void;
}

/**
 * Minimum CLI version that ships the daemon endpoints required for
 * server-driven Loop creation. Bumped when ADR-0022 Phase 3b lands.
 */
const MIN_CLI_VERSION_FOR_LOOPS = "0.97.0";

/** Planning doc link surfaced in the footer for users who want context. */
const LEARN_MORE_URL =
    "https://github.com/kmmao/happy/blob/main/docs/plans/sessions-and-automation-ia.md";

// Compare two semver strings (major.minor.patch). Returns -1 / 0 / 1.
// Treats missing pieces as 0. Returns null if either side isn't parseable.
function compareSemver(a: string | undefined | null, b: string): number | null {
    if (!a) return null;
    const parse = (s: string): number[] | null => {
        const parts = s.split(".").slice(0, 3).map((p) => parseInt(p, 10));
        if (parts.some((n) => Number.isNaN(n))) return null;
        while (parts.length < 3) parts.push(0);
        return parts;
    };
    const av = parse(a);
    const bv = parse(b);
    if (!av || !bv) return null;
    for (let i = 0; i < 3; i++) {
        if (av[i] !== bv[i]) return av[i] < bv[i] ? -1 : 1;
    }
    return 0;
}

type MachineSupport = {
    machine: Machine;
    version: string | null;
    online: boolean;
    /** undefined = unknown version, true/false = comparison vs min. */
    meetsRequirement: boolean | undefined;
};

function classifyMachines(machines: Machine[]): MachineSupport[] {
    return machines.map((machine) => {
        const version = (machine.daemonState as any)?.startedWithCliVersion ?? null;
        const cmp = compareSemver(version, MIN_CLI_VERSION_FOR_LOOPS);
        return {
            machine,
            version,
            online: isMachineOnline(machine),
            meetsRequirement: cmp === null ? undefined : cmp >= 0,
        };
    });
}

const styles = StyleSheet.create((theme) => ({
    info: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        padding: 10,
        borderRadius: 8,
        backgroundColor: `${theme.colors.accentOrange}14`,
    },
    infoText: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.text,
        ...Typography.default(),
        lineHeight: 17,
    },
    requirementCard: {
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHigh,
        gap: 6,
    },
    requirementLabel: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.1,
        ...Typography.default("semiBold"),
    },
    requirementValue: {
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
        fontFamily: "Menlo",
    },
    sectionLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.1,
        ...Typography.default("semiBold"),
    },
    machineRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        gap: 10,
        marginBottom: 6,
    },
    machineLabelColumn: { flex: 1, minWidth: 0, gap: 2 },
    machineName: {
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    machineMeta: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        fontFamily: "Menlo",
    },
    statusBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
    },
    statusBadgeText: {
        fontSize: 11,
        ...Typography.default("semiBold"),
    },
    learnMoreRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 4,
        ...webInteractive,
    },
    learnMoreText: {
        fontSize: 13,
        color: theme.colors.textLink,
        ...Typography.default("semiBold"),
    },
    button: {
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderRadius: 10,
        minWidth: 88,
        alignItems: "center",
        justifyContent: "center",
        ...webInteractive,
    },
    buttonPrimary: { backgroundColor: theme.colors.button.primary.background },
    buttonText: { fontSize: 14, ...Typography.default("semiBold") },
    buttonTextPrimary: { color: theme.colors.button.primary.tint },
}));

export const CreateLoopModal = React.memo(function CreateLoopModal({
    visible,
    onClose,
}: CreateLoopModalProps) {
    const { theme } = useUnistyles();
    const sheetRef = React.useRef<BottomSheetHandle>(null);
    const machines = useAllMachines();
    const support = React.useMemo(() => classifyMachines(machines), [machines]);
    const anyReady = support.some((s) => s.meetsRequirement === true && s.online);

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            title={t("workflows.loopModalTitle")}
            subtitle={t("workflows.loopModalSubtitle")}
            footer={
                <Pressable
                    style={[styles.button, styles.buttonPrimary]}
                    onPress={() => sheetRef.current?.requestClose()}
                >
                    <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                        {t("workflows.loopGotIt")}
                    </Text>
                </Pressable>
            }
        >
            <View style={styles.info}>
                <Ionicons
                    name="information-circle"
                    size={16}
                    color={theme.colors.accentOrange}
                />
                <Text style={styles.infoText}>{t("workflows.loopModalInfo")}</Text>
            </View>

            <View style={styles.requirementCard}>
                <Text style={styles.requirementLabel}>
                    {t("workflows.loopRequirementLabel")}
                </Text>
                <Text style={styles.requirementValue}>
                    @kmmao/happy-coder ≥ {MIN_CLI_VERSION_FOR_LOOPS}
                </Text>
            </View>

            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.loopMachinesLabel", machines.length)}
                </Text>
                {machines.length === 0 ? (
                    <View style={[styles.machineRow, { marginTop: 8 }]}>
                        <Ionicons
                            name="cube-outline"
                            size={16}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={styles.machineMeta}>
                            {t("workflows.standaloneNoMachine")}
                        </Text>
                    </View>
                ) : (
                    <View style={{ marginTop: 8 }}>
                        {support.map((s) => (
                            <MachineSupportRow key={s.machine.id} support={s} theme={theme} />
                        ))}
                    </View>
                )}
            </View>

            {!anyReady ? (
                <View
                    style={[
                        styles.info,
                        { backgroundColor: `${theme.colors.warning}1A` },
                    ]}
                >
                    <Ionicons
                        name="arrow-up-circle"
                        size={16}
                        color={theme.colors.warning}
                    />
                    <Text style={styles.infoText}>
                        {t("workflows.loopUpgradeHint", MIN_CLI_VERSION_FOR_LOOPS)}
                    </Text>
                </View>
            ) : (
                <View
                    style={[
                        styles.info,
                        { backgroundColor: `${theme.colors.success}1A` },
                    ]}
                >
                    <Ionicons
                        name="hourglass-outline"
                        size={16}
                        color={theme.colors.success}
                    />
                    <Text style={styles.infoText}>
                        {t("workflows.loopReadyButNotYet")}
                    </Text>
                </View>
            )}

            <Pressable
                style={styles.learnMoreRow}
                onPress={() => Linking.openURL(LEARN_MORE_URL).catch(() => {})}
            >
                <Ionicons name="open-outline" size={14} color={theme.colors.textLink} />
                <Text style={styles.learnMoreText}>{t("workflows.loopLearnMore")}</Text>
            </Pressable>
        </BottomSheet>
    );
});

function MachineSupportRow({
    support,
    theme,
}: {
    support: MachineSupport;
    theme: any;
}) {
    const { machine, version, online, meetsRequirement } = support;
    const label = machine.metadata?.displayName || machine.metadata?.host || machine.id;

    const { badge, badgeBg, badgeColor, icon } = React.useMemo(() => {
        if (!online) {
            return {
                badge: t("workflows.loopMachineOffline"),
                badgeBg: theme.colors.surfaceHigh,
                badgeColor: theme.colors.textSecondary,
                icon: "cloud-offline-outline" as const,
            };
        }
        if (meetsRequirement === true) {
            return {
                badge: t("workflows.loopMachineReady"),
                badgeBg: `${theme.colors.success}24`,
                badgeColor: theme.colors.success,
                icon: "checkmark-circle" as const,
            };
        }
        if (meetsRequirement === false) {
            return {
                badge: t("workflows.loopMachineNeedsUpgrade"),
                badgeBg: `${theme.colors.warning}24`,
                badgeColor: theme.colors.warning,
                icon: "arrow-up-circle" as const,
            };
        }
        return {
            badge: t("workflows.loopMachineUnknownVersion"),
            badgeBg: theme.colors.surfaceHigh,
            badgeColor: theme.colors.textSecondary,
            icon: "help-circle-outline" as const,
        };
    }, [online, meetsRequirement, theme]);

    return (
        <View style={styles.machineRow}>
            <Ionicons
                name="desktop-outline"
                size={16}
                color={theme.colors.textSecondary}
            />
            <View style={styles.machineLabelColumn}>
                <Text style={styles.machineName} numberOfLines={1}>
                    {label}
                </Text>
                <Text style={styles.machineMeta}>{version ? `v${version}` : "—"}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: badgeBg }]}>
                <Ionicons name={icon} size={12} color={badgeColor} />
                <Text style={[styles.statusBadgeText, { color: badgeColor }]}>{badge}</Text>
            </View>
        </View>
    );
}
