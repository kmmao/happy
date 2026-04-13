import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { t } from "@/text";
import type { Session } from "@/sync/storageTypes";
import {
    formatCodexReasoningEffortMetadata,
    formatCodexReasoningSummaryMetadata,
    hasCodexMetadataSection,
} from "./codexMetadata";

function formatCodexBackendMetadata(
    codex:
        | {
              resolvedBackend?: "codex-app-server" | "codex-mcp-legacy";
          }
        | undefined,
): string | null {
    const resolvedBackend = codex?.resolvedBackend;
    if (resolvedBackend === "codex-app-server") {
        return t("sessionInfo.codexBackendAppServer");
    }
    if (resolvedBackend === "codex-mcp-legacy") {
        return t("sessionInfo.codexBackendLegacyMcp");
    }
    return null;
}

function formatCodexRequestedBackendMetadata(
    codex:
        | {
              requestedBackend?: "auto" | "codex-app-server" | "codex-mcp-legacy";
          }
        | undefined,
): string | null {
    const requestedBackend = codex?.requestedBackend;
    if (requestedBackend === "auto") {
        return t("sessionInfo.codexBackendAuto");
    }
    if (requestedBackend === "codex-app-server") {
        return t("sessionInfo.codexBackendAppServer");
    }
    if (requestedBackend === "codex-mcp-legacy") {
        return t("sessionInfo.codexBackendLegacyMcp");
    }
    return null;
}

function formatCodexConfigModeMetadata(
    codex:
        | {
              configMode?: "inherit" | "managed-profile" | "managed-overrides";
          }
        | undefined,
): string | null {
    const configMode = codex?.configMode;
    if (configMode === "inherit") {
        return t("sessionInfo.codexConfigModeInherit");
    }
    if (configMode === "managed-profile") {
        return t("sessionInfo.codexConfigModeManagedProfile");
    }
    if (configMode === "managed-overrides") {
        return t("sessionInfo.codexConfigModeManagedOverrides");
    }
    return null;
}

function formatCodexAccountMetadata(
    codex:
        | {
              account?: {
                  type?: "apiKey" | "chatgpt" | null;
                  email?: string | null;
              };
          }
        | undefined,
): string | null {
    const account = codex?.account;
    if (!account?.type) {
        return null;
    }
    if (account.type === "apiKey") {
        return t("sessionInfo.codexAccountApiKey");
    }
    if (account.type === "chatgpt") {
        return account.email
            ? `${t("sessionInfo.codexAccountChatgpt")} (${account.email})`
            : t("sessionInfo.codexAccountChatgpt");
    }
    return null;
}

function formatNamePreview(names: readonly string[], limit = 4): string {
    if (names.length <= limit) {
        return names.join(", ");
    }

    const visible = names.slice(0, limit).join(", ");
    return `${visible}, +${names.length - limit}`;
}

