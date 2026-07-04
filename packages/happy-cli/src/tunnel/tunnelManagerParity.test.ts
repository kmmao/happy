import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Drift guard for the intentionally-duplicated TunnelManager (ADR-0063).
 *
 * `TunnelManager` (aggregate-all-providers, parallel detect, periodic refresh
 * with JSON-diff change detection, and lease renewal discovered structurally off
 * the `TunnelProvider` interface per ADR-0045) is copied — modulo import paths,
 * doc comments, and formatting — into both `@kmmao/happy-coder` and
 * `@kmmao/happy-agent`. The packages cannot import each other, and the class
 * owns real timers, so it deliberately does NOT live in the pure-types
 * `@kmmao/happy-wire`. The standing decision mirrors ADR-0035's RpcHandlerManager
 * ruling: keep the two copies identical until they drift; only then extract a
 * shared `@kmmao/happy-tunnel-runtime`.
 *
 * This test makes the drift trigger self-detecting instead of relying on
 * reviewer memory: edit one copy without the other and it fails, naming the file
 * pair to reconcile (or to extract). It compares source modulo comments,
 * imports, and whitespace, so import-path and formatting differences are ignored.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cliTunnelDir = here;
const agentTunnelDir = join(here, "../../../happy-agent/src/tunnel");

/** Strip comments, import statements, and whitespace so only logic remains. */
function normalize(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, "") // block comments (incl. JSDoc)
        .replace(/\/\/[^\n]*/g, "") // line comments
        .replace(/import[\s\S]*?from\s*["'][^"']*["'];/g, "") // multi/single-line imports
        .replace(/import\s*["'][^"']*["'];/g, "") // bare side-effect imports
        .replace(/\s+/g, " ")
        .trim();
}

describe("TunnelManager parity (CLI ↔ Agent)", () => {
    it("tunnelManager.ts is logically identical in both packages (modulo imports/comments)", () => {
        const cli = normalize(readFileSync(join(cliTunnelDir, "tunnelManager.ts"), "utf8"));
        const agent = normalize(readFileSync(join(agentTunnelDir, "tunnelManager.ts"), "utf8"));
        expect(cli.length).toBeGreaterThan(0);
        // If this fails, the two copies drifted. Either re-sync them, or — if the
        // divergence is intentional — this is the documented signal to extract a
        // shared @kmmao/happy-tunnel-runtime (ADR-0063).
        expect(agent).toBe(cli);
    });
});
