/**
 * Unified dimension label resolver for supervisor tabs.
 *
 * Covers three categories of dimension keys:
 * - Health analysis dimensions (security, dependencies, etc.)
 * - Research dimensions (pricing, features, etc.)
 * - Preflight sync steps (preflight_start, preflight_check, etc.)
 */

import { t } from "@/text";
import type { TranslationKey } from "@/text";

// Health analysis dimension keys → i18n keys
const healthDimensionMap: Record<string, TranslationKey> = {
    security: "supervisor.dimSecurity",
    dependencies: "supervisor.dimDependencies",
    architecture: "supervisor.dimArchitecture",
    techDebt: "supervisor.dimTechDebt",
    codeQuality: "supervisor.dimCodeQuality",
    testCoverage: "supervisor.dimTestCoverage",
    documentation: "supervisor.dimDocumentation",
    performance: "supervisor.dimPerformance",
    uiUx: "supervisor.dimUiUx",
    typeSafety: "supervisor.dimTypeSafety",
    observability: "supervisor.dimObservability",
    apiDesign: "supervisor.dimApiDesign",
    buildCI: "supervisor.dimBuildCI",
};

// Research dimension keys → i18n keys
const researchDimensionMap: Record<string, TranslationKey> = {
    pricing: "competitorResearch.dim_pricing",
    features: "competitorResearch.dim_features",
    devExperience: "competitorResearch.dim_devExperience",
    positioning: "competitorResearch.dim_positioning",
    techStack: "competitorResearch.dim_techStack",
    community: "competitorResearch.dim_community",
    funding: "competitorResearch.dim_funding",
    userFeedback: "competitorResearch.dim_userFeedback",
};

// Preflight sync step keys → i18n keys
const preflightDimensionMap: Record<string, TranslationKey> = {
    preflight_start: "supervisor.dimPreflightStart",
    preflight_check: "supervisor.dimPreflightCheck",
    preflight_stash: "supervisor.dimPreflightStash",
    preflight_fetch: "supervisor.dimPreflightFetch",
    preflight_pull: "supervisor.dimPreflightPull",
    preflight_resolve: "supervisor.dimPreflightResolve",
    preflight_deploy: "supervisor.dimPreflightDeploy",
    preflight_deploy_cli: "supervisor.dimPreflightDeployCli",
    preflight_deploy_server: "supervisor.dimPreflightDeployServer",
};

// Custom dimension key → title map (populated at runtime from project data)
let customDimensionMap: Record<string, string> = {};

/** Register custom dimension labels so action cards can resolve their titles. */
export function setCustomDimensionLabels(
    dims: ReadonlyArray<{ key: string; title: string }>,
): void {
    customDimensionMap = Object.fromEntries(dims.map((d) => [d.key, d.title]));
}

/**
 * Resolve a dimension key to a localized label.
 * Works across all four dimension categories (built-in, research, preflight, custom).
 * Returns the raw key if no mapping is found.
 */
export function resolveDimensionLabel(key: string): string {
    const translationKey =
        healthDimensionMap[key] ??
        researchDimensionMap[key] ??
        preflightDimensionMap[key];
    if (translationKey) return t(translationKey);
    return customDimensionMap[key] ?? key;
}

// Run status → i18n key mapping
const statusKeyMap: Record<string, TranslationKey> = {
    pending: "supervisor.status_pending",
    running: "supervisor.status_running",
    completed: "supervisor.status_completed",
    failed: "supervisor.status_failed",
    cancelled: "supervisor.status_cancelled",
};

/** Resolve a run status to a localized label. */
export function statusLabel(status: string): string {
    const key = statusKeyMap[status];
    return key ? t(key) : status;
}
