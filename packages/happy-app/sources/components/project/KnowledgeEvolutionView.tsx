import * as React from "react";
import { View, Text, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useKnowledgeEvolution } from "@/hooks/useKnowledgeEvolution";
import { useHappyAction } from "@/hooks/useHappyAction";
import { EvolutionTimeline } from "@/components/knowledge/EvolutionTimeline";
import { layout } from "@/components/layout";
import { SharedStateView } from "@/components/SharedStateView";

interface KnowledgeEvolutionViewProps {
    projectServerId: string;
    entryId: string;
}

export const KnowledgeEvolutionView = React.memo<KnowledgeEvolutionViewProps>(
    ({ projectServerId, entryId }) => {
        const { theme } = useUnistyles();
        const { chain, relations, error, state, refresh } = useKnowledgeEvolution(
            projectServerId,
            entryId,
        );

        const [refreshing, doRefresh] = useHappyAction(async () => {
            await refresh();
        });

        if (state.kind === "loading") {
            return (
                <SharedStateView kind="loading" title={t("common.loading")} />
            );
        }

        if (state.kind === "error") {
            return (
                <SharedStateView
                    kind="error"
                    title={t("common.error")}
                    description={error ?? t("projects.knowledgeEvolutionEmptySubtitle")}
                    onAction={doRefresh}
                />
            );
        }

        if (state.kind === "empty") {
            return (
                <SharedStateView
                    kind="empty"
                    title={t("projects.knowledgeEvolutionEmpty")}
                    description={t("projects.knowledgeEvolutionEmptySubtitle")}
                    icon={
                        <Ionicons
                            name="git-branch-outline"
                            size={48}
                            color={theme.colors.textSecondary}
                        />
                    }
                />
            );
        }

        return (
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={doRefresh} />
                }
            >
                <EvolutionTimeline
                    chain={chain}
                    relations={relations}
                    currentEntryId={entryId}
                />
            </ScrollView>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingVertical: 16,
        paddingBottom: 40,
        maxWidth: layout.maxWidth,
        alignSelf: "center",
        width: "100%",
    },
    centerContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 80,
        gap: 8,
    },
    emptyTitle: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        marginTop: 8,
    },
    emptySubtitle: {
        ...Typography.default("regular"),
        fontSize: 13,
        textAlign: "center",
        paddingHorizontal: 40,
    },
}));
