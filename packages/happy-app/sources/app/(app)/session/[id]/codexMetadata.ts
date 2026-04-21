import type { Session } from "@/sync/storageTypes";

const KNOWN_REASONING_EFFORTS = new Set([
    "low",
    "medium",
    "high",
    "max",
    "xhigh",
]);

export type CodexSurfaceSectionKind =
    | "prompts"
    | "commands"
    | "skills"
    | "agents"
    | "mcpServers";

export interface CodexSurfaceSection {
    kind: CodexSurfaceSectionKind;
    names: string[];
    count: number;
}

function dedupeNames(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];

    for (const value of values) {
        if (seen.has(value)) {
            continue;
        }
        seen.add(value);
        deduped.push(value);
    }

    return deduped;
}

export function resolveCodexSurfaceSections(
    session: Pick<Session, "metadata">,
): CodexSurfaceSection[] {
    if (session.metadata?.flavor !== "codex") {
        return [];
    }

    const codex = session.metadata.codex;
    if (!codex) {
        return [];
    }

    const promptNames = dedupeNames(
        (codex.prompts ?? []).map((prompt) => prompt.name),
    );
    const promptNameSet = new Set(promptNames);
    const compatibilityCommandNames = dedupeNames(
        (session.metadata.slashCommands ?? []).filter(
            (command) => !promptNameSet.has(command),
        ),
    );
    const skillNames = dedupeNames(
        (codex.skills ?? []).map((skill) => skill.name),
    );
    const agentNames = dedupeNames(
        (codex.agents ?? []).map((agent) => agent.name),
    );
    const mcpServerNames = dedupeNames(
        (codex.mcpServers ?? []).map((server) => server.name),
    );

    const sections: CodexSurfaceSection[] = [];

    if (promptNames.length > 0) {
        sections.push({
            kind: "prompts",
            names: promptNames,
            count: promptNames.length,
        });
    }

    if (skillNames.length > 0) {
        sections.push({
            kind: "skills",
            names: skillNames,
            count: skillNames.length,
        });
    }

    if (agentNames.length > 0) {
        sections.push({
            kind: "agents",
            names: agentNames,
            count: agentNames.length,
        });
    }

    if (mcpServerNames.length > 0) {
        sections.push({
            kind: "mcpServers",
            names: mcpServerNames,
            count: mcpServerNames.length,
        });
    }

    if (compatibilityCommandNames.length > 0) {
        sections.push({
            kind: "commands",
            names: compatibilityCommandNames,
            count: compatibilityCommandNames.length,
        });
    }

    return sections;
}

export function resolveCodexEffectiveReasoningEffort(
    session: Pick<Session, "effortLevel" | "metadata">,
): string | null {
    if (session.effortLevel && session.effortLevel.length > 0) {
        return session.effortLevel;
    }

    const configEffort = session.metadata?.codex?.config?.reasoningEffort;
    if (typeof configEffort === "string" && configEffort.length > 0) {
        return configEffort;
    }

    return null;
}

export function formatCodexReasoningEffortMetadata(
    session: Pick<Session, "effortLevel" | "metadata">,
    translate: (key: any) => string,
): string | null {
    const reasoningEffort = resolveCodexEffectiveReasoningEffort(session);
    if (!reasoningEffort) {
        return null;
    }

    if (KNOWN_REASONING_EFFORTS.has(reasoningEffort)) {
        return translate(`agentInput.effort.${reasoningEffort}`);
    }

    return reasoningEffort;
}

export function resolveCodexEffectiveReasoningSummary(
    session: Pick<Session, "metadata">,
): string | null {
    const configSummary = session.metadata?.codex?.config?.reasoningSummary;
    if (typeof configSummary === "string" && configSummary.length > 0) {
        return configSummary;
    }

    return null;
}

export function formatCodexReasoningSummaryMetadata(
    session: Pick<Session, "metadata">,
): string | null {
    return resolveCodexEffectiveReasoningSummary(session);
}

export function formatCodexThreadIdPreview(threadId: string): string {
    if (threadId.length <= 20) {
        return threadId;
    }

    return `${threadId.substring(0, 8)}...${threadId.substring(threadId.length - 8)}`;
}

export function hasCodexMetadataSection(
    session: Pick<Session, "effortLevel" | "metadata">,
): boolean {
    if (session.metadata?.flavor !== "codex") {
        return false;
    }

    const codex = session.metadata.codex;
    if (!codex) {
        return false;
    }

    return Boolean(
        codex.requestedBackend ||
            codex.resolvedBackend ||
            codex.backendVersion ||
            codex.configMode ||
            codex.fallbackReason ||
            codex.config?.profile ||
            codex.threadId ||
            codex.account?.type ||
            codex.account?.planType ||
            resolveCodexEffectiveReasoningEffort(session) ||
            resolveCodexEffectiveReasoningSummary(session) ||
            resolveCodexSurfaceSections(session).length > 0,
    );
}
