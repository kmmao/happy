import * as React from "react";
import { View } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useSession } from "@/sync/storage";
import { WebTerminal } from "@/components/terminal/WebTerminal";
import { machineClaudePtyAttach } from "@/sync/ops";

interface SidePanelClaudeTabProps {
    sessionId: string;
}

type AttachState =
    | { kind: "loading" }
    | { kind: "offline" }
    | { kind: "missing" }
    | { kind: "attached"; terminalId: string };

/**
 * Side panel tab that mirrors the Claude CLI PTY owned by `claudePtyRuntime`
 * in the session child. Single-instance — there is at most one Claude PTY
 * per session and its lifecycle is owned by the session itself, so no
 * spawn / close affordances are rendered here. When no Claude TUI is
 * currently attached we render a placeholder; the tab stays visible so the
 * user always knows where to find it.
 *
 * Separating this from the multi-shell `SidePanelTerminalTab` is what fixes
 * the "+ does nothing" bug — without the split, `terminal-spawn` with only
 * a sessionId would silently reattach to the Claude PTY instead of opening
 * a new shell.
 */
export const SidePanelClaudeTab = React.memo<SidePanelClaudeTabProps>(
    function SidePanelClaudeTab({ sessionId }) {
        const { theme } = useUnistyles();
        const session = useSession(sessionId);
        const machineId = session?.metadata?.machineId;
        const cwd = session?.metadata?.path;

        const [state, setState] = React.useState<AttachState>({ kind: "loading" });

        React.useEffect(() => {
            if (!machineId) {
                setState({ kind: "offline" });
                return;
            }
            let cancelled = false;
            setState({ kind: "loading" });
            (async () => {
                const result = await machineClaudePtyAttach(machineId, sessionId);
                if (cancelled) return;
                if (result.success && result.exists && result.terminalId) {
                    setState({ kind: "attached", terminalId: result.terminalId });
                } else {
                    setState({ kind: "missing" });
                }
            })();
            return () => { cancelled = true; };
        }, [machineId, sessionId]);

        if (!machineId || state.kind === "offline") {
            return (
                <View style={placeholderContainer}>
                    <Text style={{ ...Typography.default(), color: theme.colors.textSecondary, textAlign: "center" }}>
                        {t("sidePanel.sessionOffline")}
                    </Text>
                </View>
            );
        }

        if (state.kind === "loading") {
            return (
                <View style={placeholderContainer}>
                    <Text style={{ ...Typography.default(), color: theme.colors.textSecondary }}>
                        {t("webTerminal.connecting")}
                    </Text>
                </View>
            );
        }

        if (state.kind === "missing") {
            return (
                <View style={placeholderContainer}>
                    <Text style={{ ...Typography.default(), color: theme.colors.textSecondary, textAlign: "center" }}>
                        {t("sidePanel.claudeNotRunning")}
                    </Text>
                </View>
            );
        }

        return (
            <View style={{ flex: 1 }}>
                <WebTerminal
                    machineId={machineId}
                    cwd={cwd}
                    sessionId={sessionId}
                    terminalId={state.terminalId}
                    isActive
                    showInternalCloseButton={false}
                />
            </View>
        );
    },
);

const placeholderContainer = { flex: 1, justifyContent: "center" as const, alignItems: "center" as const, padding: 24 };
