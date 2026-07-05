interface SessionKnowledgeStateInput {
    projectServerId: string | undefined;
    sessionId: string | undefined;
}

export function shouldResetSessionKnowledgeState({
    projectServerId,
    sessionId,
}: SessionKnowledgeStateInput): boolean {
    return !projectServerId || !sessionId;
}
