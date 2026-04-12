/**
 * Shared constants and helpers for the World Laws UI.
 */

import { t } from "@/text";

export interface Law {
    id: string;
    category: string;
    description: string;
    enabled: boolean;
    severity: string;
}

export const LAW_CATEGORIES = ["quality", "security", "architecture", "convention", "process", "ops", "custom"] as const;
export const LAW_SEVERITIES = ["critical", "high", "medium", "low"] as const;

export const CATEGORY_LABELS: Record<string, () => string> = {
    quality: () => t("world.categoryQuality"),
    security: () => t("world.categorySecurity"),
    architecture: () => t("world.categoryArchitecture"),
    convention: () => t("world.categoryConvention"),
    process: () => t("world.categoryProcess"),
    ops: () => t("world.categoryOps"),
    custom: () => t("world.categoryCustom"),
};

export const SEVERITY_LABELS: Record<string, () => string> = {
    critical: () => t("world.severityCritical"),
    high: () => t("world.severityHigh"),
    medium: () => t("world.severityMedium"),
    low: () => t("world.severityLow"),
};

export const SEVERITY_COLORS: Record<string, string> = {
    critical: "#DC2626",
    high: "#EA580C",
    medium: "#CA8A04",
    low: "#65A30D",
};

export function generateLawId(): string {
    return `law-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseLaws(lawsJson: string | null | undefined): Law[] {
    if (!lawsJson) return [];
    try {
        const parsed = JSON.parse(lawsJson);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
