import { t } from "@/text";

export const ROLES = ["owner", "admin", "member", "observer"] as const;

export const ROLE_COLORS: Record<string, string> = {
    owner: "#F59E0B",
    admin: "#3B82F6",
    member: "#10B981",
    observer: "#6B7280",
};

export const ROLE_ICONS: Record<string, string> = {
    owner: "shield",
    admin: "key",
    member: "person",
    observer: "eye",
};

export const ROLE_LABELS: Record<string, () => string> = {
    owner: () => t("members.roleOwner"),
    admin: () => t("members.roleAdmin"),
    member: () => t("members.roleMember"),
    observer: () => t("members.roleObserver"),
};

export const NOTIFY_LABELS: Record<string, () => string> = {
    all: () => t("members.notifyAll"),
    critical: () => t("members.notifyCritical"),
    assigned: () => t("members.notifyAssigned"),
    none: () => t("members.notifyNone"),
};

export const AVAILABILITY_COLORS: Record<string, string> = {
    active: "#10B981",
    away: "#F59E0B",
    delegate: "#8B5CF6",
};

export const AVAILABILITY_LABELS: Record<string, () => string> = {
    active: () => t("members.availabilityActive"),
    away: () => t("members.availabilityAway"),
    delegate: () => t("members.availabilityDelegate"),
};

export const PERMISSION_DEFAULTS: Record<string, {
    lawAuthority: string;
    decisionScope: string;
    goalAuthority: string;
    notifyLevel: string;
}> = {
    owner: { lawAuthority: "create", decisionScope: "all", goalAuthority: "create", notifyLevel: "all" },
    admin: { lawAuthority: "create", decisionScope: "all", goalAuthority: "create", notifyLevel: "all" },
    member: { lawAuthority: "suggest", decisionScope: "assigned", goalAuthority: "create", notifyLevel: "assigned" },
    observer: { lawAuthority: "readonly", decisionScope: "none", goalAuthority: "readonly", notifyLevel: "critical" },
};
