import * as React from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { useAllMachines } from "@/sync/storage";
import { Ionicons } from "@expo/vector-icons";
import { isMachineOnline } from "@/utils/machineUtils";
import { useHappyAction } from "@/hooks/useHappyAction";
import { sync } from "@/sync/sync";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { t } from "@/text";

function AddProjectScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const machines = useAllMachines();

    const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(null);
    const [path, setPath] = React.useState("");

    const isValidPath = path.trim().startsWith("/") && path.trim().length > 1;
    const canSubmit = selectedMachineId !== null && isValidPath;

    const [loading, doCreate] = useHappyAction(
        React.useCallback(async () => {
            if (!selectedMachineId || !path.trim()) return;
            await sync.createManualProject(selectedMachineId, path.trim());
            router.back();
        }, [selectedMachineId, path, router]),
    );

    if (machines.length === 0) {
        return (
            <View style={styles.emptyContainer}>
                <Ionicons
                    name="desktop-outline"
                    size={64}
                    color={theme.colors.textSecondary}
                />
                <Text style={styles.emptyText}>
                    {t("projects.noMachines")}
                </Text>
            </View>
        );
    }

    return (
        <ItemList>
            <ItemGroup title={t("projects.selectMachine")}>
                {machines.map((machine) => {
                    const name =
                        machine.metadata?.displayName ||
                        machine.metadata?.host ||
                        machine.id;
                    const isOnline = isMachineOnline(machine);
                    const isSelected = selectedMachineId === machine.id;

                    return (
                        <Item
                            key={machine.id}
                            title={name}
                            icon={
                                <Ionicons
                                    name="desktop-outline"
                                    size={24}
                                    color={theme.colors.text}
                                />
                            }
                            onPress={() => setSelectedMachineId(machine.id)}
                            rightElement={
                                <View style={styles.machineRight}>
                                    <View
                                        style={[
                                            styles.statusDot,
                                            {
                                                backgroundColor: isOnline
                                                    ? theme.colors.status.connected
                                                    : theme.colors.status.disconnected,
                                            },
                                        ]}
                                    />
                                    {isSelected && (
                                        <Ionicons
                                            name="checkmark"
                                            size={22}
                                            color={theme.colors.header.tint}
                                        />
                                    )}
                                </View>
                            }
                        />
                    );
                })}
            </ItemGroup>

            <ItemGroup title={t("projects.projectPath")}>
                <View style={styles.inputContainer}>
                    <TextInput
                        style={[
                            styles.textInput,
                            { color: theme.colors.text },
                        ]}
                        placeholder={t("projects.pathPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={path}
                        onChangeText={setPath}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="off"
                    />
                </View>
            </ItemGroup>

            <View style={styles.buttonContainer}>
                <Pressable
                    style={[
                        styles.createButton,
                        {
                            backgroundColor: canSubmit && !loading
                                ? theme.colors.header.tint
                                : theme.colors.textSecondary,
                        },
                    ]}
                    onPress={doCreate}
                    disabled={!canSubmit || loading}
                >
                    <Text style={styles.createButtonText}>
                        {loading
                            ? t("common.loading")
                            : t("projects.create")}
                    </Text>
                </Pressable>
            </View>
        </ItemList>
    );
}

const styles = StyleSheet.create((theme) => ({
    emptyContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
        backgroundColor: theme.colors.groupped.background,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: "center",
        marginTop: 16,
    },
    machineRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    inputContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    textInput: {
        ...Typography.mono(),
        fontSize: 15,
    },
    buttonContainer: {
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    createButton: {
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: "center",
    },
    createButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: "#FFFFFF",
    },
}));

export default React.memo(AddProjectScreen);
