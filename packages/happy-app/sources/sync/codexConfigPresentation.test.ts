import { describe, expect, it } from "vitest";
import {
    getCodexBackendModeOptions,
    getCodexConfigModeOptions,
    resolveCodexBackendModeLabel,
    resolveCodexConfigModeLabel,
} from "./codexConfigPresentation";

const translate = (key: string) => key;

describe("resolveCodexBackendModeLabel", () => {
    it("uses session labels for session metadata surfaces", () => {
        expect(
            resolveCodexBackendModeLabel("codex-app-server", translate, "session"),
        ).toBe("sessionInfo.codexBackendAppServer");
    });

    it("uses profile labels for settings surfaces", () => {
        expect(
            resolveCodexBackendModeLabel("codex-mcp-legacy", translate, "profile"),
        ).toBe("profiles.codexBackendLegacy");
    });
});

describe("resolveCodexConfigModeLabel", () => {
    it("uses session labels for session metadata surfaces", () => {
        expect(
            resolveCodexConfigModeLabel("managed-profile", translate, "session"),
        ).toBe("sessionInfo.codexConfigModeManagedProfile");
    });

    it("uses profile labels for settings surfaces", () => {
        expect(
            resolveCodexConfigModeLabel("inherit", translate, "profile"),
        ).toBe("profiles.codexConfigInherit");
    });
});

describe("codex config option builders", () => {
    it("builds backend mode options for settings UIs", () => {
        expect(getCodexBackendModeOptions(translate)).toEqual([
            {
                value: "auto",
                label: "profiles.codexBackendAuto",
            },
            {
                value: "codex-app-server",
                label: "profiles.codexBackendAppServer",
            },
            {
                value: "codex-mcp-legacy",
                label: "profiles.codexBackendLegacy",
            },
        ]);
    });

    it("builds config mode options for settings UIs", () => {
        expect(getCodexConfigModeOptions(translate)).toEqual([
            {
                value: "inherit",
                label: "profiles.codexConfigInherit",
            },
            {
                value: "managed-profile",
                label: "profiles.codexConfigManagedProfile",
            },
            {
                value: "managed-overrides",
                label: "profiles.codexConfigManagedOverrides",
            },
        ]);
    });
});
