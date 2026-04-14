/**
 * WebTerminal — xterm.js-based web terminal emulator.
 * Connects to a CLI daemon's PTY via Socket.IO relay.
 *
 * Each Claude session owns one persistent PTY (keyed by sessionId).
 * Switching tabs detaches the listener but keeps the process alive.
 * Re-opening replays buffered output and resumes the session.
 *
 * Web-only component (uses DOM APIs).
 */
import React, { useRef, useEffect, useCallback, useState } from "react";
import { View, Pressable } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
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
    sessionId?: string;   // Claude session ID — used to persist PTY across tab switches
    terminalId?: string;  // specific PTY ID to reattach (set by multi-terminal parent)
    isActive?: boolean;   // triggers fitAddon.fit() when tab becomes visible
    showInternalCloseButton?: boolean; // default true; set false when parent manages close button
    onClose?: () => void;
}

type TerminalState = "connecting" | "connected" | "disconnected" | "error";

function WebTerminalComponent({ machineId, cwd, sessionId, terminalId: terminalIdProp, isActive, showInternalCloseButton = true, onClose }: WebTerminalProps) {
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

    // Stable ref for onClose — avoids including onClose in effect dep arrays,
    // which would cause the terminal to re-initialize every time the parent re-renders.
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    const machine = useMachine(machineId);
    const currentCliVersion = machine?.daemonState?.startedWithCliVersion;
    const { latestVersion, hasUpdate } = useCliVersionCheck(currentCliVersion);

    // Explicitly close the PTY — called only by user action or shell exit, not on unmount
    const closeTerminal = useCallback(() => {
        if (terminalIdRef.current) {
            machineTerminalClose(machineId, terminalIdRef.current);
            terminalIdRef.current = null;
        }
        if (terminalRef.current) {
            terminalRef.current.dispose();
            terminalRef.current = null;
        }
        setState("disconnected");
        onCloseRef.current?.();
    }, [machineId]);

    useEffect(() => {
        let mounted = true;
        let outputCleanup: (() => void) | null = null;
        let exitCleanup: (() => void) | null = null;

        async function init() {
            const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
                import("@xterm/xterm"),
                import("@xterm/addon-fit"),
                import("@xterm/addon-web-links"),
            ]);

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
            const webLinksAddon = new WebLinksAddon();
            terminal.loadAddon(fitAddon);
            terminal.loadAddon(webLinksAddon);
            terminalRef.current = terminal;
            fitAddonRef.current = fitAddon;

            terminal.open(containerRef.current);

            // Fit synchronously so cols/rows reflect actual container size before spawn
            try { fitAddon.fit(); } catch { /* ignore */ }

            const cols = terminal.cols;
            const rows = terminal.rows;

            // Register listener BEFORE spawn to buffer events arriving during RPC round-trip
            const pendingEvents: any[] = [];
            outputCleanup = apiSocket.addEphemeralListener((data: any) => {
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
                    onCloseRef.current?.();
                }
            });

            // Spawn or reattach. Pass terminalId for precise reattach; otherwise sessionId for session-scoped creation.
            const result = await machineTerminalSpawn(machineId, { cwd, cols, rows, sessionId, terminalId: terminalIdProp });
            if (!mounted) return;

            if (!result.success || !result.terminalId) {
                setState("error");
                setErrorMsg(result.error || t("webTerminal.spawnFailed"));
                return;
            }

            terminalIdRef.current = result.terminalId;

            // Reattach: replay buffered output from CLI so the screen is up to date
            if (result.isExisting && result.recentOutput) {
                terminal.write(result.recentOutput);
            }

            setState("connected");

            // Replay any socket events that arrived during the spawn RPC
            for (const data of pendingEvents) {
                if (data.terminalId !== terminalIdRef.current) continue;
                if (data.type === "terminal-output") {
                    terminal.write(data.data);
                }
                if (data.type === "terminal-exit") {
                    terminal.write(`\r\n\x1b[90m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`);
                    setState("disconnected");
                    terminalIdRef.current = null;
                    onCloseRef.current?.();
                    break;
                }
            }

            terminal.onData((data: string) => {
                if (terminalIdRef.current) {
                    machineTerminalInput(machineId, terminalIdRef.current, data);
                }
            });

            terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
                if (terminalIdRef.current) {
                    machineTerminalResize(machineId, terminalIdRef.current, cols, rows);
                }
            });

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
            // Detach only: don't close the PTY — it stays alive for reattach
            if (terminalRef.current) {
                terminalRef.current.dispose();
                terminalRef.current = null;
            }
            terminalIdRef.current = null;
        };
    }, [machineId, cwd, sessionId, terminalIdProp, theme.colors.groupped?.background, retryKey]);

    // When this terminal's tab becomes active after being HIDDEN, re-fit so dimensions are correct.
    // Skip the initial mount — the terminal is already sized correctly by the init effect's synchronous fit().
    const isActivePrevRef = useRef<boolean | undefined>(undefined);
    useEffect(() => {
        const prev = isActivePrevRef.current;
        isActivePrevRef.current = isActive;
        // Only fit when transitioning false → true (not on initial mount)
        if (isActive && prev === false && fitAddonRef.current) {
            requestAnimationFrame(() => {
                try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
            });
        }
    }, [isActive]);

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
            {/* Close button — top-right corner, only when connected and not managed by parent */}
            {state === "connected" && showInternalCloseButton && (
                <Pressable
                    onPress={closeTerminal}
                    style={{
                        position: "absolute",
                        top: 6,
                        right: 8,
                        zIndex: 20,
                        padding: 4,
                        borderRadius: 4,
                        backgroundColor: "rgba(0,0,0,0.3)",
                    }}
                    hitSlop={8}
                >
                    <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
            )}
            {state === "connecting" && (
                <View style={{
                    position: "absolute",
                    top: 0, left: 0, right: 0, bottom: 0,
                    justifyContent: "center",
                    alignItems: "center",
                    zIndex: 10,
                    backgroundColor: theme.colors.groupped?.background,
                }}>
                    <Text style={{ ...Typography.default(), color: theme.colors.textSecondary }}>
                        {t("webTerminal.connecting")}
                    </Text>
                </View>
            )}
            <div
                ref={containerRef}
                style={{ width: "100%", height: "100%", overflow: "hidden", cursor: "text" }}
            />
        </View>
    );
}

export const WebTerminal = React.memo(WebTerminalComponent);
