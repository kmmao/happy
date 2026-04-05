/**
 * WebTerminal — native platform fallback (not supported).
 * The real implementation is in WebTerminal.web.tsx.
 */
import React from "react";
import { View, Text } from "react-native";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";

interface WebTerminalProps {
    machineId: string;
    cwd?: string;
    onClose?: () => void;
}

function WebTerminalComponent(_props: WebTerminalProps) {
    const { theme } = useUnistyles();
    return (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
            <Text style={{
                ...Typography.default("semiBold"),
                fontSize: 16,
                color: theme.colors.textSecondary,
                textAlign: "center",
            }}>
                {t("webTerminal.webOnly")}
            </Text>
        </View>
    );
}

export const WebTerminal = React.memo(WebTerminalComponent);
