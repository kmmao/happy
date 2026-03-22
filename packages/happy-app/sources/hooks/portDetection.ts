/**
 * Multi-strategy port detection for dev server preview.
 *
 * Detection chain: lsof → ss → netstat (fallback)
 * Supplementary: package.json scripts parsing, Docker container ports, curl probing
 * Results are merged, deduplicated, and sorted (common dev ports first).
 */

import { sessionBash } from "@/sync/ops";

/** Common dev server ports to highlight in detection results. */
export const COMMON_DEV_PORTS = [
    3000, 3001, 4173, 5173, 5174, 8000, 8080, 8081, 8888, 9000, 9123,
];

export interface DetectedPort {
    readonly port: number;
    readonly process: string;
    readonly isCommonDevPort: boolean;
    readonly isWeb: boolean;
}

// ---------------------------------------------------------------------------
// Parsers — pure functions, each handles one command's stdout
// ---------------------------------------------------------------------------

/**
 * Parse `lsof -iTCP -sTCP:LISTEN -P -n` output.
 * Returns port → command map AND port → PID map for later enrichment.
 *
 * Example line:
 *   node    1234 user   23u  IPv4 0x1234  0t0  TCP *:3000 (LISTEN)
 */
export function parseLsofOutput(stdout: string): {
    readonly ports: ReadonlyMap<number, string>;
    readonly pids: ReadonlyMap<number, number>;
} {
    const ports = new Map<number, string>();
    const pids = new Map<number, number>();
    for (const line of stdout.trim().split("\n")) {
        if (line.startsWith("COMMAND")) continue;
        const parts = line.split(/\s+/);
        if (parts.length < 9) continue;
        const command = parts[0];
        const pid = parseInt(parts[1], 10);
        // NAME column is "address:port (LISTEN)" — port is in second-to-last token
        const addressToken = parts[parts.length - 2];
        const m = addressToken.match(/:(\d+)$/);
        if (m) {
            const port = parseInt(m[1], 10);
            if (port > 0 && port < 65536 && !ports.has(port)) {
                ports.set(port, command);
                if (!isNaN(pid)) pids.set(port, pid);
            }
        }
    }
    return { ports, pids };
}

/**
 * Extract a human-readable label from a full process command line.
 *
 * Turns: "/usr/bin/node /app/node_modules/.bin/next dev -p 3005"
 * Into:  "next dev"
 *
 * Turns: "python3 -m http.server 8000"
 * Into:  "python http.server"
 */
/** Generic entry point filenames — use parent directory name instead. */
const GENERIC_ENTRY_FILES = new Set([
    "index", "main", "app", "server", "start", "dev", "cli", "bin", "entry",
]);

export function extractProcessLabel(cmdline: string): string {
    const trimmed = cmdline.trim();

    // Known CLI tool in node_modules/.bin/ (next, vite, webpack, tsx, etc.)
    const binMatch = trimmed.match(/node_modules\/\.bin\/(\S+)/);
    if (binMatch) {
        const tool = binMatch[1];
        const afterTool = trimmed.substring(trimmed.indexOf(tool) + tool.length).trim();
        const firstArg = afterTool.split(/\s+/)[0];
        if (firstArg && !firstArg.startsWith("-")) {
            return `${tool} ${firstArg}`;
        }
        return tool;
    }

    // Python module: python3 -m http.server → "python http.server"
    const pyMatch = trimmed.match(/python\d?\s+-m\s+(\S+)/);
    if (pyMatch) return `python ${pyMatch[1]}`;

    // Generic runtime wrapper (node, python, ruby, etc.)
    const tokens = trimmed.split(/\s+/);
    const basename = tokens[0].split("/").pop() ?? tokens[0];
    const isWrapper = /^(node|python\d?|ruby|java|deno|bun)$/.test(basename);

    if (isWrapper && tokens.length > 1) {
        for (let i = 1; i < Math.min(tokens.length, 5); i++) {
            const t = tokens[i];
            if (t.startsWith("-")) continue;

            // Extract meaningful name from the script path
            const parts = t.split("/");
            const fileBase = (parts.pop() ?? t).replace(/\.(js|ts|mjs|cjs|jsx|tsx)$/, "");

            if (GENERIC_ENTRY_FILES.has(fileBase)) {
                // "node /app/my-api/index.js" → use parent dir "my-api"
                const parent = parts.pop();
                if (parent && parent !== "." && parent !== "src" && parent !== "dist" && parent !== "build") {
                    return parent;
                }
                // Try grandparent: node ./src/index.js → parent of src
                const grandparent = parts.pop();
                if (grandparent && grandparent !== ".") {
                    return grandparent;
                }
            }

            // Non-generic filename: "node server.js" → "server"
            return fileBase;
        }
    }

    return basename;
}

