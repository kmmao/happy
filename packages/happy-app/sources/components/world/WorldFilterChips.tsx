import * as React from "react";
import { ScrollView, TouchableOpacity } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import type { WorldFilter } from "./worldTypes";

interface ChipDef {
    label: string;
    filter: WorldFilter;
}

interface SourceChipInfo {
    id: string;
    label: string;
}

interface WorldFilterChipsProps {
    activeFilter: WorldFilter;
    onFilterChange: (filter: WorldFilter) => void;
    projects?: SourceChipInfo[];
    machines?: SourceChipInfo[];
}

function filtersEqual(a: WorldFilter, b: WorldFilter): boolean {
    return (
        a.projectId === b.projectId &&
        a.machineId === b.machineId &&
        a.eventTypePrefix === b.eventTypePrefix &&
        a.severity === b.severity
    );
}

export const WorldFilterChips = React.memo(function WorldFilterChips({
    activeFilter,
    onFilterChange,
    projects = [],
    machines = [],
}: WorldFilterChipsProps) {
    const staticChips: ChipDef[] = [
        { label: t("world.filterAll"), filter: {} },
        { label: "task.*", filter: { eventTypePrefix: "task." } },
        { label: "decision.*", filter: { eventTypePrefix: "decision." } },
        { label: "supervisor.*", filter: { eventTypePrefix: "supervisor." } },
        { label: "session.*", filter: { eventTypePrefix: "session." } },
        { label: "memory.*", filter: { eventTypePrefix: "memory." } },
        { label: "trigger.*", filter: { eventTypePrefix: "trigger." } },
        { label: "⚠️", filter: { severity: "warning" } },
        { label: "🔴", filter: { severity: "critical" } },
    ];

    const projectChips: ChipDef[] = projects.slice(0, 4).map((p) => ({
        label: p.label,
        filter: { projectId: p.id },
    }));

    const machineChips: ChipDef[] = machines.slice(0, 3).map((m) => ({
        label: `🖥 ${m.label}`,
        filter: { machineId: m.id },
    }));

    const allChips = [...staticChips, ...projectChips, ...machineChips];

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={containerStyle}
        >
            {allChips.map((chip) => (
                <Chip
                    key={chip.label}
                    label={chip.label}
                    active={filtersEqual(activeFilter, chip.filter)}
                    onPress={() => onFilterChange(chip.filter)}
                />
            ))}
        </ScrollView>
    );
});

const containerStyle = {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    flexDirection: "row" as const,
};

interface ChipProps {
    label: string;
    active: boolean;
    onPress: () => void;
}

const Chip = React.memo(function Chip({ label, active, onPress }: ChipProps) {
    const { theme } = useUnistyles();
    const styles = StyleSheet.create({
        chip: {
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 16,
            backgroundColor: active ? theme.colors.primary : theme.colors.surfaceHigh,
            borderWidth: 1,
            borderColor: active ? theme.colors.primary : theme.colors.divider,
        },
        label: {
            fontSize: 13,
            color: active ? "#fff" : theme.colors.text,
        },
    });
    return (
        <TouchableOpacity style={styles.chip} onPress={onPress} activeOpacity={0.7}>
            <Text style={styles.label}>{label}</Text>
        </TouchableOpacity>
    );
});
