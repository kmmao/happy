/**
 * CreateLoopModal — gated "Create a Loop" wizard for the Workflow IA.
 *
 * Generic-role AgentLoops (the long-running, user-defined agent kind that
 * the + menu would create) are blocked on ADR-0022 Phase 3b: the CLI
 * needs to ship a daemon endpoint that accepts Loop definitions from
 * server, and the server side needs the matching API. Until both land,
 * actual Loop creation can't succeed end-to-end from the App.
 *
 * Instead of hiding the action (users keep asking), we expose a guided
 * status sheet that:
 *   - Lists every Machine + its current daemon CLI version
 *   - Compares each against MIN_CLI_VERSION_FOR_LOOPS (semver)
 *   - Tells the user what the prerequisite is + how to upgrade
 *   - Links to the planning doc so the curious can read why
 *
 * Same bottom-sheet shell + animation as the other workflow modals so
 * the visual rhythm stays consistent.
 */

import * as React from "react";
import {
    View,
    Pressable,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    Modal as RNModal,
    useWindowDimensions,
    Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    runOnJS,
} from "react-native-reanimated";
import { Text } from "@/components/StyledText";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { webInteractive } from "@/utils/interactiveSurface";
import { t } from "@/text";
import { useAllMachines } from "@/sync/storage";
import type { Machine } from "@/sync/storageTypes";
import { isMachineOnline } from "@/utils/machineUtils";

interface CreateLoopModalProps {
    visible: boolean;
    onClose: () => void;
}

/**
 * Minimum CLI version that ships the daemon endpoints required for
 * server-driven Loop creation. Bumped when ADR-0022 Phase 3b lands and
 * the actual create-loop wire RPC is published.
 */
const MIN_CLI_VERSION_FOR_LOOPS = "0.97.0";

/**
 * Optional link in the modal footer pointing at the planning doc that
 * explains the gating. Surfaces context for users who want the why.
 */
const LEARN_MORE_URL =
    "https://github.com/kmmao/happy/blob/main/docs/plans/sessions-and-automation-ia.md";

const MOBILE_BREAKPOINT = 540;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Compare two semver strings (major.minor.patch). Returns -1 / 0 / 1.
// Treats missing pieces as 0 ("0.96" → 0.96.0). Returns null if either
// side isn't parseable, so the caller can fall back to "unknown".
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

