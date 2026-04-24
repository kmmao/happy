import type { Metadata } from "@/sync/storageTypes";
import { hackModes } from "@/sync/modeHacks";

export type ModeOption = {
  key: string;
  name: string;
  description?: string | null;
};

export type PermissionMode = ModeOption;
export type ModelMode = ModeOption;

export type PermissionModeKey = string;
export type ModelModeKey = string;

export type AgentFlavor =
  | "claude"
  | "codex"
  | "gemini"
  | string
  | null
  | undefined;

export const LOCKED_CODEX_MODEL = "gpt-5.5";
export const SUPPORTED_CODEX_MODELS = [
  LOCKED_CODEX_MODEL,
  "gpt-5.4",
  "gpt-5.3-codex",
] as const;

type Translate = (key: any) => string;

type MetadataOption = {
  code: string;
  value: string;
  description?: string | null;
};

const GEMINI_MODEL_FALLBACKS: ModelMode[] = [
  {
    key: "gemini-3-pro-preview",
    name: "Gemini 3 Pro Preview",
    description: "Most capable",
  },
  {
    key: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    description: "Fast & capable",
  },
  {
    key: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    description: "Previous gen pro",
  },
  {
    key: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Previous gen flash",
  },
  {
    key: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    description: "Fastest",
  },
];

// Known Claude model pricing for enriching CLI-reported descriptions.
// Sonnet/Opus default to 1M context — the -1m keys are kept for back-compat
// of already-persisted sessions but no longer surfaced as separate options.
const CLAUDE_MODEL_PRICING: Record<string, string> = {
  "sonnet": "$3/$15",
  "sonnet-1m": "$3/$15",
  "haiku": "$1/$5 \u00B7 200K",
  "opus": "$5/$25",
  "opus-1m": "$5/$25",
  "opus-4-7": "$5/$25",
  "opus-4-7-1m": "$5/$25",
};

function enrichDescription(code: string, description: string | null | undefined): string | null {
  const pricing = CLAUDE_MODEL_PRICING[code];
  if (!pricing) return description ?? null;
  // Strip any existing pricing info (e.g. wrong $3/$15 on 1M models) and append correct pricing
  const stripped = description?.replace(/\s*\u00B7?\s*\$[\d./]+\s*(per Mtok)?/gi, "").trim();
  return stripped ? `${stripped} \u00B7 ${pricing}` : pricing;
}

export function mapMetadataOptions(
  options?: MetadataOption[] | null,
): ModeOption[] {
  if (!options || options.length === 0) {
    return [];
  }

  return options.map((option) => ({
    key: option.code,
    name: option.value,
    description: enrichDescription(option.code, option.description),
  }));
}

export function getClaudePermissionModes(
  translate: Translate,
): PermissionMode[] {
  return [
    {
      key: "default",
      name: translate("agentInput.permissionMode.default"),
      description: "Ask before each action",
    },
    {
      key: "acceptEdits",
      name: translate("agentInput.permissionMode.acceptEdits"),
      description: "Auto-approve file edits",
    },
    {
      key: "plan",
      name: translate("agentInput.permissionMode.plan"),
      description: "Plan only, no code execution",
    },
    {
      key: "dontAsk",
      name: translate("agentInput.permissionMode.dontAsk"),
      description: "Auto-deny unapproved actions",
    },
    {
      key: "auto",
      name: translate("agentInput.permissionMode.auto"),
      description: "AI classifier auto-approves/denies",
    },
    {
      key: "bypassPermissions",
      name: translate("agentInput.permissionMode.bypassPermissions"),
      description: "Auto-approve everything",
    },
  ];
}

export function getCodexPermissionModes(
  translate: Translate,
): PermissionMode[] {
  return [
    {
      key: "default",
      name: translate("agentInput.codexPermissionMode.default"),
      description: "Use Codex default settings",
    },
    {
      key: "read-only",
      name: translate("agentInput.codexPermissionMode.readOnly"),
      description: "Read files, no modifications",
    },
    {
      key: "safe-yolo",
      name: translate("agentInput.codexPermissionMode.safeYolo"),
      description: "Auto-approve safe actions",
    },
    {
      key: "yolo",
      name: translate("agentInput.codexPermissionMode.yolo"),
      description: "Auto-approve everything",
    },
  ];
}

