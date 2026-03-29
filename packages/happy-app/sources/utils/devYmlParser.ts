/**
 * Lightweight parser for .happy/dev.yml files.
 *
 * Only supports the subset of YAML needed by dev.yml:
 * - Top-level keys (version, services)
 * - Nested object properties (string, number, boolean)
 * - Simple arrays (depends_on, configFiles)
 * - No anchors, aliases, multiline strings, or flow syntax
 *
 * If the format gets more complex, replace with js-yaml.
 */

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

export type DevService = {
    readonly key: string;
    readonly name: string;
    readonly command: string;
    readonly cwd?: string;
    readonly port?: number;
    readonly healthCheck?: {
        readonly url?: string;
        readonly timeout?: number;
    };
    readonly env?: Record<string, string>;
    readonly depends_on?: readonly string[];
    readonly configFiles?: readonly DevConfigFile[];
    readonly expose?: DevExposeConfig;
};

export type DevConfig = {
    readonly version: number;
    readonly services: readonly DevService[];
};

/**
 * Parse dev.yml content into a structured DevConfig.
 * Returns null if parsing fails or content is invalid.
 */
export function parseDevYml(content: string): DevConfig | null {
    try {
        // Use a simple line-by-line parser for the YAML subset
        const lines = content.split("\n");
        let version = 1;
        const services: DevService[] = [];

        let currentServiceKey: string | null = null;
        let currentService: Record<string, any> = {};
        let currentSection: string | null = null; // healthCheck, env, expose, configFiles, etc.
        let currentSubSection: string | null = null; // caddy, tailscale
        let configFileItem: Record<string, string> | null = null;

        for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, "");

            // Skip empty lines and comments
            if (line.trim() === "" || line.trim().startsWith("#")) continue;

            const indent = line.length - line.trimStart().length;
            const trimmed = line.trim();

            // version: N
            if (indent === 0 && trimmed.startsWith("version:")) {
                version = parseInt(trimmed.split(":")[1].trim(), 10) || 1;
                continue;
            }

            // services: (top-level section header)
            if (indent === 0 && trimmed === "services:") continue;

            // Service key (indent 2)
            if (indent === 2 && trimmed.endsWith(":") && !trimmed.includes(" ")) {
                // Save previous service
                if (currentServiceKey) {
                    // Flush pending configFile item
                    if (configFileItem && configFileItem.path) {
                        currentService.configFiles = currentService.configFiles ?? [];
                        currentService.configFiles.push({ ...configFileItem });
                    }
                    const svc = buildService(currentServiceKey, currentService);
                    if (svc) services.push(svc);
                }
                currentServiceKey = trimmed.slice(0, -1);
                currentService = {};
                currentSection = null;
                currentSubSection = null;
                configFileItem = null;
                continue;
            }

            // Service properties (indent 4)
            if (indent === 4 && currentServiceKey) {
                // Section headers
                if (trimmed === "healthCheck:" || trimmed === "env:" || trimmed === "expose:" || trimmed === "configFiles:") {
                    currentSection = trimmed.slice(0, -1);
                    currentSubSection = null;
                    if (currentSection === "configFiles") {
                        currentService.configFiles = currentService.configFiles ?? [];
                    }
                    if (currentSection === "env") {
                        currentService.env = currentService.env ?? {};
                    }
                    if (currentSection === "healthCheck") {
                        currentService.healthCheck = currentService.healthCheck ?? {};
                    }
                    if (currentSection === "expose") {
                        currentService.expose = currentService.expose ?? {};
                    }
                    continue;
                }

                // depends_on: [] or depends_on:
                if (trimmed.startsWith("depends_on:")) {
                    const val = trimmed.split(":").slice(1).join(":").trim();
                    if (val === "[]" || val === "") {
                        currentService.depends_on = [];
                    } else {
                        // Inline array: ["a", "b"]
                        currentService.depends_on = parseInlineArray(val);
                    }
                    currentSection = trimmed.endsWith(":") && !val ? "depends_on" : null;
                    continue;
                }

                // Simple key: value
                currentSection = null;
                const colonIdx = trimmed.indexOf(":");
                if (colonIdx > 0) {
                    const key = trimmed.slice(0, colonIdx).trim();
                    const val = trimmed.slice(colonIdx + 1).trim();
                    currentService[key] = parseYamlValue(val);
                }
                continue;
            }

            // Section content (indent 6)
            if (indent === 6 && currentServiceKey && currentSection) {
                if (currentSection === "healthCheck") {
                    const colonIdx = trimmed.indexOf(":");
                    if (colonIdx > 0) {
                        const key = trimmed.slice(0, colonIdx).trim();
                        const val = trimmed.slice(colonIdx + 1).trim();
                        currentService.healthCheck = currentService.healthCheck ?? {};
                        currentService.healthCheck[key] = parseYamlValue(val);
                    }
                } else if (currentSection === "env") {
                    const colonIdx = trimmed.indexOf(":");
                    if (colonIdx > 0) {
                        const key = trimmed.slice(0, colonIdx).trim();
                        const val = trimmed.slice(colonIdx + 1).trim();
                        currentService.env = currentService.env ?? {};
                        currentService.env[key] = stripQuotes(val);
                    }
                } else if (currentSection === "expose") {
                    // Subsection headers: caddy:, tailscale:
                    if (trimmed.endsWith(":") && !trimmed.includes(" ")) {
                        currentSubSection = trimmed.slice(0, -1);
                        currentService.expose = currentService.expose ?? {};
                        currentService.expose[currentSubSection] = currentService.expose[currentSubSection] ?? {};
                        continue;
                    }
                } else if (currentSection === "configFiles") {
                    // Array item: - path: "..."
                    if (trimmed.startsWith("- ")) {
                        // Save previous item
                        if (configFileItem && configFileItem.path) {
                            currentService.configFiles.push({ ...configFileItem });
                        }
                        configFileItem = {};
                        const rest = trimmed.slice(2);
                        const colonIdx = rest.indexOf(":");
                        if (colonIdx > 0) {
                            const key = rest.slice(0, colonIdx).trim();
                            const val = rest.slice(colonIdx + 1).trim();
                            configFileItem[key] = stripQuotes(val);
                        }
                        continue;
                    }
                    // Continuation of current item
                    if (configFileItem) {
                        const colonIdx = trimmed.indexOf(":");
                        if (colonIdx > 0) {
                            const key = trimmed.slice(0, colonIdx).trim();
                            const val = trimmed.slice(colonIdx + 1).trim();
                            configFileItem[key] = stripQuotes(val);
                        }
                    }
                } else if (currentSection === "depends_on") {
                    if (trimmed.startsWith("- ")) {
                        currentService.depends_on = currentService.depends_on ?? [];
                        currentService.depends_on.push(stripQuotes(trimmed.slice(2).trim()));
                    }
                }
                continue;
            }

            // Expose subsection content (indent 8)
            if (indent === 8 && currentSection === "expose" && currentSubSection) {
                const colonIdx = trimmed.indexOf(":");
                if (colonIdx > 0) {
                    const key = trimmed.slice(0, colonIdx).trim();
                    const val = trimmed.slice(colonIdx + 1).trim();
                    currentService.expose = currentService.expose ?? {};
                    currentService.expose[currentSubSection] = currentService.expose[currentSubSection] ?? {};
                    currentService.expose[currentSubSection][key] = parseYamlValue(val);
                }
                continue;
            }

            // configFiles item continuation (indent 8)
            if (indent === 8 && currentSection === "configFiles" && configFileItem) {
                const colonIdx = trimmed.indexOf(":");
                if (colonIdx > 0) {
                    const key = trimmed.slice(0, colonIdx).trim();
                    const val = trimmed.slice(colonIdx + 1).trim();
                    configFileItem[key] = stripQuotes(val);
                }
                continue;
            }
        }

        // Save last service
        if (currentServiceKey) {
            // Flush last configFile item
            if (configFileItem && configFileItem.path) {
                currentService.configFiles = currentService.configFiles ?? [];
                currentService.configFiles.push({ ...configFileItem });
            }
            const svc = buildService(currentServiceKey, currentService);
            if (svc) services.push(svc);
        }

        if (services.length === 0) return null;

        return { version, services };
    } catch {
        return null;
    }
}

