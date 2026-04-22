import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import {
    buildSessionSummaryRefreshDebugText,
    resolveSessionSummaryRefreshDebugState,
} from "@/components/session/sessionSummaryRefreshPresentation";
import { t } from "@/text";
import type { Session } from "@/sync/storageTypes";
import {
    formatOSPlatform,
    formatPathRelativeToHome,
    getSessionProviderLabel,
} from "@/utils/sessionUtils";

function formatSandboxMetadata(sandbox: unknown, homeDir?: string): string {
    if (sandbox === null || sandbox === undefined) {
        return "Disabled";
    }

    if (typeof sandbox === "string") {
        return sandbox;
    }

    if (typeof sandbox !== "object") {
        return String(sandbox);
    }

    const value = sandbox as Record<string, unknown>;
    if (value.enabled === false) {
        return "Disabled";
    }

    const parts: string[] = ["Enabled"];
    const isolation =
        typeof value.sessionIsolation === "string"
            ? value.sessionIsolation
            : undefined;
    const networkMode =
        typeof value.networkMode === "string" ? value.networkMode : undefined;
    const workspaceRoot =
        typeof value.workspaceRoot === "string" ? value.workspaceRoot : undefined;

    if (isolation) {
        parts.push(`isolation=${isolation}`);
    }
    if (networkMode) {
        parts.push(`network=${networkMode}`);
    }
    if (workspaceRoot) {
        parts.push(`workspace=${formatPathRelativeToHome(workspaceRoot, homeDir)}`);
    }

    return parts.join(" | ");
}

function formatDangerouslySkipPermissionsMetadata(
    value: unknown,
    flavor: string | null | undefined,
    permissionMode: Session["permissionMode"],
    sandbox: unknown,
): string {
    if (typeof value === "boolean") {
        return value ? "Enabled" : "Disabled";
    }

    if (permissionMode === "bypassPermissions" || permissionMode === "yolo") {
        return "Enabled";
    }

    if (flavor === "claude" && sandbox && typeof sandbox === "object") {
        const sandboxValue = sandbox as Record<string, unknown>;
        if (sandboxValue.enabled === true) {
            return "Enabled";
        }
    }

    return "Unknown";
}

export function SessionMetadataSection({
    session,
    isCliOutdated,
}: {
    session: Session;
    isCliOutdated: boolean;
}) {
    if (!session.metadata) {
        return null;
    }

    const summaryRefreshDebug = resolveSessionSummaryRefreshDebugState(
        session.metadata.sessionSummaryRefresh,
    );
    const summaryRefreshSubtitle = summaryRefreshDebug
        ? buildSessionSummaryRefreshDebugText(summaryRefreshDebug, {
            relativeTimeLabel: new Date(
                summaryRefreshDebug.timestamp,
            ).toLocaleString(),
            pending: (params) =>
                t("session.progressSummaryRefreshPendingDebug", params),
            applied: (params) =>
                t("session.progressSummaryRefreshAppliedDebug", params),
            superseded: (params) =>
                t("session.progressSummaryRefreshSupersededDebug", params),
        })
        : null;

    return (
        <ItemGroup title={t("sessionInfo.metadata")}>
            <Item
                title={t("sessionInfo.host")}
                subtitle={session.metadata.host}
                icon={<Ionicons name="desktop-outline" size={29} color="#5856D6" />}
                showChevron={false}
            />
            <Item
                title={t("sessionInfo.path")}
                subtitle={formatPathRelativeToHome(
                    session.metadata.path,
                    session.metadata.homeDir,
                )}
                icon={<Ionicons name="folder-outline" size={29} color="#5856D6" />}
                showChevron={false}
            />
            {session.metadata.version && (
                <Item
                    title={t("sessionInfo.cliVersion")}
                    subtitle={session.metadata.version}
                    detail={isCliOutdated ? "⚠️" : undefined}
                    icon={
                        <Ionicons
                            name="git-branch-outline"
                            size={29}
                            color={isCliOutdated ? "#FF9500" : "#5856D6"}
                        />
                    }
                    showChevron={false}
                />
            )}
            {session.metadata.os && (
                <Item
                    title={t("sessionInfo.operatingSystem")}
                    subtitle={formatOSPlatform(session.metadata.os)}
                    icon={
                        <Ionicons
                            name="hardware-chip-outline"
                            size={29}
                            color="#5856D6"
                        />
                    }
                    showChevron={false}
                />
            )}
            {session.profileName && (
                <Item
                    title={t("sessionInfo.profile")}
                    subtitle={session.profileName}
                    icon={<Ionicons name="layers-outline" size={29} color="#5856D6" />}
                    showChevron={false}
                />
            )}
            <Item
                title={t("sessionInfo.aiProvider")}
                subtitle={getSessionProviderLabel(session)}
                icon={<Ionicons name="sparkles-outline" size={29} color="#5856D6" />}
                showChevron={false}
            />
            <Item
                title="Sandbox"
                subtitle={formatSandboxMetadata(
                    session.metadata.sandbox,
                    session.metadata.homeDir,
                )}
                icon={<Ionicons name="shield-outline" size={29} color="#5856D6" />}
                showChevron={false}
            />
            <Item
                title="Dangerously Skip Permissions"
                subtitle={formatDangerouslySkipPermissionsMetadata(
                    session.metadata.dangerouslySkipPermissions,
                    session.metadata.flavor,
                    session.permissionMode,
                    session.metadata.sandbox,
                )}
                icon={<Ionicons name="warning-outline" size={29} color="#5856D6" />}
                showChevron={false}
            />
            {session.metadata.hostPid && (
                <Item
                    title={t("sessionInfo.processId")}
                    subtitle={session.metadata.hostPid.toString()}
                    icon={<Ionicons name="terminal-outline" size={29} color="#5856D6" />}
                    showChevron={false}
                />
            )}
            {session.metadata.startedBy && (
                <Item
                    title={t("sessionInfo.startedBy")}
                    detail={
                        session.metadata.startedBy === "daemon"
                            ? t("sessionInfo.startedByDaemon")
                            : t("sessionInfo.startedByTerminal")
                    }
                    icon={
                        <Ionicons
                            name={
                                session.metadata.startedBy === "daemon"
                                    ? "cloud-outline"
                                    : "terminal-outline"
                            }
                            size={29}
                            color="#5856D6"
                        />
                    }
                    showChevron={false}
                />
            )}
            {summaryRefreshSubtitle && (
                <Item
                    title={t("sessionInfo.summaryRefresh")}
                    subtitle={summaryRefreshSubtitle}
                    detail={`v${session.metadata.sessionSummaryRefresh?.protocolVersion ?? 1}`}
                    icon={<Ionicons name="refresh-outline" size={29} color="#5856D6" />}
                    showChevron={false}
                />
            )}
            {session.metadata.happyHomeDir && (
                <Item
                    title={t("sessionInfo.happyHome")}
                    subtitle={formatPathRelativeToHome(
                        session.metadata.happyHomeDir,
                        session.metadata.homeDir,
                    )}
                    icon={<Ionicons name="home-outline" size={29} color="#5856D6" />}
                    showChevron={false}
                />
            )}
        </ItemGroup>
    );
}
