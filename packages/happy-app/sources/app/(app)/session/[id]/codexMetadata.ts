import type { Session } from "@/sync/storageTypes";
import {
    resolveCodexSurfaceSections,
} from "@/sync/codexSurface";

const KNOWN_REASONING_EFFORTS = new Set([
    "low",
    "medium",
    "high",
    "max",
    "xhigh",
]);

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
            resolveCodexSurfaceSections(session.metadata).length > 0,
    );
}
