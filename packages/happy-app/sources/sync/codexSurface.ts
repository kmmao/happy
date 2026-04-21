import type { Metadata } from "./storageTypes";

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

export interface CodexPromptCommand {
    command: string;
    description?: string;
}

type CodexSurfaceMetadata = Pick<Metadata, "flavor" | "slashCommands" | "codex">;

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

export function resolveCodexPromptCommands(
    metadata: Pick<Metadata, "codex"> | null | undefined,
): CodexPromptCommand[] {
    const promptCommands: CodexPromptCommand[] = [];
    const seen = new Set<string>();

    for (const prompt of metadata?.codex?.prompts ?? []) {
        if (seen.has(prompt.name)) {
            continue;
        }
        seen.add(prompt.name);
        promptCommands.push({
            command: prompt.name,
            description: prompt.description ?? undefined,
        });
    }

    return promptCommands;
}

export function resolveCodexCompatibilitySlashCommands(
    metadata: Pick<Metadata, "slashCommands" | "codex"> | null | undefined,
): string[] {
    const promptNames = new Set(
        resolveCodexPromptCommands(metadata).map((prompt) => prompt.command),
    );

    return dedupeNames(
        (metadata?.slashCommands ?? []).filter(
            (command) => !promptNames.has(command),
        ),
    );
}

export function resolveCodexSurfaceSections(
    metadata: CodexSurfaceMetadata | null | undefined,
): CodexSurfaceSection[] {
    if (metadata?.flavor !== "codex") {
        return [];
    }

    const promptNames = resolveCodexPromptCommands(metadata).map(
        (prompt) => prompt.command,
    );
    const skillNames = dedupeNames(
        (metadata.codex?.skills ?? []).map((skill) => skill.name),
    );
    const agentNames = dedupeNames(
        (metadata.codex?.agents ?? []).map((agent) => agent.name),
    );
    const mcpServerNames = dedupeNames(
        (metadata.codex?.mcpServers ?? []).map((server) => server.name),
    );
    const compatibilityCommandNames =
        resolveCodexCompatibilitySlashCommands(metadata);

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
