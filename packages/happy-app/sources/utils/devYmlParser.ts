/**
 * Parser and serializer for .happy/dev.yml files.
 *
 * Uses js-yaml for robust parsing (supports full YAML spec).
 * Hand-written serializer to maintain consistent formatting.
 */

import yaml from "js-yaml";

export type DevConfigFile = {
    readonly path: string;
    readonly label: string;
};

export type DevExposeConfig = {
    readonly caddy?: {
        readonly hostname: string;
    };
    readonly tailscale?: {
        readonly funnel?: boolean;
        readonly httpsPort?: number;
    };
};

export type DevServiceMode = {
    readonly label: string;
    readonly command: string;
    readonly cwd?: string;
    readonly port?: number;
    readonly env?: Readonly<Record<string, string>>;
};

export type DevService = {
    readonly key: string;
    readonly name: string;
    readonly command?: string;
    readonly cwd?: string;
    readonly port?: number;
    readonly healthCheck?: {
        readonly url?: string;
        readonly timeout?: number;
    };
    readonly env?: Readonly<Record<string, string>>;
    readonly depends_on?: readonly string[];
    readonly configFiles?: readonly DevConfigFile[];
    readonly expose?: DevExposeConfig;
    readonly modes?: Readonly<Record<string, DevServiceMode>>;
    readonly activeMode?: string;
};

export type DevConfig = {
    readonly version: number;
    readonly services: readonly DevService[];
};

/**
 * Get the effective command for a service, considering modes.
 * If modes exist and activeMode is set, returns that mode's command.
 * Falls back to the service-level command.
 */
export function getActiveCommand(service: DevService): string {
    if (service.modes && service.activeMode) {
        const mode = service.modes[service.activeMode];
        if (mode?.command) return mode.command;
    }
    return service.command ?? "";
}

/**
 * Get the effective cwd for a service, considering modes.
 * Mode-level cwd overrides service-level cwd.
 */
export function getActiveCwd(service: DevService): string | undefined {
    if (service.modes && service.activeMode) {
        const mode = service.modes[service.activeMode];
        if (mode?.cwd) return mode.cwd;
    }
    return service.cwd;
}

/**
 * Get the effective port for a service, considering modes.
 * Mode-level port overrides service-level port.
 */
export function getActivePort(service: DevService): number | undefined {
    if (service.modes && service.activeMode) {
        const mode = service.modes[service.activeMode];
        if (mode?.port != null) return mode.port;
    }
    return service.port;
}

/**
 * Get the effective env for a service, considering modes.
 * Mode-level env merges over service-level env.
 */
export function getActiveEnv(service: DevService): Record<string, string> | undefined {
    const baseEnv = service.env;
    if (service.modes && service.activeMode) {
        const mode = service.modes[service.activeMode];
        if (mode?.env) {
            return baseEnv ? { ...baseEnv, ...mode.env } : { ...mode.env };
        }
    }
    return baseEnv ? { ...baseEnv } : undefined;
}

/**
 * Parse dev.yml content into a structured DevConfig.
 * Returns null if parsing fails or content is invalid.
 */
export function parseDevYml(content: string): DevConfig | null {
    try {
        const doc = yaml.load(content) as Record<string, any> | null;
        if (!doc || typeof doc !== "object") return null;

        const version = typeof doc.version === "number" ? doc.version : 1;
        const rawServices = doc.services;
        if (!rawServices || typeof rawServices !== "object") return null;

        const services: DevService[] = [];

        for (const [key, raw] of Object.entries(rawServices)) {
            if (!raw || typeof raw !== "object") continue;
            const svc = buildService(key, raw as Record<string, any>);
            if (svc) services.push(svc);
        }

        if (services.length === 0) return null;
        return { version, services };
    } catch {
        return null;
    }
}

function buildService(key: string, raw: Record<string, any>): DevService | null {
    // Parse modes if present
    const modes = buildModes(raw.modes);
    const activeMode = typeof raw.activeMode === "string" ? raw.activeMode : getFirstModeKey(modes);

    // A service needs either a command or at least one mode with a command
    const command = typeof raw.command === "string" ? raw.command.trim() : undefined;
    const hasValidMode = modes != null && Object.values(modes).some((m) => m.command.length > 0);
    if (!command && !hasValidMode) return null;

    return {
        key,
        name: typeof raw.name === "string" ? raw.name : key,
        ...(command ? { command } : {}),
        ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
        ...(typeof raw.port === "number" ? { port: raw.port } : {}),
        ...(raw.healthCheck && typeof raw.healthCheck === "object" ? { healthCheck: raw.healthCheck } : {}),
        ...(raw.env && typeof raw.env === "object" ? { env: raw.env } : {}),
        ...(Array.isArray(raw.depends_on) ? { depends_on: raw.depends_on } : {}),
        ...(Array.isArray(raw.configFiles) ? { configFiles: buildConfigFiles(raw.configFiles) } : {}),
        ...(raw.expose && typeof raw.expose === "object" ? { expose: buildExpose(raw.expose) } : {}),
        ...(modes ? { modes, activeMode } : {}),
    };
}

