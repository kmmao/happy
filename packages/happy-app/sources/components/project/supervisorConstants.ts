import type { TranslationKey } from "@/text";

export const SEVERITY_COLORS: Record<string, string> = {
    critical: "#FF3B30",
    high: "#E67E00",
    medium: "#C4A000",
    low: "#6D6D72",
};

export const SEVERITY_KEY_MAP: Record<string, TranslationKey> = {
    critical: "supervisor.severityCritical",
    high: "supervisor.severityHigh",
    medium: "supervisor.severityMedium",
    low: "supervisor.severityLow",
};

export const CATEGORY_KEY_MAP: Record<string, TranslationKey> = {
    security: "supervisor.dimSecurity",
    dependencies: "supervisor.dimDependencies",
    architecture: "supervisor.dimArchitecture",
    techDebt: "supervisor.dimTechDebt",
    codeQuality: "supervisor.dimCodeQuality",
    testCoverage: "supervisor.dimTestCoverage",
    documentation: "supervisor.dimDocumentation",
    performance: "supervisor.dimPerformance",
    uiUx: "supervisor.dimUiUx",
    "ui-ux": "supervisor.dimUiUx",
    research: "supervisor.dimResearch",
};

export function getConfidenceColor(confidence: number | null): string | null {
    if (confidence == null) return null;
    if (confidence >= 80) return "#2DA44E";
    if (confidence >= 50) return "#B8860B";
    return "#CF222E";
}

// --- Urgency ---

export type UrgencyLevel = "urgent" | "must-fix" | "optional";

export function getUrgencyLevel(severity: string, confidence: number | null): UrgencyLevel {
    const conf = confidence ?? 0;
    if (severity === "critical" || (severity === "high" && conf >= 80)) return "urgent";
    if (severity === "high" || (severity === "medium" && conf >= 80)) return "must-fix";
    return "optional";
}

export const URGENCY_COLORS: Record<UrgencyLevel, string> = {
    urgent: "#CF222E",
    "must-fix": "#E67E00",
    optional: "#6D6D72",
};

export const URGENCY_KEY_MAP: Record<UrgencyLevel, TranslationKey> = {
    urgent: "supervisor.urgentTag",
    "must-fix": "supervisor.mustFixTag",
    optional: "supervisor.optionalTag",
};

// --- Sort helpers ---

export const SEVERITY_ORDER: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
};

export const URGENCY_ORDER: Record<UrgencyLevel, number> = {
    urgent: 0,
    "must-fix": 1,
    optional: 2,
};

export type SortField = "severity" | "category" | "confidence" | "urgency";

export const SORT_KEY_MAP: Record<SortField, TranslationKey> = {
    severity: "supervisor.sortSeverity",
    category: "supervisor.sortCategory",
    confidence: "supervisor.sortConfidence",
    urgency: "supervisor.sortUrgency",
};
