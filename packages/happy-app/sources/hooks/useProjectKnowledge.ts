import * as React from "react";

interface KnowledgeEntry {
    id: string;
    entryType: string;
    contributorType: string;
    status: string;
    title: string;
    content: string;
    structured: {
        request?: string;
        findings?: string;
        analysis?: string;
        outcome?: string;
        nextSteps?: string;
    } | null;
    tags: string[];
    confidence: string;
    sessionId: string | null;
    pinned: boolean;
    createdAt: number;
}

interface ProjectProfile {
    techStack: string[];
    architectureType?: string;
    knownPitfalls: string[];
    coreConventions: string[];
    lastUpdatedAt: number;
}

export function useProjectKnowledge(projectServerId: string | undefined) {
    const [entries, setEntries] = React.useState<KnowledgeEntry[]>([]);
    const [profile, setProfile] = React.useState<ProjectProfile | null>(null);
    const [loading, setLoading] = React.useState(false);

    const refresh = React.useCallback(() => {
        // TODO: Fetch from server API
    }, [projectServerId]);

    const updateEntry = React.useCallback(
        (entryId: string, data: { status?: string; pinned?: boolean }) => {
            // TODO: Call server API to update
            setEntries((prev) =>
                prev.map((e) => (e.id === entryId ? { ...e, ...data } : e)),
            );
        },
        [],
    );

    return { entries, profile, loading, refresh, updateEntry };
}
