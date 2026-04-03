import * as React from "react";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { t } from "@/text";

interface BriefMessage {
    loopId: string;
    loopName?: string;
    status: "completed" | "failed" | "cancelled";
    summary: string;
    detail: string;
    generatedAt: number;
    sessionId?: string;
}

interface BriefSectionProps {
    briefs: readonly BriefMessage[];
}

function formatBriefTime(generatedAt: number): string {
    const diffMs = Date.now() - generatedAt;
    if (diffMs < 60_000) return t("time.justNow");
    if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m`;
    if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h`;
    return new Date(generatedAt).toLocaleDateString();
}

function getBriefStatusIcon(status: string): { name: keyof typeof Ionicons.glyphMap; color: string } {
    switch (status) {
        case "completed":
            return { name: "checkmark-circle", color: "#4CAF50" };
        case "failed":
            return { name: "alert-circle", color: "#F44336" };
        case "cancelled":
            return { name: "close-circle", color: "#FF9800" };
        default:
            return { name: "information-circle", color: "#9E9E9E" };
    }
}

export const BriefSection = React.memo(function BriefSection({ briefs }: BriefSectionProps) {
    const { theme } = useUnistyles();
    const [expandedKey, setExpandedKey] = React.useState<string | null>(null);

    if (briefs.length === 0) return null;

    return (
        <ItemGroup title={t("machine.agentLoopBriefs")}>
            {briefs.slice(0, 5).map((brief) => {
                const icon = getBriefStatusIcon(brief.status);
                const key = `${brief.loopId}-${brief.generatedAt}`;
                const isExpanded = expandedKey === key;
                return (
                    <View key={key}>
                        <Item
                            title={brief.loopName ?? brief.loopId}
                            subtitle={brief.summary}
                            icon={
                                <Ionicons
                                    name={icon.name}
                                    size={20}
                                    color={icon.color}
                                />
                            }
                            rightElement={
                                <Text style={[styles.timeText, { color: theme.colors.textSecondary }]}>
                                    {formatBriefTime(brief.generatedAt)}
                                </Text>
                            }
                            onPress={() => setExpandedKey(isExpanded ? null : key)}
                        />
                        {isExpanded && (
                            <View style={[styles.detailContainer, { backgroundColor: theme.colors.surfaceHigh }]}>
                                <Text style={[styles.detailText, { color: theme.colors.textSecondary }]}>
                                    {brief.detail}
                                </Text>
                            </View>
                        )}
                    </View>
                );
            })}
        </ItemGroup>
    );
});

const styles = StyleSheet.create({
    timeText: {
        fontSize: 12,
    },
    detailContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginHorizontal: 8,
        marginBottom: 8,
        borderRadius: 8,
    },
    detailText: {
        fontSize: 13,
        lineHeight: 18,
    },
});
