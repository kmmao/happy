/**
 * Tailscale Serve / Funnel management section for the machine detail page.
 * Shows active serves and allows add/remove/toggle funnel.
 */

import React, { useState, useCallback, useMemo } from "react";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { Modal } from "@/modal";
import { t } from "@/text";
import { isMachineOnline } from "@/utils/machineUtils";
import {
    machineTailscaleServeAdd,
    machineTailscaleServeRemove,
    machineTailscaleFunnelToggle,
    machineTailscaleServeStatus,
} from "@/sync/ops";
import type { Machine } from "@/sync/storageTypes";

type ServeEntry = {
    port: number;
    protocol: string;
    target: string;
    funnel: boolean;
    hostname: string;
};

type Props = {
    machineId: string;
    machine: Machine;
};

const EMPTY_SERVES: ServeEntry[] = [];

function parseServeStatusJson(raw: string): ServeEntry[] {
    try {
        const json = JSON.parse(raw);
        const web: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> =
            json.Web ?? {};
        const allowFunnel: Record<string, boolean> = json.AllowFunnel ?? {};
        const entries: ServeEntry[] = [];
        for (const [hostPort, config] of Object.entries(web)) {
            const colonIdx = hostPort.lastIndexOf(":");
            if (colonIdx === -1) continue;
            const hostname = hostPort.slice(0, colonIdx);
            const port = parseInt(hostPort.slice(colonIdx + 1), 10);
            if (!Number.isFinite(port)) continue;
            const handlers = config.Handlers ?? {};
            const rootHandler = handlers["/"];
            const target = rootHandler?.Proxy ?? "unknown";
            const funnel = allowFunnel[hostPort] === true;
            entries.push({ port, protocol: "HTTPS", target, funnel, hostname });
        }
        return entries;
    } catch {
        return [];
    }
}

export const TailscaleServeSection = React.memo(function TailscaleServeSection({
    machineId,
    machine,
}: Props) {
    const { theme } = useUnistyles();
    const online = isMachineOnline(machine);
    const serves: ServeEntry[] = machine.daemonState?.tailscale?.serves ?? EMPTY_SERVES;

    // Local overrides after mutations (until next daemon refresh)
    const [localServes, setLocalServes] = useState<ServeEntry[] | null>(null);
    const displayServes = localServes ?? serves;

    // Stable key for daemon state version — reset local overrides when server pushes new data
    const daemonVersion = machine.daemonStateVersion;
    React.useEffect(() => {
        setLocalServes(null);
    }, [daemonVersion]);

    const refreshServes = useCallback(async () => {
        try {
            const result = await machineTailscaleServeStatus(machineId);
            if (result.success && result.stdout) {
                setLocalServes(parseServeStatusJson(result.stdout));
            }
        } catch {
            // ignore — next daemon refresh will update
        }
    }, [machineId]);

    const handleFunnelToggle = useCallback(async (serve: ServeEntry) => {
        if (!online) return;
        const msg = serve.funnel
            ? t("machine.tailscaleServeFunnelToggleOff")
            : t("machine.tailscaleServeFunnelToggleOn");
        const confirmed = await Modal.confirm(`:${serve.port}`, msg);
        if (!confirmed) return;

        const result = await machineTailscaleFunnelToggle(machineId, serve.port, !serve.funnel);
        if (!result.success && result.stderr) {
            Modal.alert(t("machine.tailscaleServeError"), result.stderr);
        } else {
            await refreshServes();
        }
    }, [machineId, online, refreshServes]);

    const handleServeRemove = useCallback(async (serve: ServeEntry) => {
        if (!online) return;
        const confirmed = await Modal.confirm(
            t("machine.tailscaleServeRemove"),
            t("machine.tailscaleServeRemoveConfirm"),
        );
        if (!confirmed) return;

        const result = await machineTailscaleServeRemove(machineId, serve.port);
        if (!result.success && result.stderr) {
            Modal.alert(t("machine.tailscaleServeError"), result.stderr);
        } else {
            await refreshServes();
        }
    }, [machineId, online, refreshServes]);

    const handleAddServe = useCallback(async () => {
        if (!online) return;

        const portStr = await Modal.prompt(
            t("machine.tailscaleServeAddTitle"),
            "",
            { placeholder: t("machine.tailscaleServeAddPortPlaceholder") },
        );

        if (!portStr) return;

        const port = parseInt(portStr, 10);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            Modal.alert(t("machine.tailscaleServeError"), t("machine.tailscaleServeInvalidPort"));
            return;
        }

        // Ask about funnel
        const funnel = await Modal.confirm(
            t("machine.tailscaleServeAddFunnelLabel"),
            `:${port}`,
        );

        const addResult = await machineTailscaleServeAdd(machineId, port, funnel);
        if (!addResult.success && addResult.stderr) {
            Modal.alert(t("machine.tailscaleServeError"), addResult.stderr);
        } else {
            await refreshServes();
        }
    }, [machineId, online, refreshServes]);

    return (
        <ItemGroup title={t("machine.tailscaleServes")}>
            {displayServes.length === 0 && (
                <Item
                    title={t("machine.tailscaleServesEmpty")}
                    showChevron={false}
                />
            )}
            {displayServes.map((serve) => (
                <Item
                    key={serve.port}
                    title={`:${serve.port}`}
                    subtitle={serve.target}
                    subtitleStyle={{ fontFamily: "Menlo", fontSize: 13 }}
                    detail={
                        serve.funnel
                            ? t("machine.tailscaleServeFunnelOn")
                            : t("machine.tailscaleServeFunnelOff")
                    }
                    detailStyle={{
                        color: serve.funnel ? theme.colors.success : theme.colors.textSecondary,
                    }}
                    onPress={online ? () => handleFunnelToggle(serve) : undefined}
                    onLongPress={online ? () => handleServeRemove(serve) : undefined}
                    showChevron={online}
                />
            ))}
            {online && (
                <Item
                    title={t("machine.tailscaleServeAdd")}
                    titleStyle={{ color: theme.colors.textLink }}
                    icon={
                        <Ionicons
                            name="add-circle-outline"
                            size={20}
                            color={theme.colors.textLink}
                        />
                    }
                    onPress={handleAddServe}
                    showChevron={false}
                />
            )}
        </ItemGroup>
    );
});
