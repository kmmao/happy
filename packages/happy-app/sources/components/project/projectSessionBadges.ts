import { Session } from "@/sync/storageTypes";

export type ProjectSessionScopeTone = "main" | "branch";

export interface ProjectSessionTextBadge {
    kind: "machine" | "version" | "branchName";
    value: string;
}

function normalizeBadgeValue(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

export function resolveProjectSessionScopeTone(
    session: Session,
): ProjectSessionScopeTone {
    return session.metadata?.worktree?.isWorktree ? "branch" : "main";
}

export function resolveProjectSessionTextBadges(input: {
    session: Session;
    machineLabel?: string | null;
}): ProjectSessionTextBadge[] {
    const badges: ProjectSessionTextBadge[] = [];
    const machineValue =
        normalizeBadgeValue(input.machineLabel) ??
        normalizeBadgeValue(input.session.metadata?.host);

    if (machineValue) {
        badges.push({ kind: "machine", value: machineValue });
    }

    const versionValue = normalizeBadgeValue(input.session.metadata?.version);
    if (versionValue) {
        badges.push({ kind: "version", value: versionValue });
    }

    const branchValue = input.session.metadata?.worktree?.isWorktree
        ? normalizeBadgeValue(input.session.metadata?.worktree?.branchName)
        : null;
    if (branchValue) {
        badges.push({ kind: "branchName", value: branchValue });
    }

    return badges;
}
