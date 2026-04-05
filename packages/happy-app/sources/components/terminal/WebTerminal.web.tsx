/**
 * WebTerminal — xterm.js-based web terminal emulator.
 * Connects to a CLI daemon's PTY via Socket.IO relay.
 *
 * Web-only component (uses DOM APIs).
 */
import React, { useRef, useEffect, useCallback, useState } from "react";
import { View } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";
import { apiSocket } from "@/sync/apiSocket";
import {
    machineTerminalSpawn,
    machineTerminalClose,
    machineTerminalResize,
    machineTerminalInput,
    machineUpgradeCli,
} from "@/sync/ops";
import { useMachine } from "@/sync/storage";
import { useCliVersionCheck } from "@/hooks/useCliVersionCheck";
import { t } from "@/text";

interface WebTerminalProps {
    machineId: string;
    cwd?: string;
    onClose?: () => void;
}

type TerminalState = "connecting" | "connected" | "disconnected" | "error";

function WebTerminalComponent({ machineId, cwd, onClose }: WebTerminalProps) {
    const { theme } = useUnistyles();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<any>(null);
    const fitAddonRef = useRef<any>(null);
    const terminalIdRef = useRef<string | null>(null);
    const [state, setState] = useState<TerminalState>("connecting");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateMsg, setUpdateMsg] = useState<string | null>(null);

    const machine = useMachine(machineId);
    const currentCliVersion = machine?.daemonState?.startedWithCliVersion;
    const { latestVersion, hasUpdate } = useCliVersionCheck(currentCliVersion);

    const cleanup = useCallback(() => {
        if (terminalIdRef.current) {
            machineTerminalClose(machineId, terminalIdRef.current);
            terminalIdRef.current = null;
        }
        if (terminalRef.current) {
            terminalRef.current.dispose();
            terminalRef.current = null;
        }
    }, [machineId]);

    useEffect(() => {
        let mounted = true;
        let outputCleanup: (() => void) | null = null;
        let exitCleanup: (() => void) | null = null;

        async function init() {
            // Dynamically import xterm (web-only, avoids Metro bundling for native)
            const [{ Terminal }, { FitAddon }] = await Promise.all([
                import("@xterm/xterm"),
                import("@xterm/addon-fit"),
            ]);

            // Also load xterm CSS
            if (!document.querySelector('link[data-xterm-css]')) {
                const link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = "https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.min.css";
                link.setAttribute("data-xterm-css", "true");
                document.head.appendChild(link);
            }

            if (!mounted || !containerRef.current) return;

            const bg = theme.colors.groupped?.background ?? "#000000";
            const isDark = bg === "#000000" || bg.startsWith("#0") || bg.startsWith("#1");

            const terminal = new Terminal({
                cursorBlink: true,
                fontSize: 14,
                fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
                theme: {
                    background: isDark ? "#1a1a2e" : "#ffffff",
                    foreground: isDark ? "#e0e0e0" : "#1a1a1a",
                    cursor: isDark ? "#e0e0e0" : "#1a1a1a",
                    selectionBackground: isDark ? "#44475a" : "#b5d5ff",
                },
                allowProposedApi: true,
            });

            const fitAddon = new FitAddon();
            terminal.loadAddon(fitAddon);

            terminalRef.current = terminal;
            fitAddonRef.current = fitAddon;

            terminal.open(containerRef.current);

            // Small delay to ensure DOM is ready for fit
            requestAnimationFrame(() => {
                if (!mounted) return;
                try { fitAddon.fit(); } catch { /* ignore initial fit errors */ }
            });

            const cols = terminal.cols;
            const rows = terminal.rows;

            // Register socket listener BEFORE spawn to avoid race condition:
            // terminal-exit can fire within ms of spawn (e.g. PTY allocation failure),
            // before the async spawn RPC response returns and we set terminalIdRef.
            // Buffer events until terminalId is known, then replay them.
            const pendingEvents: any[] = [];
            outputCleanup = apiSocket.onMessage("ephemeral", (data: any) => {
                if (data.machineId !== machineId) return;
                if (!terminalIdRef.current) {
                    if (data.type === "terminal-output" || data.type === "terminal-exit") {
                        pendingEvents.push(data);
                    }
                    return;
                }
                if (data.terminalId !== terminalIdRef.current) return;
                if (data.type === "terminal-output") {
                    terminal.write(data.data);
                }
                if (data.type === "terminal-exit") {
                    terminal.write(`\r\n\x1b[90m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`);
                    setState("disconnected");
                    terminalIdRef.current = null;
                    onClose?.();
                }
            });

            // Spawn PTY on the machine
            const result = await machineTerminalSpawn(machineId, { cwd, cols, rows });
            if (!mounted) return;

            if (!result.success || !result.terminalId) {
                setState("error");
                setErrorMsg(result.error || t("webTerminal.spawnFailed"));
                return;
            }

            terminalIdRef.current = result.terminalId;
            setState("connected");

            // Replay any buffered events that arrived before terminalId was set
            for (const data of pendingEvents) {
                if (data.terminalId !== terminalIdRef.current) continue;
                if (data.type === "terminal-output") {
                    terminal.write(data.data);
                }
                if (data.type === "terminal-exit") {
                    terminal.write(`\r\n\x1b[90m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`);
                    setState("disconnected");
                    terminalIdRef.current = null;
                    onClose?.();
                    break;
                }
            }

            // Send input to the machine
            terminal.onData((data: string) => {
                if (terminalIdRef.current) {
                    machineTerminalInput(machineId, terminalIdRef.current, data);
                }
            });

            // Handle resize
            terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
                if (terminalIdRef.current) {
                    machineTerminalResize(machineId, terminalIdRef.current, cols, rows);
                }
            });

            // Window resize → fit terminal
            const onWindowResize = () => {
                try { fitAddon.fit(); } catch { /* ignore */ }
            };
            window.addEventListener("resize", onWindowResize);
            exitCleanup = () => window.removeEventListener("resize", onWindowResize);
        }

        init().catch((err) => {
            if (mounted) {
                setState("error");
                setErrorMsg(err.message || t("webTerminal.initFailed"));
            }
        });

        return () => {
            mounted = false;
            outputCleanup?.();
            exitCleanup?.();
            cleanup();
        };
    }, [machineId, cwd, theme.colors.groupped?.background, cleanup, onClose, retryKey]);

    const handleRetry = React.useCallback(() => {
        setState("connecting");
        setErrorMsg(null);
        setUpdateMsg(null);
        setRetryKey((k) => k + 1);
    }, []);

    const handleUpdateCli = React.useCallback(async () => {
        if (!latestVersion || isUpdating) return;
        setIsUpdating(true);
        setUpdateMsg(t("webTerminal.updating"));
        try {
            const result = await machineUpgradeCli(machineId, latestVersion);
            if (!result.success) {
                setUpdateMsg(result.error ?? t("webTerminal.updateFailed"));
                setIsUpdating(false);
                return;
            }
            setUpdateMsg(t("webTerminal.updateWaiting"));
            // Daemon detects version change and restarts within ~60s
            setTimeout(() => {
                setIsUpdating(false);
                handleRetry();
            }, 65_000);
        } catch {
            setUpdateMsg(t("webTerminal.updateFailed"));
            setIsUpdating(false);
        }
    }, [latestVersion, isUpdating, machineId, handleRetry]);

    if (state === "error" || state === "disconnected") {
        const btnBase: React.CSSProperties = {
            marginTop: 8,
            padding: "8px 20px",
            borderRadius: 8,
            border: "none",
            fontSize: 14,
            cursor: isUpdating ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            opacity: isUpdating ? 0.6 : 1,
        };
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
                <Text style={{
                    ...Typography.default("semiBold"),
                    fontSize: 16,
                    color: state === "error" ? (theme.colors.textDestructive ?? "#ff3b30") : theme.colors.textSecondary,
                    textAlign: "center",
                    marginBottom: 8,
                }}>
                    {state === "error" ? t("webTerminal.connectionFailed") : t("webTerminal.disconnected")}
                </Text>
                {(errorMsg || updateMsg) && (
                    <Text style={{
                        ...Typography.default(),
                        fontSize: 13,
                        color: theme.colors.textSecondary,
                        textAlign: "center",
                        marginBottom: 20,
                    }}>
                        {updateMsg ?? errorMsg}
                    </Text>
                )}
                {!isUpdating && (
                    <button
                        onClick={handleRetry}
                        style={{ ...btnBase, background: theme.colors.accentBlue ?? "#007aff", color: "#fff" }}
                    >
                        {t("webTerminal.retry")}
                    </button>
                )}
                {hasUpdate && latestVersion && !isUpdating && (
                    <button
                        onClick={handleUpdateCli}
                        style={{ ...btnBase, background: "transparent", color: theme.colors.textSecondary, border: `1px solid ${theme.colors.divider}` }}
                    >
                        {t("webTerminal.updateCli", { version: latestVersion })}
                    </button>
                )}
                {isUpdating && (
                    <Text style={{ ...Typography.default(), fontSize: 13, color: theme.colors.textSecondary, marginTop: 8 }}>
                        {updateMsg}
                    </Text>
                )}
            </View>
        );
    }

    return (
        <View style={{ flex: 1, position: "relative" }}>
            {state === "connecting" && (
                <View style={{
                    position: "absolute",
                    top: 0, left: 0, right: 0, bottom: 0,
                    justifyContent: "center",
                    alignItems: "center",
                    zIndex: 10,
                    backgroundColor: theme.colors.groupped?.background,
                }}>
                    <Text style={{
                        ...Typography.default(),
                        color: theme.colors.textSecondary,
                    }}>
                        {t("webTerminal.connecting")}
                    </Text>
                </View>
            )}
            <div
                ref={containerRef}
                style={{
                    width: "100%",
                    height: "100%",
                    overflow: "hidden",
                }}
            />
        </View>
    );
}

export const WebTerminal = React.memo(WebTerminalComponent);