export function getGeminiPermissionModes(
  translate: Translate,
): PermissionMode[] {
  return [
    {
      key: "default",
      name: translate("agentInput.geminiPermissionMode.default"),
      description: "Use CLI default settings",
    },
    {
      key: "read-only",
      name: translate("agentInput.geminiPermissionMode.readOnly"),
      description: "Read files, no modifications",
    },
    {
      key: "safe-yolo",
      name: translate("agentInput.geminiPermissionMode.safeYolo"),
      description: "Auto-approve safe actions",
    },
    {
      key: "yolo",
      name: translate("agentInput.geminiPermissionMode.yolo"),
      description: "Auto-approve everything",
    },
  ];
}

export function getClaudeModelModes(): ModelMode[] {
  return [
    {
      key: "default",
      name: "Default",
      description: "Use CLI configured model",
    },
    {
      key: "sonnet",
      name: "Sonnet",
      description: "Sonnet 4.6 \u00B7 $3/$15",
    },
    {
      key: "opus-4-7",
      name: "Opus 4.7",
      description: "Opus 4.7 \u00B7 Latest \u00B7 $5/$25",
    },
    {
      key: "opus",
      name: "Opus",
      description: "Opus 4.6 \u00B7 $5/$25",
    },
    {
      key: "haiku",
      name: "Haiku",
      description: "Haiku 4.5 \u00B7 Fastest \u00B7 $1/$5 \u00B7 200K",
    },
    {
      key: "opusplan",
      name: "Opus Plan",
      description: "Plan: Opus 4.6 \u00B7 Execute: Sonnet 4.6",
    },
  ];
}

export function getCodexModelModes(translate: Translate): ModelMode[] {
  return [
    {
      key: LOCKED_CODEX_MODEL,
      name: translate("agentInput.codexModel.gpt55"),
      description: null,
    },
    {
      key: "gpt-5.4",
      name: translate("agentInput.codexModel.gpt54"),
      description: null,
    },
    {
      key: "gpt-5.3-codex",
      name: translate("agentInput.codexModel.gpt53Codex"),
      description: null,
    },
  ];
}

export function getGeminiModelModes(): ModelMode[] {
  return GEMINI_MODEL_FALLBACKS;
}

export function getHardcodedPermissionModes(
  flavor: AgentFlavor,
  translate: Translate,
): PermissionMode[] {
  if (flavor === "codex") {
    return getCodexPermissionModes(translate);
  }
  if (flavor === "gemini") {
    return getGeminiPermissionModes(translate);
  }
  return getClaudePermissionModes(translate);
}

export function getHardcodedModelModes(
  flavor: AgentFlavor,
  translate: Translate,
): ModelMode[] {
  if (flavor === "codex") {
    return getCodexModelModes(translate);
  }
  if (flavor === "gemini") {
    return getGeminiModelModes();
  }
  return getClaudeModelModes();
}

export type CustomModel = {
  id: string;
  name: string;
  description?: string | null;
};

function dedupeModeOptions(options: ModeOption[]): ModeOption[] {
  const seen = new Set<string>();
  const result: ModeOption[] = [];
  for (const option of options) {
    const key = option.key?.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      key,
      name: option.name,
      description: option.description ?? null,
    });
  }
  return result;
}

