import * as z from "zod";

/**
 * Per-agent user defaults — the App's mirror of the upstream b042d834a
 * "configurable agent defaults" feature, adapted to this fork.
 *
 * Difference from upstream slopus/happy: `codeAgentDefaults[*].permissionMode`
 * stays `'default'` rather than `'bypassPermissions'` / `'yolo'`. The
 * upstream choice trades safety for UX (auto-approve every tool on first
 * launch); we keep the safer floor and let users opt into yolo / bypass
 * explicitly from the Agent Defaults settings screen.
 *
 * The screen lets users override each (agent, field) cell with their own
 * value, or fall back to the code default below. CLI runners apply the
 * same defaults when no session-level override exists — see runClaude.ts
 * and runCodex.ts for the matching `DEFAULT_*` constants.
 */

export const agentKeys = ["claude", "codex", "gemini", "openclaw"] as const;
export type AgentKey = (typeof agentKeys)[number];

export const AgentDefaultOverrideSchema = z
    .object({
        permissionMode: z.string().optional(),
        modelMode: z.string().optional(),
        effortLevel: z.string().optional(),
    })
    .passthrough();

export const AgentDefaultOverridesSchema = z
    .object({
        claude: AgentDefaultOverrideSchema.optional(),
        codex: AgentDefaultOverrideSchema.optional(),
        gemini: AgentDefaultOverrideSchema.optional(),
        openclaw: AgentDefaultOverrideSchema.optional(),
    })
    .passthrough()
    .default({});

export type AgentDefaultOverride = z.infer<typeof AgentDefaultOverrideSchema>;
export type AgentDefaultOverrides = z.infer<typeof AgentDefaultOverridesSchema>;
export type AgentDefaultField = keyof Pick<
    AgentDefaultOverride,
    "permissionMode" | "modelMode" | "effortLevel"
>;

export type AgentDefaultConfig = {
    permissionMode: string;
    modelMode: string;
    effortLevel: string | null;
};

/**
 * Code-level defaults baked into the App. Users can override per (agent,
 * field) in settings; if no override exists, these win.
 *
 * `permissionMode: 'default'` (not 'yolo' / 'bypassPermissions') is the
 * intentional fork difference — see file header.
 */
const codeAgentDefaults: Record<AgentKey, AgentDefaultConfig> = {
    claude: { permissionMode: "default", modelMode: "opus", effortLevel: "medium" },
    codex: { permissionMode: "default", modelMode: "gpt-5.5", effortLevel: "medium" },
    gemini: { permissionMode: "default", modelMode: "gemini-2.5-pro", effortLevel: null },
    openclaw: { permissionMode: "default", modelMode: "default", effortLevel: null },
};

export function normalizeAgentKey(flavor: string | null | undefined): AgentKey {
    if (flavor === "codex" || flavor === "gemini" || flavor === "openclaw") {
        return flavor;
    }
    return "claude";
}

export function getCodeAgentDefaults(
    flavor: string | null | undefined,
): AgentDefaultConfig {
    return codeAgentDefaults[normalizeAgentKey(flavor)];
}

export function getAgentDefaultOverride(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
): AgentDefaultOverride {
    return overrides?.[normalizeAgentKey(flavor)] ?? {};
}

export function resolveAgentDefaultConfig(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
): AgentDefaultConfig {
    const codeDefaults = getCodeAgentDefaults(flavor);
    const userOverride = getAgentDefaultOverride(overrides, flavor);
    return {
        permissionMode: userOverride.permissionMode ?? codeDefaults.permissionMode,
        modelMode: userOverride.modelMode ?? codeDefaults.modelMode,
        effortLevel: userOverride.effortLevel ?? codeDefaults.effortLevel,
    };
}

export function hasAgentDefaultOverride(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
    field: AgentDefaultField,
): boolean {
    return getAgentDefaultOverride(overrides, flavor)[field] !== undefined;
}

export function getAgentDefaultOverrideValue(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
    field: AgentDefaultField,
): string | undefined {
    return getAgentDefaultOverride(overrides, flavor)[field];
}

export function setAgentDefaultOverride(
    overrides: AgentDefaultOverrides | null | undefined,
    flavor: string | null | undefined,
    field: AgentDefaultField,
    value: string | null | undefined,
): AgentDefaultOverrides {
    const key = normalizeAgentKey(flavor);
    const next: AgentDefaultOverrides = { ...(overrides ?? {}) };
    const current: AgentDefaultOverride = { ...(next[key] ?? {}) };

    if (value === null || value === undefined) {
        delete current[field];
    } else {
        current[field] = value;
    }

    if (Object.keys(current).length === 0) {
        delete next[key];
    } else {
        next[key] = current;
    }
    return next;
}
