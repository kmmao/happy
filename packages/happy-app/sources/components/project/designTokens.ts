/**
 * Centralized color tokens for Kanban, Ideation, and Roadmap modules.
 *
 * These colors are status/category-specific and intentionally kept outside
 * the theme system (which controls structural UI colors). They remain
 * constant across light/dark modes for consistent badge/dot semantics.
 */

import type { KanbanPriority, KanbanColumnId } from "@/sync/kanbanTypes";
import type { IdeationPriority, IdeationCategory } from "@/sync/ideationTypes";
import type { RoadmapFeatureStatus, RoadmapMoscow } from "@/sync/roadmapTypes";

// Shared priority colors (kanban + ideation)
export const PRIORITY_COLORS: Record<
  KanbanPriority | IdeationPriority,
  string
> = {
  low: "#6B7280",
  medium: "#3B82F6",
  high: "#F59E0B",
  urgent: "#EF4444",
};

// Ideation category colors
export const CATEGORY_COLORS: Record<IdeationCategory, string> = {
  feature: "#8B5CF6",
  improvement: "#10B981",
  bugfix: "#EF4444",
  refactor: "#F59E0B",
  documentation: "#3B82F6",
  other: "#6B7280",
};

// Roadmap feature status colors
export const FEATURE_STATUS_COLORS: Record<RoadmapFeatureStatus, string> = {
  planned: "#6B7280",
  in_progress: "#3B82F6",
  completed: "#10B981",
  cancelled: "#9CA3AF",
};

// Roadmap MoSCoW colors
export const MOSCOW_COLORS: Record<RoadmapMoscow, string> = {
  must_have: "#EF4444",
  should_have: "#F59E0B",
  could_have: "#3B82F6",
  wont_have: "#6B7280",
};

// "Converted" status color (ideation)
export const CONVERTED_COLOR = "#10B981";

// Kanban column accent colors (header borders and badges)
export const KANBAN_COLUMN_COLORS: Record<KanbanColumnId, string> = {
  backlog: "#6B7280",
  todo: "#3B82F6",
  in_progress: "#F59E0B",
  review: "#8B5CF6",
  done: "#10B981",
};

// Active session indicator color
export const ACTIVE_SESSION_COLOR = "#34C759";
