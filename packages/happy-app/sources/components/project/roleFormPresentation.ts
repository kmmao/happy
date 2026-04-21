import { t } from "@/text";

export const ROLE_TYPES = [
  "guardian",
  "builder",
  "healer",
  "chronicler",
  "planner",
  "messenger",
  "custom",
] as const;

export const TEMPLATE_TYPES = ROLE_TYPES.filter((roleType) => roleType !== "custom");

export const TYPE_LABELS: Record<string, () => string> = {
  guardian: () => t("roles.typeGuardian"),
  builder: () => t("roles.typeBuilder"),
  healer: () => t("roles.typeHealer"),
  chronicler: () => t("roles.typeChronicler"),
  planner: () => t("roles.typePlanner"),
  messenger: () => t("roles.typeMessenger"),
  custom: () => t("roles.typeCustom"),
};

export const TYPE_ICONS: Record<string, string> = {
  guardian: "shield-checkmark",
  builder: "hammer",
  healer: "medkit",
  chronicler: "book",
  planner: "map",
  messenger: "mail",
  custom: "person",
};

export const TYPE_COLORS: Record<string, string> = {
  guardian: "#3B82F6",
  builder: "#F59E0B",
  healer: "#10B981",
  chronicler: "#8B5CF6",
  planner: "#EC4899",
  messenger: "#06B6D4",
  custom: "#6B7280",
};

export const ROLE_TEMPLATE_DEFAULTS: Record<string, { description: string; duties: string[] }> = {
  guardian: {
    description: "You are the Guardian of this world. Your mission is to protect code quality, security, and compliance with world laws.",
    duties: [
      "Scan for security vulnerabilities",
      "Check dependency updates and known CVEs",
      "Verify compliance with world laws",
      "Report violations with evidence",
    ],
  },
  builder: {
    description: "You are the Builder. Your mission is to implement features and write code according to specifications.",
    duties: [
      "Implement assigned tasks and features",
      "Write tests for new code",
      "Follow world conventions and style guides",
      "Update documentation when needed",
    ],
  },
  healer: {
    description: "You are the Healer. Your mission is to diagnose and fix issues, monitor health, and optimize performance.",
    duties: [
      "Monitor build health and CI status",
      "Fix failing tests and broken builds",
      "Diagnose and fix performance issues",
      "Fix reported bugs with minimal changes",
    ],
  },
  chronicler: {
    description: "You are the Chronicler. Your mission is to maintain this world's knowledge base and documentation.",
    duties: [
      "Update knowledge base entries after significant changes",
      "Write changelog entries for releases",
      "Summarize session outcomes into knowledge",
      "Archive stale or superseded knowledge",
    ],
  },
  planner: {
    description: "You are the Planner. Your mission is to analyze goals, break them into tasks, and create execution plans.",
    duties: [
      "Analyze high-level world goals",
      "Break goals into actionable tasks with estimates",
      "Assess risks and dependencies",
      "Prioritize task execution order",
    ],
  },
  messenger: {
    description: "You are the Messenger. Your mission is to coordinate communication across roles and keep shared context aligned.",
    duties: [
      "Route requests and updates between roles with clear ownership",
      "Summarize key decisions and unresolved conflicts",
      "Ensure law suggestions and conflict reports reach the right reviewers",
      "Keep communication concise, traceable, and actionable",
    ],
  },
};

export const MODEL_PRESET_VALUES = [
  "",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "gpt-4.5",
] as const;

export type RoleModelPresetValue = (typeof MODEL_PRESET_VALUES)[number] | "custom";

export const MODEL_PRESET_LABELS: Record<string, string> = {
  "": "",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "gpt-4.5": "gpt-4.5",
};

export function resolveInitialModelPreset(
  modelOverride: string | null | undefined,
): RoleModelPresetValue {
  if (!modelOverride) return "";
  if (MODEL_PRESET_VALUES.includes(modelOverride as (typeof MODEL_PRESET_VALUES)[number])) {
    return modelOverride as RoleModelPresetValue;
  }
  return "custom";
}