/**
 * Parse `ps` output to build PID → command label map.
 * Input format: one line per process, "PID FULL_COMMAND_LINE"
 */
export function parsePsOutput(stdout: string): ReadonlyMap<number, string> {
    const result = new Map<number, string>();
    for (const line of stdout.trim().split("\n")) {
        const m = line.trim().match(/^(\d+)\s+(.+)/);
        if (!m) continue;
        const pid = parseInt(m[1], 10);
        const label = extractProcessLabel(m[2]);
        result.set(pid, label);
    }
    return result;
}

/**
 * Parse `ss -tlnp` output (Linux only).
 *
 * Example line:
 *   LISTEN 0  511  *:3000  *:*  users:(("node",pid=1234,fd=23))
 */
export function parseSsOutput(stdout: string): ReadonlyMap<number, string> {
    const ports = new Map<number, string>();
    for (const line of stdout.trim().split("\n")) {
        if (!line.startsWith("LISTEN")) continue;
        const fields = line.trim().split(/\s+/);
        // ss output: State Recv-Q Send-Q LocalAddr:Port PeerAddr:Port [Process]
        // LocalAddr is field[3]
        const localAddr = fields.length >= 4 ? fields[3] : "";
        const portMatch = localAddr.match(/:(\d+)$/);
        if (!portMatch) continue;
        const port = parseInt(portMatch[1], 10);
        if (port <= 0 || port >= 65536 || ports.has(port)) continue;
        // Extract process name from users:(("name",...))
        const procMatch = line.match(/users:\(\("([^"]+)"/);
        ports.set(port, procMatch ? procMatch[1] : "unknown");
    }
    return ports;
}

/**
 * Parse `netstat` output — handles both Linux and macOS formats.
 *
 * Linux `netstat -tlnp`:
 *   tcp  0  0  0.0.0.0:3000  0.0.0.0:*  LISTEN  1234/node
 *
 * macOS `netstat -an -p tcp`:
 *   tcp4  0  0  *.3000  *.*  LISTEN
 */
export function parseNetstatOutput(stdout: string): ReadonlyMap<number, string> {
    const ports = new Map<number, string>();
    for (const line of stdout.trim().split("\n")) {
        if (!line.includes("LISTEN")) continue;
        // Try Linux format: PID/program at end
        const linuxMatch = line.match(/[:\.](\d+)\s+[\d.:*]+\s+LISTEN\s+(\d+\/(\S+))?/);
        if (linuxMatch) {
            const port = parseInt(linuxMatch[1], 10);
            if (port > 0 && port < 65536 && !ports.has(port)) {
                ports.set(port, linuxMatch[3] ?? "unknown");
            }
            continue;
        }
        // Try macOS format: *.PORT or 127.0.0.1.PORT — match local address (4th column)
        const columns = line.trim().split(/\s+/);
        const localAddr = columns.length >= 4 ? columns[3] : "";
        const macMatch = localAddr.match(/[.*]\.(\d+)$/);
        if (macMatch) {
            const port = parseInt(macMatch[1], 10);
            if (port > 0 && port < 65536 && !ports.has(port)) {
                ports.set(port, "unknown");
            }
        }
    }
    return ports;
}

/**
 * Parse `docker ps --format` output for exposed ports.
 *
 * Format: "0.0.0.0:8080->80/tcp, :::3000->3000/tcp  container-name"
 * We extract the host port (left side of ->).
 */
export function parseDockerOutput(stdout: string): ReadonlyMap<number, string> {
    const ports = new Map<number, string>();
    for (const line of stdout.trim().split("\n")) {
        if (!line.trim()) continue;
        // Format: "PORTS\tNAME" — tab separated
        const tabIdx = line.indexOf("\t");
        const portsPart = tabIdx >= 0 ? line.substring(0, tabIdx) : line;
        const namePart = tabIdx >= 0 ? line.substring(tabIdx + 1).trim() : "docker";
        // Match host port mappings: 0.0.0.0:8080->80/tcp
        const portMatches = portsPart.matchAll(/(?:\d+\.\d+\.\d+\.\d+|::):(\d+)->/g);
        for (const m of portMatches) {
            const port = parseInt(m[1], 10);
            if (port > 0 && port < 65536 && !ports.has(port)) {
                ports.set(port, `docker:${namePart}`);
            }
        }
    }
    return ports;
}

/**
 * Extract port numbers from package.json scripts.
 *
 * Matches: --port 3000, --port=3000, -p 8080, -p=8080, PORT=3000
 */
export function parsePackageJsonPorts(json: string): readonly number[] {
    try {
        const pkg = JSON.parse(json);
        const scripts: Record<string, string> = pkg.scripts ?? {};
        const ports = new Set<number>();
        for (const cmd of Object.values(scripts)) {
            if (typeof cmd !== "string") continue;
            // --port 3000 or --port=3000
            for (const m of cmd.matchAll(/--port[=\s]+(\d+)/g)) {
                ports.add(parseInt(m[1], 10));
            }
            // -p 3000 or -p=3000 (but not -pr, -prod etc.)
            for (const m of cmd.matchAll(/\s-p[=\s]+(\d+)/g)) {
                ports.add(parseInt(m[1], 10));
            }
            // PORT=3000
            for (const m of cmd.matchAll(/\bPORT=(\d+)/g)) {
                ports.add(parseInt(m[1], 10));
            }
        }
        return Array.from(ports).filter((p) => p > 0 && p < 65536);
    } catch {
        return [];
    }
}

/**
 * Parse curl probe output to find responsive ports.
 *
 * Command output format: one line per port — "PORT:HEADER_LINE" or "PORT:ok"
 * We also extract framework info from response headers.
 */
export function parseCurlProbeOutput(stdout: string): ReadonlyMap<number, string> {
    const ports = new Map<number, string>();
    for (const line of stdout.trim().split("\n")) {
        const m = line.match(/^(\d+):(.+)/);
        if (!m) continue;
        const port = parseInt(m[1], 10);
        if (ports.has(port)) continue;
        const headerLine = m[2].trim();
        // Try to extract framework from common response headers
        const powered = headerLine.match(/x-powered-by:\s*(.+)/i);
        const server = headerLine.match(/^server:\s*(.+)/i);
        const framework = powered?.[1] ?? server?.[1] ?? "http";
        ports.set(port, framework);
    }
    return ports;
}

// ---------------------------------------------------------------------------
// Orchestrator — runs strategies and merges results
// ---------------------------------------------------------------------------

type BashFn = (
    sessionId: string,
    request: { command: string; timeout?: number },
) => Promise<{ success: boolean; stdout?: string; exitCode?: number }>;

export type DetectionPhase =
    | "scanning-ports"
    | "fallback-detection"
    | "checking-docker"
    | "probing-http"
    | "done";

/**
 * Run the full detection pipeline and return merged, deduplicated ports.
 * Each strategy is isolated — failure in one does not block others.
 * Calls onProgress at each phase transition for UI feedback.
 */
export async function detectAllPorts(
    sessionId: string,
    bash: BashFn = sessionBash,
    onProgress?: (phase: DetectionPhase, portsFound: number) => void,
): Promise<readonly DetectedPort[]> {
    const report = (phase: DetectionPhase, count: number) => onProgress?.(phase, count);

    // Phase 1: run lsof + package.json + docker in parallel
    report("scanning-ports", 0);
    const [lsofResult, pkgResult, dockerResult] = await Promise.all([
        bash(sessionId, {
            command: "lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null",
            timeout: 10000,
        }).catch(() => null),
        bash(sessionId, {
            command: "cat package.json 2>/dev/null",
            timeout: 5000,
        }).catch(() => null),
        bash(sessionId, {
            command: 'docker ps --format "{{.Ports}}\t{{.Names}}" 2>/dev/null',
            timeout: 5000,
        }).catch(() => null),
    ]);

    // Collect ports from all sources
    const portMap = new Map<number, string>();
    // PID map for enriching process names via `ps`
    const pidMap = new Map<number, number>();

    const mergeInto = (source: ReadonlyMap<number, string>) => {
        for (const [port, process] of source) {
            if (!portMap.has(port)) {
                portMap.set(port, process);
            }
        }
    };

    // Try lsof first
    let lsofWorked = false;
    if (lsofResult?.success && lsofResult.exitCode === 0 && lsofResult.stdout) {
        const parsed = parseLsofOutput(lsofResult.stdout);
        if (parsed.ports.size > 0) {
            mergeInto(parsed.ports);
            for (const [port, pid] of parsed.pids) {
                pidMap.set(port, pid);
            }
            lsofWorked = true;
        }
    }

    report("scanning-ports", portMap.size);

    // Phase 2: if lsof found nothing, try ss then netstat as fallback
    if (!lsofWorked) {
        report("fallback-detection", portMap.size);
        // Try ss (Linux only)
        const ssResult = await bash(sessionId, {
            command: "ss -tlnp 2>/dev/null",
            timeout: 5000,
        }).catch(() => null);

        if (ssResult?.success && ssResult.exitCode === 0 && ssResult.stdout) {
            const parsed = parseSsOutput(ssResult.stdout);
            if (parsed.size > 0) {
                mergeInto(parsed);
            } else {
                // Try netstat as last resort
                const netstatResult = await bash(sessionId, {
                    command: "netstat -tlnp 2>/dev/null || netstat -an -p tcp 2>/dev/null",
                    timeout: 5000,
                }).catch(() => null);

                if (netstatResult?.success && netstatResult.exitCode === 0 && netstatResult.stdout) {
                    mergeInto(parseNetstatOutput(netstatResult.stdout));
                }
            }
        }
    }

    // Merge Docker ports
    report("checking-docker", portMap.size);
    if (dockerResult?.success && dockerResult.exitCode === 0 && dockerResult.stdout) {
        mergeInto(parseDockerOutput(dockerResult.stdout));
    }

    // Enrich generic process names (e.g., "node") with full command line via ps.
    // Only query PIDs whose current label is generic.
    const genericNames = new Set(["node", "python", "python3", "ruby", "java", "deno", "bun", "unknown"]);
    const pidsToQuery = Array.from(pidMap.entries())
        .filter(([port]) => genericNames.has(portMap.get(port) ?? ""))
        .map(([, pid]) => pid);

    if (pidsToQuery.length > 0) {
        const pidList = [...new Set(pidsToQuery)].join(",");
        const psResult = await bash(sessionId, {
            command: `ps -p ${pidList} -o pid=,args= 2>/dev/null`,
            timeout: 5000,
        }).catch(() => null);

        if (psResult?.success && psResult.stdout) {
            const labels = parsePsOutput(psResult.stdout);
            // Map labels back to ports via pidMap
            for (const [port, pid] of pidMap) {
                const label = labels.get(pid);
                if (label && genericNames.has(portMap.get(port) ?? "")) {
                    portMap.set(port, label);
                }
            }
        }
    }

    // Merge package.json ports into portMap (if not already present, mark for probe)
    const pkgPorts = pkgResult?.success && pkgResult.stdout
        ? parsePackageJsonPorts(pkgResult.stdout)
        : [];

    for (const p of pkgPorts) {
        if (!portMap.has(p)) portMap.set(p, "package.json");
    }
    // Also add common dev ports not yet in portMap for probing
    for (const p of COMMON_DEV_PORTS) {
        if (!portMap.has(p)) portMap.set(p, "probe-candidate");
    }

    // Phase 3: parallel curl probe ALL ports to determine which respond to HTTP.
    report("probing-http", portMap.size);
    // Uses bash background jobs for true parallelism — finishes in ~0.5s regardless of port count.
    const allPorts = Array.from(portMap.keys())
        .filter((p) => Number.isInteger(p) && p > 0 && p < 65536);

    const webPorts = new Set<number>();
    const webFrameworks = new Map<number, string>();

    if (allPorts.length > 0) {
        const portList = allPorts.join(" ");
        // Strict HTTP check: only emit port if first response line starts with "HTTP/".
        // This filters out non-HTTP services that accept TCP connections but don't speak HTTP.
        // Output format: "PORT:header1\nPORT:header2\n..." (only for confirmed HTTP ports)
        const probeResult = await bash(sessionId, {
            command: `for p in ${portList}; do (resp=$(curl -sI --connect-timeout 0.3 --max-time 1 http://localhost:$p 2>/dev/null | head -5) && echo "$resp" | head -1 | grep -q "^HTTP/" && echo "$resp" | while read -r line; do echo "$p:$line"; done) & done; wait`,
            timeout: 20000,
        }).catch(() => null);

        if (probeResult?.success && probeResult.stdout) {
            for (const line of probeResult.stdout.trim().split("\n")) {
                const m = line.match(/^(\d+):(.+)/);
                if (!m) continue;
                const port = parseInt(m[1], 10);
                const header = m[2].trim();
                // All lines here are from confirmed HTTP responses
                webPorts.add(port);
                // Extract framework info from headers
                const powered = header.match(/x-powered-by:\s*(.+)/i);
                const server = header.match(/^server:\s*(.+)/i);
                if (powered && !webFrameworks.has(port)) {
                    webFrameworks.set(port, powered[1].trim());
                } else if (server && !webFrameworks.has(port)) {
                    webFrameworks.set(port, server[1].trim());
                }
            }
        }
    }

    // Remove probe-candidates that didn't respond to HTTP
    for (const [port, process] of portMap) {
        if (process === "probe-candidate" && !webPorts.has(port)) {
            portMap.delete(port);
        }
    }

    // Enrich process name with framework info from curl headers
    for (const [port, framework] of webFrameworks) {
        const current = portMap.get(port);
        if (current && (current === "unknown" || current === "package.json" || current === "probe-candidate" || current === "http")) {
            portMap.set(port, framework);
        }
    }

    // Build sorted result: web first, then common dev ports, then by port number
    report("done", webPorts.size);
    return Array.from(portMap.entries())
        .map(([port, process]) => ({
            port,
            process,
            isCommonDevPort: COMMON_DEV_PORTS.includes(port),
            isWeb: webPorts.has(port),
        }))
        .sort((a, b) => {
            // Web ports first
            if (a.isWeb !== b.isWeb) return a.isWeb ? -1 : 1;
            // Then common dev ports
            if (a.isCommonDevPort !== b.isCommonDevPort) return a.isCommonDevPort ? -1 : 1;
            // Then by port number
            return a.port - b.port;
        });
}
