interface SessionKnowledgeStateInput {
    projectServerId: string | undefined;
    sessionId: string | undefined;
}

interface KnowledgeRequestResultInput {
    requestToken: number;
    latestRequestToken: number;
}

export function shouldResetSessionKnowledgeState({
    projectServerId,
    sessionId,
}: SessionKnowledgeStateInput): boolean {
    return !projectServerId || !sessionId;
}

export function shouldApplyKnowledgeRequestResult({
    requestToken,
    latestRequestToken,
}: KnowledgeRequestResultInput): boolean {
    return requestToken === latestRequestToken;
}