function buildModes(raw: unknown): Record<string, DevServiceMode> | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const modes: Record<string, DevServiceMode> = {};
    let count = 0;
    for (const [modeKey, modeVal] of Object.entries(raw)) {
        if (!modeVal || typeof modeVal !== "object") continue;
        const m = modeVal as Record<string, any>;
        const command = typeof m.command === "string" ? m.command.trim() : "";
        if (command.length === 0) continue;
        modes[modeKey] = {
            label: typeof m.label === "string" ? m.label : modeKey,
            command,
            ...(typeof m.cwd === "string" ? { cwd: m.cwd } : {}),
            ...(typeof m.port === "number" ? { port: m.port } : {}),
            ...(m.env && typeof m.env === "object" ? { env: m.env } : {}),
        };
        count++;
    }
    return count > 0 ? modes : undefined;
}

function getFirstModeKey(modes: Record<string, DevServiceMode> | undefined): string | undefined {
    if (!modes) return undefined;
    const keys = Object.keys(modes);
    return keys.length > 0 ? keys[0] : undefined;
}

function buildConfigFiles(raw: any[]): DevConfigFile[] {
    return raw
        .filter((item) => item && typeof item === "object" && typeof item.path === "string")
        .map((item) => ({
            path: item.path,
            label: typeof item.label === "string" ? item.label : item.path,
        }));
}

function buildExpose(raw: Record<string, any>): DevExposeConfig {
    const expose: Record<string, any> = {};
    if (raw.caddy && typeof raw.caddy === "object" && typeof raw.caddy.hostname === "string") {
        expose.caddy = { hostname: raw.caddy.hostname };
    }
    if (raw.tailscale && typeof raw.tailscale === "object") {
        expose.tailscale = {
            ...(typeof raw.tailscale.funnel === "boolean" ? { funnel: raw.tailscale.funnel } : {}),
            ...(typeof raw.tailscale.httpsPort === "number" ? { httpsPort: raw.tailscale.httpsPort } : {}),
        };
    }
    return expose;
}

// ─── Serialization ──────────────────────────────────────────────────────────────

/** Escape a string value for YAML double-quoted context */
function yamlEscape(val: string): string {
    return val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Serialize a DevConfig back to YAML string.
 * Hand-written for consistent formatting.
 */
export function serializeDevYml(config: DevConfig): string {
    const lines: string[] = [`version: ${config.version}`, "", "services:"];

    for (const svc of config.services) {
        lines.push(`  ${svc.key}:`);
        lines.push(`    name: "${yamlEscape(svc.name)}"`);

        // Modes-based format
        if (svc.modes && Object.keys(svc.modes).length > 0) {
            if (svc.activeMode) {
                lines.push(`    activeMode: "${yamlEscape(svc.activeMode)}"`);
            }
            lines.push("    modes:");
            for (const [modeKey, mode] of Object.entries(svc.modes)) {
                lines.push(`      ${modeKey}:`);
                lines.push(`        label: "${yamlEscape(mode.label)}"`);
                lines.push(`        command: "${yamlEscape(mode.command)}"`);
                if (mode.cwd) lines.push(`        cwd: "${yamlEscape(mode.cwd)}"`);
                if (mode.port != null) lines.push(`        port: ${mode.port}`);
                if (mode.env && Object.keys(mode.env).length > 0) {
                    lines.push("        env:");
                    for (const [k, v] of Object.entries(mode.env)) {
                        lines.push(`          ${k}: "${yamlEscape(v)}"`);
                    }
                }
            }
        } else if (svc.command) {
            // Legacy flat format
            lines.push(`    command: "${yamlEscape(svc.command)}"`);
        }

        if (svc.cwd) lines.push(`    cwd: "${yamlEscape(svc.cwd)}"`);
        if (svc.port != null) lines.push(`    port: ${svc.port}`);

        if (svc.healthCheck) {
            lines.push("    healthCheck:");
            if (svc.healthCheck.url) lines.push(`      url: "${yamlEscape(svc.healthCheck.url)}"`);
            if (svc.healthCheck.timeout != null) lines.push(`      timeout: ${svc.healthCheck.timeout}`);
        }

        if (svc.env && Object.keys(svc.env).length > 0) {
            lines.push("    env:");
            for (const [k, v] of Object.entries(svc.env)) {
                lines.push(`      ${k}: "${yamlEscape(v)}"`);
            }
        }

        lines.push(`    depends_on: [${(svc.depends_on ?? []).map((d) => `"${d}"`).join(", ")}]`);

        if (svc.configFiles && svc.configFiles.length > 0) {
            lines.push("    configFiles:");
            for (const cf of svc.configFiles) {
                lines.push(`      - path: "${yamlEscape(cf.path)}"`);
                lines.push(`        label: "${yamlEscape(cf.label)}"`);
            }
        }

        if (svc.expose) {
            lines.push("    expose:");
            if (svc.expose.caddy) {
                lines.push("      caddy:");
                lines.push(`        hostname: "${yamlEscape(svc.expose.caddy.hostname)}"`);
            }
            if (svc.expose.tailscale) {
                lines.push("      tailscale:");
                if (svc.expose.tailscale.funnel != null) lines.push(`        funnel: ${svc.expose.tailscale.funnel}`);
                if (svc.expose.tailscale.httpsPort != null) lines.push(`        httpsPort: ${svc.expose.tailscale.httpsPort}`);
            }
        }

        lines.push("");
    }

    return lines.join("\n");
}