function buildService(key: string, raw: Record<string, any>): DevService | null {
    const command = typeof raw.command === "string" ? raw.command.trim() : "";
    if (command.length === 0) return null; // Skip services without a command

    return {
        key,
        name: typeof raw.name === "string" ? raw.name : key,
        command,
        cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
        port: typeof raw.port === "number" ? raw.port : undefined,
        healthCheck: raw.healthCheck ?? undefined,
        env: raw.env ?? undefined,
        depends_on: Array.isArray(raw.depends_on) ? raw.depends_on : undefined,
        configFiles: Array.isArray(raw.configFiles) ? raw.configFiles : undefined,
        expose: raw.expose ?? undefined,
    };
}

function stripQuotes(val: string): string {
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        return val.slice(1, -1);
    }
    return val;
}

function parseYamlValue(val: string): string | number | boolean {
    const stripped = stripQuotes(val);
    if (stripped === "true") return true;
    if (stripped === "false") return false;
    const num = Number(stripped);
    if (!isNaN(num) && stripped.length > 0 && stripped !== "") return num;
    return stripped;
}

function parseInlineArray(val: string): string[] {
    // Parse ["a", "b"] or [a, b]
    const inner = val.replace(/^\[/, "").replace(/\]$/, "").trim();
    if (inner === "") return [];
    return inner.split(",").map((s) => stripQuotes(s.trim()));
}

/** Escape a string value for YAML double-quoted context */
function yamlEscape(val: string): string {
    return val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Serialize a DevConfig back to YAML string.
 */
export function serializeDevYml(config: DevConfig): string {
    const lines: string[] = [`version: ${config.version}`, "", "services:"];

    for (const svc of config.services) {
        lines.push(`  ${svc.key}:`);
        lines.push(`    name: "${yamlEscape(svc.name)}"`);
        lines.push(`    command: "${yamlEscape(svc.command)}"`);
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
