import React from "react";
import { View, Platform, ActivityIndicator } from "react-native";
import { Text } from "@/components/StyledText";
import { useLocalSearchParams, Stack } from "expo-router";
import { Typography } from "@/constants/Typography";
import { useMachine } from "@/sync/storage";
import { isMachineOnline } from "@/utils/machineUtils";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { WebTerminal } from "@/components/terminal/WebTerminal";

function TerminalPage() {
    // `sessionId` (optional) — when present, the WebTerminal attaches to the
    // Claude PTY broadcast under `terminalId = "claude:<sessionId>"` (see
    // packages/happy-cli/src/claude/pty/claudePtyRouter.ts). Without it the
    // terminal spawns a fresh generic shell PTY.
    const { id: machineId, sessionId } = useLocalSearchParams<{
        id: string;
        sessionId?: string;
    }>();
    const machine = useMachine(machineId);
    const { theme } = useUnistyles();
    const isOnline = machine ? isMachineOnline(machine) : false;

    if (!machine) {
        return (
            <View style={styles.center}>
                <ActivityIndicator />
            </View>
        );
    }

    // Web-only feature
    if (Platform.OS !== "web") {
        return (
            <>
                <Stack.Screen options={{ title: t("webTerminal.title") }} />
                <View style={styles.center}>
                    <Ionicons
                        name="laptop-outline"
                        size={48}
                        color={theme.colors.textSecondary}
                        style={{ marginBottom: 16 }}
                    />
                    <Text style={{
                        ...Typography.default("semiBold"),
                        fontSize: 16,
                        color: theme.colors.textSecondary,
                        textAlign: "center",
                    }}>
                        {t("webTerminal.webOnly")}
                    </Text>
                </View>
            </>
        );
    }

    // Machine must be online
    if (!isOnline) {
        return (
            <>
                <Stack.Screen options={{ title: t("webTerminal.title") }} />
                <View style={styles.center}>
                    <Ionicons
                        name="cloud-offline-outline"
                        size={48}
                        color={theme.colors.textSecondary}
                        style={{ marginBottom: 16 }}
                    />
                    <Text style={{
                        ...Typography.default("semiBold"),
                        fontSize: 16,
                        color: theme.colors.textSecondary,
                        textAlign: "center",
                    }}>
                        {t("webTerminal.requiresOnline")}
                    </Text>
                </View>
            </>
        );
    }

    return (
        <>
            <Stack.Screen options={{ title: t("webTerminal.title") }} />
            <View style={styles.container}>
                <WebTerminal machineId={machineId} sessionId={sessionId} />
            </View>
        </>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped?.background ?? "#000000",
    },
    center: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
    },
}));

export default React.memo(TerminalPage);