export function getAvailableModels(
  flavor: AgentFlavor,
  metadata: Metadata | null | undefined,
  translate: Translate,
  customModels?: CustomModel[] | null,
): ModelMode[] {
  if (flavor === "codex") {
    return getHardcodedModelModes(flavor, translate);
  }

  // For Claude: always use hardcoded models (ignore CLI's "Default (recommended)" wrapper)
  // This ensures consistent UI with "Use CLI configured model" description and proper Sonnet option
  if (flavor === "claude" || flavor === undefined) {
    // Priority 1: Profile custom models (e.g., MiniMax, DeepSeek)
    if (customModels && customModels.length > 0) {
      return dedupeModeOptions([
        {
          key: "default",
          name: "Default",
          description: "Use CLI configured model",
        },
        ...customModels.map((m) => ({
          key: m.id,
          name: m.name,
          description: m.description ?? null,
        })),
      ]);
    }

    // Priority 2: Hardcoded Claude models
    return getHardcodedModelModes(flavor, translate);
  }

  // Priority 1 (non-Claude): CLI dynamically reported models
  const metadataModels = dedupeModeOptions(mapMetadataOptions(metadata?.models));
  if (metadataModels.length > 0) {
    return metadataModels;
  }

  // Priority 2 (non-Claude): Profile custom models
  if (customModels && customModels.length > 0) {
    const defaultOption = { key: "default", name: "Default", description: "Use CLI settings" };
    return dedupeModeOptions([
      defaultOption,
      ...customModels.map((m) => ({
        key: m.id,
        name: m.name,
        description: m.description ?? null,
      })),
    ]);
  }

  // Priority 3 (non-Claude): Hardcoded defaults
  return getHardcodedModelModes(flavor, translate);
}

export function getAvailablePermissionModes(
  flavor: AgentFlavor,
  metadata: Metadata | null | undefined,
  translate: Translate,
): PermissionMode[] {
  if (flavor === "claude" || flavor === "codex") {
    return hackModes(getHardcodedPermissionModes(flavor, translate));
  }

  const metadataModes = mapMetadataOptions(metadata?.operatingModes);
  if (metadataModes.length > 0) {
    return hackModes(metadataModes);
  }

  return hackModes(getHardcodedPermissionModes(flavor, translate));
}

export function findOptionByKey<T extends ModeOption>(
  options: T[],
  key: string | null | undefined,
): T | null {
  if (!key) {
    return null;
  }
  return options.find((option) => option.key === key) ?? null;
}

export function resolveCurrentOption<T extends ModeOption>(
  options: T[],
  preferredKeys: Array<string | null | undefined>,
): T | null {
  for (const key of preferredKeys) {
    const option = findOptionByKey(options, key);
    if (option) {
      return option;
    }
  }
  return null;
}

export function getDefaultModelKey(flavor: AgentFlavor): string {
  if (flavor === "codex") {
    return LOCKED_CODEX_MODEL;
  }
  if (flavor === "gemini") {
    return "gemini-3-flash-preview";
  }
  return "default";
}

export function getDefaultPermissionModeKey(flavor: AgentFlavor): string {
  if (flavor === "claude") return "auto";
  return "default";
}

/**
 * Format raw model IDs into user-friendly display names.
 * e.g., "claude-sonnet-4-6" → "Sonnet 4.6"
 *       "claude-opus-4-6[1m]" → "Opus 4.6 (1M)"
 */
export function formatModelName(modelId: string): string {
  const is1M = modelId.includes("[1m]");
  const base = modelId.replace("[1m]", "").replace("claude-", "");

  const patterns: Array<[RegExp, string]> = [
    [/^opus-(\d+)-(\d+)/, "Opus $1.$2"],
    [/^sonnet-(\d+)-(\d+)/, "Sonnet $1.$2"],
    [/^haiku-(\d+)-(\d+)/, "Haiku $1.$2"],
    [/^opus-(\d+)/, "Opus $1"],
    [/^sonnet-(\d+)/, "Sonnet $1"],
    [/^haiku-(\d+)/, "Haiku $1"],
  ];

  let name = base;
  for (const [pattern, replacement] of patterns) {
    if (pattern.test(base)) {
      name = base.replace(pattern, replacement);
      break;
    }
  }

  // Remove trailing date suffixes like "-20251001"
  name = name.replace(/-\d{8}$/, "");

  return is1M ? `${name} (1M)` : name;
}
