import * as React from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { Modal } from "@/modal";
import { layout } from "@/components/layout";
import {
    adjudicateDecision,
    fetchDecisionById,
    submitDecisionOpinion,
    type ServerDecision,
    type DecisionOption,
} from "@/sync/apiDecision";

const STATUS_COLORS: Record<string, string> = {
    pending: "#F59E0B",
    decided: "#10B981",
    expired: "#6B7280",
    auto_resolved: "#3B82F6",
};

const STATUS_LABELS: Record<string, () => string> = {
    pending: () => t("decision.pending"),
    decided: () => t("decision.decided"),
    expired: () => t("decision.expired"),
    auto_resolved: () => t("decision.autoResolved"),
};

const DecisionDetailScreen = React.memo(function DecisionDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const navigation = useNavigation();
    const router = useRouter();
    const { theme } = useUnistyles();

    const [decision, setDecision] = React.useState<ServerDecision | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [selectedOption, setSelectedOption] = React.useState<string | null>(null);
    const [rationale, setRationale] = React.useState("");
    const [submitting, setSubmitting] = React.useState(false);

    React.useEffect(() => {
        navigation.setOptions({ title: t("decision.title") });
    }, [navigation]);

    React.useEffect(() => {
        (async () => {
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || !id) return;
                const fetched = await fetchDecisionById(credentials, id);
                setDecision(fetched);
            } catch {
                // decision not found or network error
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    const handleAdjudicate = React.useCallback(async () => {
        if (!decision || !selectedOption) return;
        setSubmitting(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const result = await adjudicateDecision(
                credentials,
                decision.projectId,
                decision.id,
                { chosenOption: selectedOption, rationale: rationale.trim() || undefined },
            );
            setDecision((prev) => prev ? {
                ...prev,
                status: "decided",
                chosenOption: selectedOption,
                rationale: rationale.trim() || null,
                knowledgeId: result.decision.knowledgeId,
                decidedAt: Date.now(),
            } : prev);
            Modal.toast(t("decision.precedentGenerated"));
        } catch {
            Modal.toast(t("decision.adjudicateError"));
        } finally {
            setSubmitting(false);
        }
    }, [decision, selectedOption, rationale]);

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator />
            </View>
        );
    }

    if (!decision) {
        return (
            <View style={styles.centerContainer}>
                <Ionicons name="scale-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={styles.emptyText}>{t("decision.emptyState")}</Text>
            </View>
        );
    }

    const isPending = decision.status === "pending";
    const isDecided = decision.status === "decided";
    const options = decision.options as DecisionOption[];
    const expiresIn = decision.expiresAt ? decision.expiresAt - Date.now() : null;
    const hoursLeft = expiresIn ? Math.max(0, Math.floor(expiresIn / (1000 * 60 * 60))) : null;

    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
        >
            {/* Status Badge */}
            <View style={styles.statusRow}>
                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[decision.status] ?? "#6B7280" }]}>
                    <Text style={styles.statusText}>
                        {STATUS_LABELS[decision.status]?.() ?? decision.status}
                    </Text>
                </View>
                {isPending && hoursLeft !== null && (
                    <Text style={styles.expiresText}>
                        {t("decision.expiresIn")}: {hoursLeft}h
                    </Text>
                )}
                {decision.agentRole && (
                    <Text style={styles.roleText}>{decision.agentRole}</Text>
                )}
                {decision.assignedTo && (
                    <View style={styles.assignedBadge}>
                        <Ionicons name="person" size={12} color="#8B5CF6" />
                        <Text style={styles.assignedText}>
                            {t("decision.assignedTo")}
                        </Text>
                    </View>
                )}
                {decision.opinions.length > 0 && (
                    <View style={styles.assignedBadge}>
                        <Ionicons name="chatbubbles" size={12} color="#F59E0B" />
                        <Text style={[styles.assignedText, { color: "#F59E0B" }]}>
                            {decision.opinions.length} {decision.opinions.length === 1 ? "opinion" : "opinions"}
                        </Text>
                    </View>
                )}
            </View>

            {/* Question */}
            <View style={styles.card}>
                <Text style={styles.sectionLabel}>{t("decision.question")}</Text>
                <Text style={styles.questionText}>{decision.question}</Text>
                {decision.context && (
                    <Text style={styles.contextText}>{decision.context}</Text>
                )}
            </View>

            {/* Options */}
            <View style={styles.card}>
                <Text style={styles.sectionLabel}>{t("decision.options")}</Text>
                {options.map((opt) => {
                    const isSelected = isPending
                        ? selectedOption === opt.id
                        : decision.chosenOption === opt.id;
                    return (
                        <Pressable
                            key={opt.id}
                            style={[styles.optionCard, isSelected && styles.optionCardSelected]}
                            onPress={isPending ? () => setSelectedOption(opt.id) : undefined}
                            disabled={!isPending}
                        >
                            <View style={styles.optionHeader}>
                                {isPending && (
                                    <Ionicons
                                        name={isSelected ? "radio-button-on" : "radio-button-off"}
                                        size={20}
                                        color={isSelected ? theme.colors.accentPurple : theme.colors.textSecondary}
                                    />
                                )}
                                {isDecided && isSelected && (
                                    <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                                )}
                                <Text style={[styles.optionDesc, isSelected && styles.optionDescSelected]}>
                                    {opt.description}
                                </Text>
                            </View>
                            {opt.pros && (
                                <View style={styles.prosConsRow}>
                                    <Text style={styles.prosLabel}>{t("decision.pros")}:</Text>
                                    <Text style={styles.prosConsText}>{opt.pros}</Text>
                                </View>
                            )}
                            {opt.cons && (
                                <View style={styles.prosConsRow}>
                                    <Text style={styles.consLabel}>{t("decision.cons")}:</Text>
                                    <Text style={styles.prosConsText}>{opt.cons}</Text>
                                </View>
                            )}
                        </Pressable>
                    );
                })}
            </View>

            {/* Opinions */}
            {(decision.opinions.length > 0 || isPending) && (
                <View style={styles.card}>
                    <Text style={styles.sectionLabel}>
                        {t("decision.opinions")} ({decision.opinions.length})
                    </Text>
                    {decision.opinions.map((op, idx) => {
                        const optDesc = options.find((o) => o.id === op.chosenOption)?.description ?? op.chosenOption;
                        return (
                            <View key={idx} style={styles.opinionRow}>
                                <Ionicons name="chatbubble-outline" size={14} color={theme.colors.textSecondary} />
                                <Text style={styles.opinionText} numberOfLines={2}>
                                    <Text style={{ fontWeight: "600" }}>{op.accountId.slice(0, 8)}</Text>
                                    {" → "}{optDesc}
                                    {op.rationale ? ` — ${op.rationale}` : ""}
                                </Text>
                            </View>
                        );
                    })}
                    {isPending && selectedOption && (
                        <Pressable
                            style={[styles.opinionButton, submitting && { opacity: 0.4 }]}
                            disabled={submitting}
                            onPress={async () => {
                                if (!decision || !selectedOption) return;
                                setSubmitting(true);
                                try {
                                    const credentials = await TokenStorage.getCredentials();
                                    if (!credentials) return;
                                    const result = await submitDecisionOpinion(
                                        credentials,
                                        decision.projectId,
                                        decision.id,
                                        { chosenOption: selectedOption, rationale: rationale.trim() || undefined },
                                    );
                                    setDecision((prev) => prev ? { ...prev, opinions: result.opinions } : prev);
                                    if (result.conflict) {
                                        Modal.toast(t("decision.opinionConflict"));
                                    } else {
                                        Modal.toast(t("decision.opinionSubmitted"));
                                    }
                                } catch {
                                    Modal.toast(t("decision.adjudicateError"));
                                } finally {
                                    setSubmitting(false);
                                }
                            }}
                        >
                            <Ionicons name="chatbubble-ellipses" size={16} color={theme.colors.accentPurple} />
                            <Text style={styles.opinionButtonText}>{t("decision.submitOpinion")}</Text>
                        </Pressable>
                    )}
                </View>
            )}

            {/* Rationale Input (pending only) */}
            {isPending && selectedOption && (
                <View style={styles.card}>
                    <Text style={styles.sectionLabel}>{t("decision.rationale")}</Text>
                    <TextInput
                        style={styles.rationaleInput}
                        value={rationale}
                        onChangeText={setRationale}
                        placeholder={t("decision.rationalePlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        multiline
                        textAlignVertical="top"
                        maxLength={2000}
                    />
                </View>
            )}

            {/* Adjudicate Button */}
            {isPending && selectedOption && (
                <View style={styles.actionContainer}>
                    <Pressable
                        style={[styles.adjudicateButton, submitting && { opacity: 0.4 }]}
                        onPress={handleAdjudicate}
                        disabled={submitting}
                    >
                        {submitting ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.adjudicateButtonText}>
                                {t("decision.adjudicateConfirm")}
                            </Text>
                        )}
                    </Pressable>
                </View>
            )}

            {/* Decided: Show rationale + precedent link */}
            {isDecided && decision.rationale && (
                <View style={styles.card}>
                    <Text style={styles.sectionLabel}>{t("decision.rationale")}</Text>
                    <Text style={styles.rationaleText}>{decision.rationale}</Text>
                </View>
            )}
            {isDecided && decision.knowledgeId && (
                <View style={styles.card}>
                    <Pressable
                        style={styles.precedentLink}
                        onPress={() => router.push(`/knowledge/${decision.knowledgeId}` as any)}
                    >
                        <Ionicons name="library-outline" size={18} color={theme.colors.accentPurple} />
                        <Text style={styles.precedentLinkText}>{t("decision.viewPrecedent")}</Text>
                    </Pressable>
                </View>
            )}
        </ScrollView>
    );
});

