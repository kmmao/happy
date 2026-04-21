import React from "react";
import { Ionicons } from "@expo/vector-icons";
import type {
    CodexConfigMode,
    CodexMetadata,
    CodexRequestedBackend,
    CodexResolvedBackend,
} from "@kmmao/happy-wire";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { t } from "@/text";
import type { Session } from "@/sync/storageTypes";
import {
    formatCodexThreadIdPreview,
    formatCodexReasoningEffortMetadata,
    formatCodexReasoningSummaryMetadata,
    hasCodexMetadataSection,
} from "./codexMetadata";
import {
    resolveCodexSurfaceSections,
    type CodexSurfaceSection,
} from "@/sync/codexSurface";
import {
    resolveCodexBackendModeLabel,
    resolveCodexConfigModeLabel,
} from "@/sync/codexConfigPresentation";

function formatCodexBackendMetadata(
    codex: Pick<CodexMetadata, "resolvedBackend"> | undefined,
): string | null {
    const resolvedBackend: CodexResolvedBackend | undefined = codex?.resolvedBackend;
    if (resolvedBackend === "codex-app-server") {
        return resolveCodexBackendModeLabel(
            "codex-app-server",
            t,
            "session",
        );
    }
    if (resolvedBackend === "codex-mcp-legacy") {
        return resolveCodexBackendModeLabel(
            "codex-mcp-legacy",
            t,
            "session",
        );
    }
    return null;
}

function formatCodexRequestedBackendMetadata(
    codex: Pick<CodexMetadata, "requestedBackend"> | undefined,
): string | null {
    const requestedBackend: CodexRequestedBackend | undefined =
        codex?.requestedBackend;
    if (requestedBackend === "auto") {
        return resolveCodexBackendModeLabel("auto", t, "session");
    }
    if (requestedBackend === "codex-app-server") {
        return resolveCodexBackendModeLabel(
            "codex-app-server",
            t,
            "session",
        );
    }
    if (requestedBackend === "codex-mcp-legacy") {
        return resolveCodexBackendModeLabel(
            "codex-mcp-legacy",
            t,
            "session",
        );
    }
    return null;
}

function formatCodexConfigModeMetadata(
    codex: Pick<CodexMetadata, "configMode"> | undefined,
): string | null {
    const configMode: CodexConfigMode | undefined = codex?.configMode;
    if (configMode === "inherit") {
        return resolveCodexConfigModeLabel("inherit", t, "session");
    }
    if (configMode === "managed-profile") {
        return resolveCodexConfigModeLabel(
            "managed-profile",
            t,
            "session",
        );
    }
    if (configMode === "managed-overrides") {
        return resolveCodexConfigModeLabel(
            "managed-overrides",
            t,
            "session",
        );
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

function getCodexSurfaceSectionTitle(
    section: CodexSurfaceSection,
): string | null {
    if (section.kind === "commands") {
        return t("settingsPlugins.commands", {
            count: section.count,
        });
    }
    if (section.kind === "prompts") {
        return `${t("kanban.templates.title")} (${section.count})`;
    }
    if (section.kind === "skills") {
        return t("settingsPlugins.skills", {
            count: section.count,
        });
    }
    if (section.kind === "agents") {
        return t("settingsPlugins.agents", {
            count: section.count,
        });
    }
    if (section.kind === "mcpServers") {
        return t("settingsMcp.title");
    }
    return null;
}

function getCodexSurfaceSectionIcon(
    section: CodexSurfaceSection,
): keyof typeof Ionicons.glyphMap {
    if (section.kind === "commands") {
        return "terminal-outline";
    }
    if (section.kind === "prompts") {
        return "document-text-outline";
    }
    if (section.kind === "skills") {
        return "school-outline";
    }
    if (section.kind === "agents") {
        return "people-outline";
    }
    return "git-network-outline";
}

export function CodexInfoSection({ session }: { session: Session }) {
    if (!hasCodexMetadataSection(session) || session.metadata?.flavor !== "codex") {
        return null;
    }

    const codexReasoningEffort = formatCodexReasoningEffortMetadata(session, t);
    const codexReasoningSummary = formatCodexReasoningSummaryMetadata(session);
    const codexSurfaceSections = resolveCodexSurfaceSections(session.metadata);

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
            {session.metadata.codex?.threadId && (
                <Item
                    title={t("sessionInfo.codexThreadId")}
                    subtitle={formatCodexThreadIdPreview(
                        session.metadata.codex.threadId,
                    )}
                    icon={
                        <Ionicons
                            name="git-branch-outline"
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
            {codexSurfaceSections.map((section) => (
                <Item
                    key={section.kind}
                    title={getCodexSurfaceSectionTitle(section) ?? section.kind}
                    subtitle={formatNamePreview(section.names)}
                    icon={
                        <Ionicons
                            name={getCodexSurfaceSectionIcon(section)}
                            size={29}
                            color="#5856D6"
                        />
                    }
                    showChevron={false}
                />
            ))}
        </ItemGroup>
    );
}
