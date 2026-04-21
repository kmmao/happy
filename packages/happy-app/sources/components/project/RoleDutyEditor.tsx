import * as React from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { projectFormSheetStyles as pfs } from "./projectFormSheetStyles";

interface RoleDutyEditorProps {
    duties: string[];
    onDutiesChange: React.Dispatch<React.SetStateAction<string[]>>;
}

export const RoleDutyEditor = React.memo(function RoleDutyEditor({
    duties,
    onDutiesChange,
}: RoleDutyEditorProps) {
    const { theme } = useUnistyles();
    const [newDuty, setNewDuty] = React.useState("");

    const addDuty = React.useCallback(() => {
        if (newDuty.trim() && duties.length < 10) {
            onDutiesChange((previousDuties) => [...previousDuties, newDuty.trim()]);
            setNewDuty("");
        }
    }, [duties.length, newDuty, onDutiesChange]);

    const removeDuty = React.useCallback((dutyIndex: number) => {
        onDutiesChange((previousDuties) =>
            previousDuties.filter((_, index) => index !== dutyIndex),
        );
    }, [onDutiesChange]);

    return (
        <>
            <Text style={pfs.fieldLabel}>{t("roles.dutiesLabel")}</Text>
            {duties.map((duty, dutyIndex) => (
                <View key={dutyIndex} style={styles.dutyRow}>
                    <Text style={styles.dutyText}>{duty}</Text>
                    <Pressable onPress={() => removeDuty(dutyIndex)}>
                        <Ionicons
                            name="close-circle"
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                </View>
            ))}
            {duties.length < 10 ? (
                <View style={styles.addDutyRow}>
                    <TextInput
                        style={[pfs.textInput, { flex: 1 }]}
                        value={newDuty}
                        onChangeText={setNewDuty}
                        placeholder={t("roles.dutiesPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        maxLength={200}
                        onSubmitEditing={addDuty}
                    />
                    <Pressable style={styles.addDutyButton} onPress={addDuty}>
                        <Ionicons name="add" size={20} color={theme.colors.accentPurple} />
                    </Pressable>
                </View>
            ) : null}
        </>
    );
});

const styles = StyleSheet.create((theme) => ({
    dutyRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 4,
    },
    dutyText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
        flex: 1,
    },
    addDutyRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
    },
    addDutyButton: {
        padding: 8,
    },
}));
