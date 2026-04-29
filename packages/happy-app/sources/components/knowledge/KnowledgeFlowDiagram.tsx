import * as React from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal } from "@/modal";

// ─── Public entry point ───────────────────────────────────────────────────────

export function showKnowledgeFlowModal() {
    Modal.show({ component: KnowledgeFlowModal });
}

// ─── Modal component (receives onClose from Modal.show) ───────────────────────

interface KnowledgeFlowModalProps {
    onClose: () => void;
}

export const KnowledgeFlowModal = React.memo<KnowledgeFlowModalProps>(({ onClose }) => {
    const { theme } = useUnistyles();
    const c = theme.colors;

    return (
        <View style={[styles.container, { backgroundColor: c.surface }]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: c.surfaceHighest }]}>
                <Text style={[styles.headerTitle, { color: c.text }]}>
                    {t("projects.knowledgeFlowTitle")}
                </Text>
                <Pressable onPress={onClose} hitSlop={8}>
                    <Ionicons name="close" size={20} color={c.textSecondary} />
                </Pressable>
            </View>

            {/* Scrollable flow */}
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Step 1: Session */}
                <FlowStep
                    icon="play-circle-outline"
                    color={c.accentBlue}
                    label={t("projects.knowledgeFlowSession")}
                    theme={theme}
                />
                <Connector theme={theme} />

                {/* Step 2: Collect */}
                <FlowStep
                    icon="download-outline"
                    color={c.accentBlue}
                    label={t("projects.knowledgeFlowCollect")}
                    desc={t("projects.knowledgeFlowCollectDesc")}
                    theme={theme}
                />
                <Connector theme={theme} />

                {/* Step 3: Process & Store */}
                <FlowStep
                    icon="server-outline"
                    color={c.accentTeal}
                    label={t("projects.knowledgeFlowProcess")}
                    desc={t("projects.knowledgeFlowProcessDesc")}
                    theme={theme}
                />
                <Connector theme={theme} />

                {/* Step 4: AI Refine (optional) */}
                <FlowStep
                    icon="sparkles-outline"
                    color={c.accentPurple}
                    label={t("projects.knowledgeFlowRefine")}
                    desc={t("projects.knowledgeFlowRefineDesc")}
                    optional
                    theme={theme}
                />
                <Connector theme={theme} />

                {/* Step 5: Knowledge Base */}
                <FlowStep
                    icon="library-outline"
                    color={c.accentTeal}
                    label={t("projects.knowledgeFlowDatabase")}
                    highlighted
                    theme={theme}
                />

                {/* Background jobs row */}
                <View style={styles.bgRow}>
                    <BgChip icon="timer-outline" label={t("projects.knowledgeFlowDecayFreq")} color={c.accentMagenta} />
                    <BgChip icon="git-merge-outline" label={t("projects.knowledgeFlowMergeFreq")} color={c.accentMagenta} />
                    <Text style={[styles.bgNote, { color: c.textSecondary }]}>
                        {t("projects.knowledgeFlowBackgroundNote")}
                    </Text>
                </View>

                <Connector theme={theme} label={t("projects.knowledgeFlowNewSession")} />

                {/* Step 6: Inject context — with mode breakdown */}
                <View style={[styles.injectCard, { backgroundColor: c.accentOrange + "14", borderColor: c.accentOrange + "40" }]}>
                    <View style={styles.injectHeader}>
                        <Ionicons name="flash-outline" size={15} color={c.accentOrange} />
                        <Text style={[styles.stepLabel, { color: c.text }]}>
                            {t("projects.knowledgeFlowInject")}
                        </Text>
                    </View>

                    <Text style={[styles.injectModeTitle, { color: c.textSecondary }]}>
                        {t("projects.knowledgeFlowInjectModeTitle")}
                    </Text>

                    <ModeRow
                        modeLabel={t("projects.knowledgeModeAuto")}
                        desc={t("projects.knowledgeConfigModeAutoHint")}
                        color={c.header.tint}
                        theme={theme}
                    />
                    <ModeRow
                        modeLabel={t("projects.knowledgeModeFull")}
                        desc={t("projects.knowledgeConfigModeFullHint")}
                        color={c.accentTeal}
                        theme={theme}
                    />
                    <ModeRow
                        modeLabel={t("projects.knowledgeModeMinimal")}
                        desc={t("projects.knowledgeConfigModeMinimalHint")}
                        color={c.accentBlue}
                        theme={theme}
                    />
                </View>
            </ScrollView>
        </View>
    );
});

