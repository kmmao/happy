import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { projectFormSheetStyles as pfs } from "./projectFormSheetStyles";
import { t } from "@/text";
import {
    AVAILABILITY_COLORS,
    AVAILABILITY_LABELS,
    NOTIFY_LABELS,
} from "./memberFormPresentation";

interface MemberPermissionSectionProps {
    decisionScope: string;
    onDecisionScopeChange: React.Dispatch<React.SetStateAction<string>>;
    maxConcurrency: number;
    onMaxConcurrencyChange: React.Dispatch<React.SetStateAction<number>>;
    notifyLevel: string;
    onNotifyLevelChange: React.Dispatch<React.SetStateAction<string>>;
    availability: string;
    onAvailabilityChange: React.Dispatch<React.SetStateAction<string>>;
}

export const MemberPermissionSection = React.memo(function MemberPermissionSection({
    decisionScope,
    onDecisionScopeChange,
    maxConcurrency,
    onMaxConcurrencyChange,
    notifyLevel,
    onNotifyLevelChange,
    availability,
    onAvailabilityChange,
}: MemberPermissionSectionProps) {
    return (
        <>
            <View style={pfs.sectionDivider}>
                <View style={pfs.sectionDividerLine} />
                <Text style={pfs.sectionDividerLabel}>{t("members.permissionsSection")}</Text>
                <View style={pfs.sectionDividerLine} />
            </View>

            <Text style={pfs.fieldLabel}>{t("members.decisionScopeLabel")}</Text>
            <View style={pfs.chipRow}>
                {(["all", "assigned", "none"] as const).map((scope) => {
                    const isSelected = decisionScope === scope;
                    return (
                        <Pressable
                            key={scope}
                            style={[pfs.chip, isSelected && { backgroundColor: "#7C3AED" }]}
                            onPress={() => onDecisionScopeChange(scope)}
                        >
                            <Text style={[pfs.chipText, isSelected && { color: "#fff" }]}>
                                {scope === "all"
                                    ? t("members.decisionAll")
                                    : scope === "assigned"
                                        ? t("members.decisionAssigned")
                                        : t("members.decisionNone")}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>

            <View style={pfs.sectionDivider}>
                <View style={pfs.sectionDividerLine} />
                <Text style={pfs.sectionDividerLabel}>{t("members.capacitySection")}</Text>
                <View style={pfs.sectionDividerLine} />
            </View>

            <Text style={pfs.fieldLabel}>{t("members.maxConcurrencyLabel")}</Text>
            <View style={pfs.chipRow}>
                {[1, 2, 3, 5, 10].map((concurrency) => {
                    const isSelected = maxConcurrency === concurrency;
                    return (
                        <Pressable
                            key={concurrency}
                            style={[pfs.chip, isSelected && { backgroundColor: "#7C3AED" }]}
                            onPress={() => onMaxConcurrencyChange(concurrency)}
                        >
                            <Text style={[pfs.chipText, isSelected && { color: "#fff" }]}>
                                {concurrency}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>

            <View style={pfs.sectionDivider}>
                <View style={pfs.sectionDividerLine} />
                <Text style={pfs.sectionDividerLabel}>{t("members.notificationsSection")}</Text>
                <View style={pfs.sectionDividerLine} />
            </View>

            <Text style={pfs.fieldLabel}>{t("members.notifyLevelLabel")}</Text>
            <View style={pfs.chipRow}>
                {(["all", "critical", "assigned", "none"] as const).map((level) => {
                    const isSelected = notifyLevel === level;
                    return (
                        <Pressable
                            key={level}
                            style={[pfs.chip, isSelected && { backgroundColor: "#7C3AED" }]}
                            onPress={() => onNotifyLevelChange(level)}
                        >
                            <Text style={[pfs.chipText, isSelected && { color: "#fff" }]}>
                                {NOTIFY_LABELS[level]?.() ?? level}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>

            <Text style={pfs.fieldLabel}>{t("members.availabilityLabel")}</Text>
            <View style={pfs.chipRow}>
                {(["active", "away", "delegate"] as const).map((nextAvailability) => {
                    const isSelected = availability === nextAvailability;
                    return (
                        <Pressable
                            key={nextAvailability}
                            style={[
                                pfs.chip,
                                isSelected && { backgroundColor: AVAILABILITY_COLORS[nextAvailability] },
                            ]}
                            onPress={() => onAvailabilityChange(nextAvailability)}
                        >
                            <Text style={[pfs.chipText, isSelected && { color: "#fff" }]}>
                                {AVAILABILITY_LABELS[nextAvailability]?.() ?? nextAvailability}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </>
    );
});
