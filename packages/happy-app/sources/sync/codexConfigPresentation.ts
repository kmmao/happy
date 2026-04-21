type CodexPresentationTranslationKey =
    | "sessionInfo.codexBackendAuto"
    | "profiles.codexBackendAuto"
    | "sessionInfo.codexBackendAppServer"
    | "profiles.codexBackendAppServer"
    | "sessionInfo.codexBackendLegacyMcp"
    | "profiles.codexBackendLegacy"
    | "sessionInfo.codexConfigModeInherit"
    | "profiles.codexConfigInherit"
    | "sessionInfo.codexConfigModeManagedProfile"
    | "profiles.codexConfigManagedProfile"
    | "sessionInfo.codexConfigModeManagedOverrides"
    | "profiles.codexConfigManagedOverrides";

type Translate = (key: CodexPresentationTranslationKey) => string;

export type CodexBackendModeValue =
    | "auto"
    | "codex-app-server"
    | "codex-mcp-legacy";

export type CodexConfigModeValue =
    | "inherit"
    | "managed-profile"
    | "managed-overrides";

export type CodexPresentationContext = "session" | "profile";

export function resolveCodexBackendModeLabel(
    value: CodexBackendModeValue,
    translate: Translate,
    context: CodexPresentationContext,
): string {
    if (value === "auto") {
        return translate(
            context === "session"
                ? "sessionInfo.codexBackendAuto"
                : "profiles.codexBackendAuto",
        );
    }

    if (value === "codex-app-server") {
        return translate(
            context === "session"
                ? "sessionInfo.codexBackendAppServer"
                : "profiles.codexBackendAppServer",
        );
    }

    return translate(
        context === "session"
            ? "sessionInfo.codexBackendLegacyMcp"
            : "profiles.codexBackendLegacy",
    );
}

export function resolveCodexConfigModeLabel(
    value: CodexConfigModeValue,
    translate: Translate,
    context: CodexPresentationContext,
): string {
    if (value === "inherit") {
        return translate(
            context === "session"
                ? "sessionInfo.codexConfigModeInherit"
                : "profiles.codexConfigInherit",
        );
    }

    if (value === "managed-profile") {
        return translate(
            context === "session"
                ? "sessionInfo.codexConfigModeManagedProfile"
                : "profiles.codexConfigManagedProfile",
        );
    }

    return translate(
        context === "session"
            ? "sessionInfo.codexConfigModeManagedOverrides"
            : "profiles.codexConfigManagedOverrides",
    );
}

export function getCodexBackendModeOptions(translate: Translate): Array<{
    value: CodexBackendModeValue;
    label: string;
}> {
    return [
        {
            value: "auto",
            label: resolveCodexBackendModeLabel("auto", translate, "profile"),
        },
        {
            value: "codex-app-server",
            label: resolveCodexBackendModeLabel(
                "codex-app-server",
                translate,
                "profile",
            ),
        },
        {
            value: "codex-mcp-legacy",
            label: resolveCodexBackendModeLabel(
                "codex-mcp-legacy",
                translate,
                "profile",
            ),
        },
    ];
}

export function getCodexConfigModeOptions(translate: Translate): Array<{
    value: CodexConfigModeValue;
    label: string;
}> {
    return [
        {
            value: "inherit",
            label: resolveCodexConfigModeLabel("inherit", translate, "profile"),
        },
        {
            value: "managed-profile",
            label: resolveCodexConfigModeLabel(
                "managed-profile",
                translate,
                "profile",
            ),
        },
        {
            value: "managed-overrides",
            label: resolveCodexConfigModeLabel(
                "managed-overrides",
                translate,
                "profile",
            ),
        },
    ];
}