// ─── Sub-components ───────────────────────────────────────────────────────────

interface FlowStepProps {
    icon: string;
    color: string;
    label: string;
    desc?: string;
    optional?: boolean;
    highlighted?: boolean;
    theme: any;
}

function FlowStep({ icon, color, label, desc, optional, highlighted, theme }: FlowStepProps) {
    const bg = color + (highlighted ? "22" : "14");
    const border = color + (highlighted ? "60" : "40");

    return (
        <View style={[styles.step, { backgroundColor: bg, borderColor: border }]}>
            <View style={styles.stepHeader}>
                <Ionicons name={icon as any} size={16} color={color} />
                <Text style={[styles.stepLabel, { color: theme.colors.text }]}>
                    {label}
                </Text>
                {optional && (
                    <View style={[styles.optBadge, { backgroundColor: color + "28" }]}>
                        <Text style={[styles.optText, { color }]}>
                            {t("supervisor.optionalTag")}
                        </Text>
                    </View>
                )}
            </View>
            {desc && (
                <Text style={[styles.stepDesc, { color: theme.colors.textSecondary }]}>
                    {desc}
                </Text>
            )}
        </View>
    );
}

function Connector({ theme, label }: { theme: any; label?: string }) {
    const color = theme.colors.textSecondary;
    return (
        <View style={styles.connector}>
            <View style={[styles.connLine, { backgroundColor: color + "35" }]} />
            {label ? (
                <Text style={[styles.connLabel, { color: color + "CC" }]}>{label}</Text>
            ) : null}
            <Ionicons name="chevron-down" size={11} color={color + "90"} />
        </View>
    );
}

function BgChip({ icon, label, color }: { icon: string; label: string; color: string }) {
    return (
        <View style={[styles.bgChip, { borderColor: color + "55", backgroundColor: color + "12" }]}>
            <Ionicons name={icon as any} size={11} color={color} />
            <Text style={[styles.bgChipLabel, { color }]}>{label}</Text>
        </View>
    );
}

function ModeRow({ modeLabel, desc, color, theme }: {
    modeLabel: string;
    desc: string;
    color: string;
    theme: any;
}) {
    return (
        <View style={styles.modeRow}>
            <View style={[styles.modeDot, { backgroundColor: color }]} />
            <View style={styles.modeContent}>
                <Text style={[styles.modeLabel, { color: theme.colors.text }]}>{modeLabel}</Text>
                <Text style={[styles.modeDesc, { color: theme.colors.textSecondary }]}>{desc}</Text>
            </View>
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create((_, rt) => ({
    container: {
        width: "100%",
        borderRadius: 16,
        overflow: "hidden",
        maxHeight: 580,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderBottomWidth: 1,
    },
    headerTitle: {
        ...Typography.default("semiBold"),
        fontSize: 15,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 20,
    },
    step: {
        borderRadius: 10,
        borderWidth: 1,
        padding: 12,
    },
    stepHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    stepLabel: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        flex: 1,
    },
    stepDesc: {
        ...Typography.default("regular"),
        fontSize: 12,
        marginTop: 6,
        marginLeft: 24,
        lineHeight: 17,
    },
    optBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    optText: {
        ...Typography.default("semiBold"),
        fontSize: 9,
    },
    connector: {
        alignItems: "center",
        paddingVertical: 2,
        gap: 2,
    },
    connLine: {
        width: 1,
        height: 10,
    },
    connLabel: {
        ...Typography.default("regular"),
        fontSize: 10,
    },
    bgRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 6,
    },
    bgChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
    },
    bgChipLabel: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    bgNote: {
        ...Typography.default("regular"),
        fontSize: 11,
        fontStyle: "italic",
    },
    injectCard: {
        borderRadius: 10,
        borderWidth: 1,
        padding: 12,
        gap: 8,
    },
    injectHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    injectModeTitle: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        textTransform: "uppercase",
        marginTop: 4,
    },
    modeRow: {
        flexDirection: "row",
        gap: 10,
        paddingVertical: 4,
    },
    modeDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginTop: 5,
        flexShrink: 0,
    },
    modeContent: {
        flex: 1,
        gap: 2,
    },
    modeLabel: {
        ...Typography.default("semiBold"),
        fontSize: 12,
    },
    modeDesc: {
        ...Typography.default("regular"),
        fontSize: 11,
        lineHeight: 16,
    },
}));
