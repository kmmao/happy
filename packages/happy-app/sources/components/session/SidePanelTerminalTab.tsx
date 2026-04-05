import * as React from "react";
import { View, Pressable } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { t } from "@/text";
import { useSession } from "@/sync/storage";

interface SidePanelTerminalTabProps {
    sessionId: string;
}

export const SidePanelTerminalTab = React.memo<SidePanelTerminalTabProps>(
    function SidePanelTerminalTab({ sessionId }) {
        const { theme } = useUnistyles();
        const router = useRouter();
        const session = useSession(sessionId);
        const machineId = session?.metadata?.machineId;

        if (!machineId) {
            return (
                <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
                    <Text style={{
                        ...Typography.default(),
                        color: theme.colors.textSecondary,
                        textAlign: "center",
                    }}>
                        {t("sidePanel.sessionOffline")}
                    </Text>
                </View>
            );
        }

        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 16 }}>
                <Ionicons name="terminal-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={{
                    ...Typography.default("semiBold"),
                    fontSize: 15,
                    color: theme.colors.text,
                    textAlign: "center",
                }}>
                    {t("webTerminal.title")}
                </Text>
                <Pressable
                    onPress={() => router.push(`/machine/${machineId}/terminal` as any)}
                    style={{
                        paddingHorizontal: 20,
                        paddingVertical: 10,
                        borderRadius: 8,
                        backgroundColor: theme.colors.accentBlue ?? "#007aff",
                    }}
                >
                    <Text style={{
                        ...Typography.default("semiBold"),
                        fontSize: 14,
                        color: "#fff",
                    }}>
                        {t("webTerminal.openTerminal")}
                    </Text>
                </Pressable>
            </View>
        );
    },
);
