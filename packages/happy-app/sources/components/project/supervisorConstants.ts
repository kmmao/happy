import type { TranslationKey } from "@/text";

export const SEVERITY_COLORS: Record<string, string> = {
    critical: "#FF3B30",
    high: "#FF9500",
    medium: "#FFD60A",
    low: "#8E8E93",
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
};

export function getConfidenceColor(confidence: number | null): string | null {
    if (confidence == null) return null;
    if (confidence >= 80) return "#34C759";
    if (confidence >= 50) return "#FFD60A";
    return "#FF3B30";
}
