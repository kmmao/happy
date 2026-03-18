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

// Known Claude model pricing for enriching CLI-reported descriptions
const CLAUDE_MODEL_PRICING: Record<string, string> = {
  "default": "$3/$15 \u00B7 200K",
  "sonnet": "$3/$15 \u00B7 200K",
  "sonnet-1m": "$6/$22.50 \u00B7 1M",
  "haiku": "$1/$5 \u00B7 200K",
  "opus": "$5/$25 \u00B7 200K",
  "opus-1m": "$10/$37.50 \u00B7 1M",
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
      description: "Use CLI default settings",
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
      description: "Sonnet 4.6 \u00B7 $3/$15 \u00B7 200K",
    },
    {
      key: "haiku",
      name: "Haiku",
      description: "Haiku 4.5 \u00B7 Fastest \u00B7 $1/$5 \u00B7 200K",
    },
    {
      key: "sonnet",
      name: "Sonnet",
      description: "Sonnet 4.6 \u00B7 Balanced \u00B7 $3/$15 \u00B7 200K",
    },
    {
      key: "sonnet-1m",
      name: "Sonnet (1M)",
      description: "Sonnet 4.6 \u00B7 Long context \u00B7 $6/$22.50",
    },
    {
      key: "opus",
      name: "Opus",
      description: "Opus 4.6 \u00B7 Most capable \u00B7 $5/$25 \u00B7 200K",
    },
    {
      key: "opus-1m",
      name: "Opus (1M)",
      description: "Opus 4.6 \u00B7 Long context \u00B7 $10/$37.50",
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
      key: "gpt-5.3-codex",
      name: translate("agentInput.codexModel.gpt53Codex"),
      description: null,
    },
    {
      key: "gpt-5.3-codex-spark",
      name: translate("agentInput.codexModel.gpt53CodexSpark"),
      description: null,
    },
    {
      key: "gpt-5.2-codex",
      name: translate("agentInput.codexModel.gpt52Codex"),
      description: null,
    },
    {
      key: "gpt-5.1-codex-max",
      name: translate("agentInput.codexModel.gpt51CodexMax"),
      description: null,
    },
    {
      key: "gpt-5.1-codex",
      name: translate("agentInput.codexModel.gpt51Codex"),
      description: null,
    },
    {
      key: "gpt-5-codex",
      name: translate("agentInput.codexModel.gpt5Codex"),
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

export function getAvailableModels(
  flavor: AgentFlavor,
  metadata: Metadata | null | undefined,
  translate: Translate,
  customModels?: CustomModel[] | null,
): ModelMode[] {
  // Priority 1: CLI dynamically reported models
  const metadataModels = mapMetadataOptions(metadata?.models);
  if (metadataModels.length > 0) {
    return metadataModels;
  }

  // Priority 2: Profile custom models (e.g., MiniMax, DeepSeek)
  if (customModels && customModels.length > 0) {
    return [
      { key: "default", name: "Default", description: "Use CLI settings" },
      ...customModels.map((m) => ({
        key: m.id,
        name: m.name,
        description: m.description ?? null,
      })),
    ];
  }

  // Priority 3: Hardcoded defaults
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
    return "gpt-5.3-codex";
  }
  if (flavor === "gemini") {
    return "gemini-3-flash-preview";
  }
  return "default";
}

export function getDefaultPermissionModeKey(_flavor: AgentFlavor): string {
  return "default";
}
