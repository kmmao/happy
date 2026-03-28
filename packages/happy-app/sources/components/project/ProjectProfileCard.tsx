import * as React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";

interface ProjectProfileCardProps {
    profile: {
        techStack: string[];
        architectureType?: string;
        knownPitfalls: string[];
        coreConventions: string[];
        lastUpdatedAt: number;
    } | null;
    onRegenerate?: () => void;
    regenerating?: boolean;
}

export const ProjectProfileCard = React.memo<ProjectProfileCardProps>(
    ({ profile, onRegenerate, regenerating }) => {
        const { theme } = useUnistyles();
        const [expanded, setExpanded] = React.useState(false);

        if (!profile) {
            return null;
        }

        return (
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                <Pressable
                    style={styles.headerRow}
                    onPress={() => setExpanded((prev) => !prev)}
                >
                    <View style={styles.headerLeft}>
                        <Ionicons
                            name="briefcase-outline"
                            size={18}
                            color={theme.colors.header.tint}
                        />
                        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                            {t("projects.knowledgeProfileTitle")}
                        </Text>
                    </View>
                    <Ionicons
                        name={expanded ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>

                {expanded && (
                    <View style={styles.body}>
                        {/* Tech Stack */}
                        {profile.techStack.length > 0 && (
                            <View style={styles.section}>
                                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                                    {t("projects.knowledgeTechStack")}
                                </Text>
                                <View style={styles.badgeRow}>
                                    {profile.techStack.map((tech) => (
                                        <View
                                            key={tech}
                                            style={[styles.techBadge, { backgroundColor: theme.colors.header.tint + "20" }]}
                                        >
                                            <Text style={[styles.techBadgeText, { color: theme.colors.header.tint }]}>
                                                {tech}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            </View>
                        )}

                        {/* Architecture Type */}
                        {profile.architectureType && (
                            <View style={styles.section}>
                                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                                    {t("projects.knowledgeArchitecture")}
                                </Text>
                                <Text style={[styles.sectionValue, { color: theme.colors.text }]}>
                                    {profile.architectureType}
                                </Text>
                            </View>
                        )}

                        {/* Known Pitfalls */}
                        {profile.knownPitfalls.length > 0 && (
                            <View style={styles.section}>
                                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                                    {t("projects.knowledgePitfalls")}
                                </Text>
                                {profile.knownPitfalls.map((pitfall, idx) => (
                                    <View key={idx} style={styles.listItem}>
                                        <Ionicons
                                            name="warning-outline"
                                            size={14}
                                            color="#EF4444"
                                        />
                                        <Text style={[styles.pitfallText, { color: "#EF4444" }]}>
                                            {pitfall}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        )}

                        {/* Core Conventions */}
                        {profile.coreConventions.length > 0 && (
                            <View style={styles.section}>
                                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                                    {t("projects.knowledgeConventions")}
                                </Text>
                                {profile.coreConventions.map((convention, idx) => (
                                    <View key={idx} style={styles.listItem}>
                                        <Ionicons
                                            name="checkmark-circle-outline"
                                            size={14}
                                            color={theme.colors.header.tint}
                                        />
                                        <Text style={[styles.conventionText, { color: theme.colors.text }]}>
                                            {convention}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        )}

                        {/* Regenerate button */}
                        {onRegenerate && (
                            <View style={styles.regenerateRow}>
                                <Pressable
                                    onPress={onRegenerate}
                                    disabled={regenerating}
                                    style={[styles.regenerateButton, { backgroundColor: theme.colors.header.tint + "15" }]}
                                    hitSlop={8}
                                >
                                    {regenerating ? (
                                        <ActivityIndicator size="small" color={theme.colors.header.tint} />
                                    ) : (
                                        <Ionicons
                                            name="refresh-outline"
                                            size={16}
                                            color={theme.colors.header.tint}
                                        />
                                    )}
                                    <Text style={[styles.regenerateText, { color: theme.colors.header.tint }]}>
                                        {t("projects.knowledgeRegenerateProfile")}
                                    </Text>
                                </Pressable>
                            </View>
                        )}
                    </View>
                )}
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 12,
        padding: 14,
        marginHorizontal: 16,
        marginBottom: 10,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    headerTitle: {
        ...Typography.default("semiBold"),
        fontSize: 15,
    },
    body: {
        marginTop: 12,
        gap: 14,
    },
    section: {
        gap: 6,
    },
    sectionLabel: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        textTransform: "uppercase",
    },
    sectionValue: {
        ...Typography.default("regular"),
        fontSize: 14,
    },
    badgeRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
    },
    techBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    techBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
    },
    listItem: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 6,
        paddingVertical: 2,
    },
    pitfallText: {
        ...Typography.default("regular"),
        fontSize: 13,
        lineHeight: 18,
        flex: 1,
    },
    conventionText: {
        ...Typography.default("regular"),
        fontSize: 13,
        lineHeight: 18,
        flex: 1,
    },
    regenerateRow: {
        alignItems: "flex-end",
        marginTop: 4,
    },
    regenerateButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
    },
    regenerateText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
}));
