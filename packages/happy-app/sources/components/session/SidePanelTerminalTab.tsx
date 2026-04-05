import * as React from "react";
import { View, Pressable, ScrollView } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { useSession } from "@/sync/storage";
import { WebTerminal } from "@/components/terminal/WebTerminal";
import {
    machineTerminalList,
    machineTerminalSpawn,
    machineTerminalClose,
} from "@/sync/ops";

interface TerminalTab {
    terminalId: string;
    labelIndex: number;
}

interface SidePanelTerminalTabProps {
    sessionId: string;
}

export const SidePanelTerminalTab = React.memo<SidePanelTerminalTabProps>(
    function SidePanelTerminalTab({ sessionId }) {
        const { theme } = useUnistyles();
        const session = useSession(sessionId);
        const machineId = session?.metadata?.machineId;
        const cwd = session?.metadata?.path;

        const [tabs, setTabs] = React.useState<TerminalTab[]>([]);
        const [activeTabId, setActiveTabId] = React.useState<string | null>(null);
        const [isLoading, setIsLoading] = React.useState(true);
        const labelCounterRef = React.useRef(0);

        // Refs for stable callbacks
        const tabsRef = React.useRef<TerminalTab[]>([]);
        const activeTabIdRef = React.useRef<string | null>(null);
        React.useEffect(() => { tabsRef.current = tabs; }, [tabs]);
        React.useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

        // Initialize: restore existing terminals or spawn the first one
        React.useEffect(() => {
            if (!machineId) {
                setIsLoading(false);
                return;
            }

            let cancelled = false;

            async function init() {
                setIsLoading(true);
                try {
                    const listResult = await machineTerminalList(machineId!, sessionId);
                    if (cancelled) return;

                    if (listResult.success && listResult.terminals && listResult.terminals.length > 0) {
                        const restoredTabs = listResult.terminals.map((term, i) => ({
                            terminalId: term.id,
                            labelIndex: i + 1,
                        }));
                        labelCounterRef.current = restoredTabs.length;
                        setTabs(restoredTabs);
                        setActiveTabId(restoredTabs[0].terminalId);
                    } else {
                        // No existing terminals — spawn first one
                        const spawnResult = await machineTerminalSpawn(machineId!, { cwd, sessionId });
                        if (cancelled) return;
                        if (spawnResult.success && spawnResult.terminalId) {
                            labelCounterRef.current = 1;
                            setTabs([{ terminalId: spawnResult.terminalId, labelIndex: 1 }]);
                            setActiveTabId(spawnResult.terminalId);
                        }
                    }
                } finally {
                    if (!cancelled) setIsLoading(false);
                }
            }

            init();
            return () => { cancelled = true; };
        }, [machineId, sessionId, cwd]);

        const handleAddTerminal = React.useCallback(async () => {
            if (!machineId) return;
            const result = await machineTerminalSpawn(machineId, { cwd, sessionId });
            if (result.success && result.terminalId) {
                const newIndex = ++labelCounterRef.current;
                setTabs((prev) => [...prev, { terminalId: result.terminalId!, labelIndex: newIndex }]);
                setActiveTabId(result.terminalId);
            }
        }, [machineId, cwd, sessionId]);

        const handleCloseTab = React.useCallback(async (terminalId: string) => {
            if (!machineId) return;
            await machineTerminalClose(machineId, terminalId);

            const currentTabs = tabsRef.current;
            const updated = currentTabs.filter((tab) => tab.terminalId !== terminalId);
            setTabs(updated);

            if (activeTabIdRef.current === terminalId) {
                if (updated.length > 0) {
                    const idx = currentTabs.findIndex((tab) => tab.terminalId === terminalId);
                    setActiveTabId(updated[Math.min(idx, updated.length - 1)].terminalId);
                } else {
                    setActiveTabId(null);
                }
            }
        }, [machineId]);

        // Auto-create a new terminal if all were closed
        React.useEffect(() => {
            if (!isLoading && tabs.length === 0 && machineId) {
                handleAddTerminal();
            }
        }, [tabs.length, isLoading, machineId, handleAddTerminal]);

        if (!machineId) {
            return (
                <View style={offlineContainer}>
                    <Text style={{ ...Typography.default(), color: theme.colors.textSecondary, textAlign: "center" }}>
                        {t("sidePanel.sessionOffline")}
                    </Text>
                </View>
            );
        }

        if (isLoading) {
            return (
                <View style={offlineContainer}>
                    <Text style={{ ...Typography.default(), color: theme.colors.textSecondary }}>
                        {t("webTerminal.connecting")}
                    </Text>
                </View>
            );
        }

        return (
            <View style={{ flex: 1 }}>
                {/* Tab bar */}
                <View style={{
                    flexDirection: "row",
                    alignItems: "center",
                    borderBottomWidth: 0.5,
                    borderBottomColor: theme.colors.divider,
                    backgroundColor: theme.colors.groupped?.background ?? theme.colors.primary,
                    height: 36,
                }}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={{ flex: 1 }}
                        contentContainerStyle={{ alignItems: "center", paddingHorizontal: 4 }}
                    >
                        {tabs.map((tab) => {
                            const isActive = tab.terminalId === activeTabId;
                            return (
                                <Pressable
                                    key={tab.terminalId}
                                    onPress={() => setActiveTabId(tab.terminalId)}
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        paddingHorizontal: 10,
                                        paddingVertical: 4,
                                        marginRight: 2,
                                        borderRadius: 4,
                                        backgroundColor: isActive
                                            ? (theme.colors.accentBlue ?? "#007aff") + "20"
                                            : "transparent",
                                        borderWidth: 0.5,
                                        borderColor: isActive
                                            ? (theme.colors.accentBlue ?? "#007aff") + "60"
                                            : "transparent",
                                    }}
                                >
                                    <Text style={{
                                        ...Typography.default(),
                                        fontSize: 12,
                                        color: isActive
                                            ? (theme.colors.accentBlue ?? "#007aff")
                                            : theme.colors.textSecondary,
                                        marginRight: tabs.length > 1 ? 5 : 0,
                                    }}>
                                        {t("webTerminal.sessionLabel", { n: tab.labelIndex })}
                                    </Text>
                                    {tabs.length > 1 && (
                                        <Pressable
                                            onPress={() => handleCloseTab(tab.terminalId)}
                                            hitSlop={6}
                                        >
                                            <Ionicons
                                                name="close"
                                                size={10}
                                                color={isActive
                                                    ? (theme.colors.accentBlue ?? "#007aff")
                                                    : theme.colors.textSecondary}
                                            />
                                        </Pressable>
                                    )}
                                </Pressable>
                            );
                        })}
                    </ScrollView>

                    {/* New terminal button */}
                    <Pressable
                        onPress={handleAddTerminal}
                        hitSlop={4}
                        style={{
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                            borderLeftWidth: 0.5,
                            borderLeftColor: theme.colors.divider,
                        }}
                    >
                        <Ionicons name="add" size={16} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>

                {/* Terminal instances — all kept mounted; only active one is visible */}
                <View style={{ flex: 1, position: "relative" }}>
                    {tabs.map((tab) => (
                        <View
                            key={tab.terminalId}
                            style={[
                                { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
                                tab.terminalId !== activeTabId && { display: "none" },
                            ]}
                        >
                            <WebTerminal
                                machineId={machineId}
                                cwd={cwd}
                                sessionId={sessionId}
                                terminalId={tab.terminalId}
                                isActive={tab.terminalId === activeTabId}
                                showInternalCloseButton={false}
                                onClose={() => handleCloseTab(tab.terminalId)}
                            />
                        </View>
                    ))}
                </View>
            </View>
        );
    },
);

const offlineContainer = { flex: 1, justifyContent: "center" as const, alignItems: "center" as const, padding: 24 };
