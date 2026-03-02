import * as React from "react";
import { View, Text, ScrollView } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import {
    type KanbanTask,
    type KanbanColumnId,
    KANBAN_COLUMN_LABELS,
} from "@/sync/kanbanTypes";
import { KANBAN_COLUMN_COLORS } from "@/components/project/designTokens";
import { KanbanTaskCard } from "./KanbanTaskCard";
import { KanbanColumnEmptyState } from "./KanbanColumnEmptyState";

interface KanbanBoardColumnProps {
    readonly columnId: KanbanColumnId;
    readonly tasks: ReadonlyArray<KanbanTask>;
    readonly onTaskPress: (taskId: string) => void;
    readonly onTaskLongPress: (taskId: string) => void;
}

export const KanbanBoardColumn = React.memo(
    ({ columnId, tasks, onTaskPress, onTaskLongPress }: KanbanBoardColumnProps) => {
        const { theme } = useUnistyles();
        const columnColor = KANBAN_COLUMN_COLORS[columnId];

        return (
            <View
                style={[
                    styles.column,
                    { backgroundColor: theme.colors.surface },
                ]}
            >
                {/* Colored top border */}
                <View
                    style={[styles.colorBar, { backgroundColor: columnColor }]}
                />

                {/* Header */}
                <View style={styles.header}>
                    <Text
                        style={[styles.headerTitle, { color: theme.colors.text }]}
                        numberOfLines={1}
                    >
                        {t(KANBAN_COLUMN_LABELS[columnId])}
                    </Text>
                    <View
                        style={[styles.badge, { backgroundColor: columnColor }]}
                    >
                        <Text style={styles.badgeText}>
                            {tasks.length}
                        </Text>
                    </View>
                </View>

                {/* Task list or empty state */}
                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={
                        tasks.length === 0 ? styles.emptyContent : styles.listContent
                    }
                    showsVerticalScrollIndicator={false}
                >
                    {tasks.length > 0
                        ? tasks.map((task) => (
                            <KanbanTaskCard
                                key={task.id}
                                task={task}
                                onPress={onTaskPress}
                                onLongPress={onTaskLongPress}
                                compact
                            />
                        ))
                        : <KanbanColumnEmptyState columnId={columnId} />
                    }
                </ScrollView>
            </View>
        );
    },
);

const styles = StyleSheet.create(() => ({
    column: {
        flex: 1,
        borderRadius: 12,
        overflow: "hidden",
    },
    colorBar: {
        height: 3,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 6,
    },
    headerTitle: {
        fontSize: 13,
        flex: 1,
        ...Typography.default("semiBold"),
    },
    badge: {
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        paddingHorizontal: 6,
        alignItems: "center",
        justifyContent: "center",
    },
    badgeText: {
        fontSize: 11,
        color: "#FFFFFF",
        ...Typography.default("semiBold"),
    },
    scrollView: {
        flex: 1,
    },
    listContent: {
        paddingVertical: 2,
        paddingBottom: 8,
    },
    emptyContent: {
        flex: 1,
    },
}));
