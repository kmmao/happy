import * as React from "react";
import { View } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import { useSession } from "@/sync/storage";
import { WebTerminal } from "@/components/terminal/WebTerminal";

interface SidePanelTerminalTabProps {
    sessionId: string;
}

export const SidePanelTerminalTab = React.memo<SidePanelTerminalTabProps>(
    function SidePanelTerminalTab({ sessionId }) {
        const { theme } = useUnistyles();
        const session = useSession(sessionId);
        const machineId = session?.metadata?.machineId;
        const cwd = session?.metadata?.path;

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
            <View style={{ flex: 1 }}>
                <WebTerminal machineId={machineId} cwd={cwd} sessionId={sessionId} />
            </View>
        );
    },
);