export default DecisionDetailScreen;

const styles = StyleSheet.create((theme) => ({
    centerContainer: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: theme.colors.groupped.background,
        gap: 12,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: "center" as const,
    },
    scroll: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollContent: {
        paddingBottom: 40,
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        width: "100%" as const,
    },
    statusRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    statusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: "#fff",
    },
    expiresText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    roleText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.accentPurple,
    },
    assignedBadge: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        backgroundColor: theme.dark
            ? "rgba(139,92,246,0.15)"
            : "rgba(109,40,217,0.08)",
    },
    assignedText: {
        ...Typography.default(),
        fontSize: 12,
        color: "#8B5CF6",
    },
    card: {
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 16,
    },
    sectionLabel: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 8,
    },
    questionText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: theme.colors.text,
        lineHeight: 22,
    },
    contextText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: 8,
        lineHeight: 18,
    },
    optionCard: {
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 10,
        padding: 12,
        marginBottom: 8,
        borderWidth: 2,
        borderColor: "transparent",
    },
    optionCardSelected: {
        borderColor: theme.colors.accentPurple,
    },
    optionHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
    },
    optionDesc: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
        flex: 1,
    },
    optionDescSelected: {
        ...Typography.default("semiBold"),
    },
    prosConsRow: {
        flexDirection: "row" as const,
        marginTop: 6,
        paddingLeft: 28,
        gap: 4,
    },
    prosLabel: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: "#10B981",
    },
    consLabel: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: "#EF4444",
    },
    prosConsText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        flex: 1,
    },
    rationaleInput: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 8,
        padding: 12,
        minHeight: 60,
        textAlignVertical: "top" as const,
    },
    rationaleText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
        lineHeight: 20,
    },
    actionContainer: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    adjudicateButton: {
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: "center" as const,
        justifyContent: "center" as const,
    },
    adjudicateButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: "#fff",
    },
    precedentLink: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
    },
    precedentLinkText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.accentPurple,
    },
    opinionRow: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 8,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.groupped.background,
    },
    opinionText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
        flex: 1,
        lineHeight: 18,
    },
    opinionButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 6,
        marginTop: 10,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: theme.colors.groupped.background,
    },
    opinionButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.accentPurple,
    },
}));