export function CodexInfoSection({ session }: { session: Session }) {
    if (!hasCodexMetadataSection(session) || session.metadata?.flavor !== "codex") {
        return null;
    }

    const codexReasoningEffort = formatCodexReasoningEffortMetadata(session, t);
    const codexReasoningSummary = formatCodexReasoningSummaryMetadata(session);

    return (
        <ItemGroup title={t("sessionInfo.codex")}>
            {formatCodexRequestedBackendMetadata(session.metadata.codex) && (
                <Item
                    title={t("sessionInfo.codexRequestedBackend")}
                    subtitle={
                        formatCodexRequestedBackendMetadata(session.metadata.codex)!
                    }
                    icon={
                        <Ionicons
                            name="options-outline"
                            size={29}
                            color="#5856D6"
                        />
                    }
                    showChevron={false}
                />
            )}
            {formatCodexBackendMetadata(session.metadata.codex) && (
                <Item
                    title={t("sessionInfo.codexResolvedBackend")}
                    subtitle={formatCodexBackendMetadata(session.metadata.codex)!}
                    icon={
                        <Ionicons
                            name="git-network-outline"
                            size={29}
                            color="#5856D6"
                        />
                    }
                    showChevron={false}
                />
            )}
            {session.metadata.codex?.backendVersion && (
                <Item
                    title={t("sessionInfo.codexBackendVersion")}
                    subtitle={session.metadata.codex.backendVersion}
                    icon={
                        <Ionicons
                            name="layers-outline"
                            size={29}
                            color="#5856D6"
                        />
                    }
                    showChevron={false}
                />
            )}
            {session.metadata.codex?.config?.profile && (
                <Item
                    title={t("sessionInfo.codexProfile")}
                    subtitle={session.metadata.codex.config.profile}
                    icon={
                        <Ionicons
                            name="layers-outline"
                            size={29}
                            color="#5856D6"
                        />
                    }
                    showChevron={false}
                />
            )}
            {codexReasoningEffort && (
                <Item
                    title={t("sessionInfo.codexReasoningEffort")}
                    subtitle={codexReasoningEffort}
                    icon={
                        <Ionicons
                            name="flash-outline"
                            size={29}
                            color="#5856D6"
                        />
                    }
                    showChevron={false}
                />
            )}
            {codexReasoningSummary && (
                <Item
                    title={t("sessionInfo.codexReasoningSummary")}
                    subtitle={codexReasoningSummary}
                    icon={
                        <Ionicons
                            name="document-text-outline"
                            size={29}
                            color="#5856D6"
                        />
                    }
                    showChevron={false}
                />
            )}
            {formatCodexAccountMetadata(session.metadata.codex) && (
                <Item
                    title={t("sessionInfo.codexAccount")}
                    subtitle={formatCodexAccountMetadata(session.metadata.codex)!}
                    icon={
                        <Ionicons
                            name="person-outline"
                            size={29}
                            color="#5856D6"
                        />
                    }
                    showChevron={false}
                />
            )}
            {session.metadata.codex?.account?.planType && (
                <Item
                    title={t("sessionInfo.codexPlan")}
                    subtitle={session.metadata.codex.account.planType}
                    icon={
                        <Ionicons
                            name="card-outline"
                            size={29}
                            color="#5856D6"
                        />
                    }
                    showChevron={false}
                />
            )}
            {formatCodexConfigModeMetadata(session.metadata.codex) && (
                <Item
                    title={t("sessionInfo.codexConfigMode")}
                    subtitle={formatCodexConfigModeMetadata(session.metadata.codex)!}
                    icon={
                        <Ionicons
                            name="settings-outline"
                            size={29}
                            color="#5856D6"
                        />
                    }
                    showChevron={false}
                />
            )}
            {session.metadata.codex?.fallbackReason && (
                <Item
                    title={t("sessionInfo.codexFallbackReason")}
                    subtitle={session.metadata.codex.fallbackReason}
                    icon={
                        <Ionicons
                            name="warning-outline"
                            size={29}
                            color="#FF9500"
                        />
                    }
                    showChevron={false}
                />
            )}
            {session.metadata.slashCommands &&
                session.metadata.slashCommands.length > 0 && (
                    <Item
                        title={t("settingsPlugins.commands", {
                            count: session.metadata.slashCommands.length,
                        })}
                        subtitle={formatNamePreview(session.metadata.slashCommands)}
                        icon={
                            <Ionicons
                                name="terminal-outline"
                                size={29}
                                color="#5856D6"
                            />
                        }
                        showChevron={false}
                    />
                )}
            {session.metadata.codex?.skills &&
                session.metadata.codex.skills.length > 0 && (
                    <Item
                        title={t("settingsPlugins.skills", {
                            count: session.metadata.codex.skills.length,
                        })}
                        subtitle={formatNamePreview(
                            session.metadata.codex.skills.map((skill) => skill.name),
                        )}
                        icon={
                            <Ionicons
                                name="school-outline"
                                size={29}
                                color="#5856D6"
                            />
                        }
                        showChevron={false}
                    />
                )}
            {session.metadata.codex?.agents &&
                session.metadata.codex.agents.length > 0 && (
                    <Item
                        title={t("settingsPlugins.agents", {
                            count: session.metadata.codex.agents.length,
                        })}
                        subtitle={formatNamePreview(
                            session.metadata.codex.agents.map((agent) => agent.name),
                        )}
                        icon={
                            <Ionicons
                                name="people-outline"
                                size={29}
                                color="#5856D6"
                            />
                        }
                        showChevron={false}
                    />
                )}
            {session.metadata.codex?.mcpServers &&
                session.metadata.codex.mcpServers.length > 0 && (
                    <Item
                        title={t("settingsMcp.title")}
                        subtitle={formatNamePreview(
                            session.metadata.codex.mcpServers.map((server) => server.name),
                        )}
                        icon={
                            <Ionicons
                                name="git-network-outline"
                                size={29}
                                color="#5856D6"
                            />
                        }
                        showChevron={false}
                    />
                )}
        </ItemGroup>
    );
}
