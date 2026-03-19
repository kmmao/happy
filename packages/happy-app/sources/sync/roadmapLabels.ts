/**
 * Roadmap Labels — Shared i18n label maps for roadmap types
 *
 * Centralizes label lookups so route pages and components
 * don't duplicate the same mapping tables.
 */

import { t } from "@/text";
import type {
    MoscowPriority,
    FeatureComplexity,
    FeatureStatus,
    MilestoneStatus,
} from "./roadmapTypes";

export const MOSCOW_LABELS: Record<MoscowPriority, () => string> = {
    must_have: () => t("roadmap.moscow.mustHave"),
    should_have: () => t("roadmap.moscow.shouldHave"),
    could_have: () => t("roadmap.moscow.couldHave"),
    wont_have: () => t("roadmap.moscow.wontHave"),
};

export const COMPLEXITY_LABELS: Record<FeatureComplexity, () => string> = {
    trivial: () => t("roadmap.complexity.trivial"),
    simple: () => t("roadmap.complexity.simple"),
    moderate: () => t("roadmap.complexity.moderate"),
    complex: () => t("roadmap.complexity.complex"),
    very_complex: () => t("roadmap.complexity.veryComplex"),
};

export const FEATURE_STATUS_LABELS: Record<FeatureStatus, () => string> = {
    planned: () => t("roadmap.featureStatuses.planned"),
    in_progress: () => t("roadmap.featureStatuses.inProgress"),
    completed: () => t("roadmap.featureStatuses.completed"),
    cancelled: () => t("roadmap.featureStatuses.cancelled"),
};

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, () => string> = {
    planning: () => t("roadmap.milestoneStatuses.planning"),
    active: () => t("roadmap.milestoneStatuses.active"),
    completed: () => t("roadmap.milestoneStatuses.completed"),
    on_hold: () => t("roadmap.milestoneStatuses.onHold"),
};