const styles = StyleSheet.create((theme) => ({
    overlay: { flex: 1 },
    overlayDesktop: {
        backgroundColor: "rgba(0,0,0,0.45)",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 16,
    },
    overlayMobile: {
        backgroundColor: "transparent",
        justifyContent: "flex-end",
    },
    backdrop: {
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
    },
    card: {
        backgroundColor: theme.colors.surface,
        overflow: "hidden",
        flexDirection: "column",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 12,
    },
    cardDesktop: {
        width: "100%",
        maxWidth: 520,
        borderRadius: 14,
    },
    cardMobile: {
        width: "100%",
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
    grabHandleWrap: { alignItems: "center", paddingTop: 8, paddingBottom: 4 },
    grabHandle: {
        width: 36, height: 4, borderRadius: 2,
        backgroundColor: theme.colors.divider,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 12,
    },
    titleColumn: { flex: 1, minWidth: 0, gap: 4 },
    title: {
        fontSize: 18,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    subtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        lineHeight: 18,
    },
    closeButton: {
        width: 32, height: 32, borderRadius: 16,
        alignItems: "center", justifyContent: "center",
        backgroundColor: theme.colors.surfaceHigh,
        marginLeft: 12,
        ...webInteractive,
    },
    scrollArea: { flexShrink: 1 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20, gap: 16 },
    info: {
        flexDirection: "row", alignItems: "flex-start", gap: 8,
        padding: 10, borderRadius: 8,
        backgroundColor: `${theme.colors.accentOrange}14`,
    },
    infoText: {
        flex: 1, fontSize: 12, color: theme.colors.text,
        ...Typography.default(), lineHeight: 17,
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
    machineLabelColumn: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
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
    footer: {
        flexDirection: "row", justifyContent: "flex-end", gap: 10,
        paddingHorizontal: 20, paddingTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    button: {
        paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10,
        minWidth: 88, alignItems: "center", justifyContent: "center",
        ...webInteractive,
    },
    buttonPrimary: { backgroundColor: theme.colors.button.primary.background },
    buttonText: { fontSize: 14, ...Typography.default("semiBold") },
    buttonTextPrimary: { color: theme.colors.button.primary.tint },
}));

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

export const CreateLoopModal = React.memo(function CreateLoopModal({
    visible,
    onClose,
}: CreateLoopModalProps) {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
    const isMobile = viewportWidth < MOBILE_BREAKPOINT;

    const machines = useAllMachines();
    const support = React.useMemo(() => classifyMachines(machines), [machines]);
    const anyReady = support.some((s) => s.meetsRequirement === true && s.online);

    // --- Sheet animation (mirrors MakeRecurringModal) ---
    const mobileMaxHeight = Math.floor(viewportHeight * 0.9);
    const desktopMaxHeight = Math.min(660, Math.floor(viewportHeight * 0.85));
    const cardMaxHeight = isMobile ? mobileMaxHeight : desktopMaxHeight;
    const footerPaddingBottom = (isMobile ? insets.bottom : 14) || 14;

    const translateY = useSharedValue(mobileMaxHeight);
    const isClosingRef = React.useRef(false);

    React.useEffect(() => {
        if (visible) {
            isClosingRef.current = false;
            translateY.value = mobileMaxHeight;
            translateY.value = withTiming(0, { duration: 260 });
        }
    }, [visible, mobileMaxHeight, translateY]);

    const cardAnimatedStyle = useAnimatedStyle(() => ({
        transform: isMobile ? [{ translateY: translateY.value }] : [],
    }));
    const backdropAnimatedStyle = useAnimatedStyle(() => {
        if (!isMobile) return {};
        const progress = 1 - Math.min(1, Math.max(0, translateY.value / mobileMaxHeight));
        return { opacity: progress };
    });

    const closeOnJs = React.useCallback(() => onClose(), [onClose]);
    const requestClose = React.useCallback(() => {
        if (isClosingRef.current) return;
        isClosingRef.current = true;
        if (!isMobile) {
            onClose();
            return;
        }
        translateY.value = withTiming(mobileMaxHeight, { duration: 220 }, () => {
            runOnJS(closeOnJs)();
        });
    }, [isMobile, mobileMaxHeight, onClose, closeOnJs, translateY]);

    const SWIPE_DISTANCE = mobileMaxHeight / 3;
    const panGesture = React.useMemo(
        () =>
            Gesture.Pan()
                .enabled(isMobile)
                .onUpdate((e) => { translateY.value = Math.max(0, e.translationY); })
                .onEnd((e) => {
                    if (e.translationY > SWIPE_DISTANCE || e.velocityY > 800) {
                        isClosingRef.current = true;
                        translateY.value = withTiming(mobileMaxHeight, { duration: 220 }, () => {
                            runOnJS(closeOnJs)();
                        });
                    } else {
                        translateY.value = withSpring(0, { damping: 20, stiffness: 220 });
                    }
                }),
        [isMobile, mobileMaxHeight, SWIPE_DISTANCE, translateY, closeOnJs],
    );

    return (
        <RNModal
            visible={visible}
            transparent
            animationType={isMobile ? "none" : "fade"}
            onRequestClose={() => requestClose()}
            statusBarTranslucent
        >
            <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardAvoidingView
                    style={[styles.overlay, isMobile ? styles.overlayMobile : styles.overlayDesktop]}
                    behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
                >
                    <AnimatedPressable
                        style={[styles.backdrop, isMobile && backdropAnimatedStyle]}
                        onPress={() => requestClose()}
                    />
                    <Animated.View
                        style={[
                            styles.card,
                            isMobile ? styles.cardMobile : styles.cardDesktop,
                            { maxHeight: cardMaxHeight },
                            isMobile && cardAnimatedStyle,
                        ]}
                    >
                        <GestureDetector gesture={panGesture}>
                            <View>
                                {isMobile ? (
                                    <View style={styles.grabHandleWrap}>
                                        <View style={styles.grabHandle} />
                                    </View>
                                ) : null}
                                <View style={styles.headerRow}>
                                    <View style={styles.titleColumn}>
                                        <Text style={styles.title}>{t("workflows.loopModalTitle")}</Text>
                                        <Text style={styles.subtitle}>{t("workflows.loopModalSubtitle")}</Text>
                                    </View>
                                    <Pressable
                                        style={styles.closeButton}
                                        onPress={() => requestClose()}
                                        hitSlop={8}
                                    >
                                        <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                                    </Pressable>
                                </View>
                            </View>
                        </GestureDetector>

                        <ScrollView
                            style={styles.scrollArea}
                            contentContainerStyle={styles.scrollContent}
                            keyboardShouldPersistTaps="handled"
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
                                        <Ionicons name="cube-outline" size={16} color={theme.colors.textSecondary} />
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
                                <View style={[styles.info, { backgroundColor: `${theme.colors.warning}1A` }]}>
                                    <Ionicons name="arrow-up-circle" size={16} color={theme.colors.warning} />
                                    <Text style={styles.infoText}>
                                        {t("workflows.loopUpgradeHint", MIN_CLI_VERSION_FOR_LOOPS)}
                                    </Text>
                                </View>
                            ) : (
                                <View style={[styles.info, { backgroundColor: `${theme.colors.success}1A` }]}>
                                    <Ionicons name="hourglass-outline" size={16} color={theme.colors.success} />
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
                        </ScrollView>

                        <View style={[styles.footer, { paddingBottom: footerPaddingBottom }]}>
                            <Pressable
                                style={[styles.button, styles.buttonPrimary]}
                                onPress={() => requestClose()}
                            >
                                <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                                    {t("workflows.loopGotIt")}
                                </Text>
                            </Pressable>
                        </View>
                    </Animated.View>
                </KeyboardAvoidingView>
            </GestureHandlerRootView>
        </RNModal>
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
    const label =
        machine.metadata?.displayName || machine.metadata?.host || machine.id;

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
            <Ionicons name="desktop-outline" size={16} color={theme.colors.textSecondary} />
            <View style={styles.machineLabelColumn}>
                <Text style={styles.machineName} numberOfLines={1}>{label}</Text>
                <Text style={styles.machineMeta}>
                    {version ? `v${version}` : "—"}
                </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: badgeBg }]}>
                <Ionicons name={icon} size={12} color={badgeColor} />
                <Text style={[styles.statusBadgeText, { color: badgeColor }]}>{badge}</Text>
            </View>
        </View>
    );
}
