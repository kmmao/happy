export type SessionProviderTone =
    | "purple"
    | "blue"
    | "orange"
    | "teal"
    | "magenta"
    | "green"
    | "neutral";

export function resolveSessionProviderTone(
    providerKey: string | null | undefined,
): SessionProviderTone {
    switch ((providerKey || "").trim().toLowerCase()) {
        case "claude":
            return "purple";
        case "codex":
        case "azure-openai":
            return "blue";
        case "gemini":
        case "minimax":
            return "orange";
        case "deepseek":
        case "opencode":
        case "acp":
            return "teal";
        case "zai":
            return "magenta";
        case "kimi":
            return "green";
        default:
            return "neutral";
    }
}
