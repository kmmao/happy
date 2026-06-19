import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Drift guard for the intentionally-duplicated RPC lifecycle.
 *
 * `RpcHandlerManager` (the socket.io lifecycle: retry policy, fast-retry timer,
 * periodic re-register) is copied byte-for-byte — modulo import paths and the
 * doc comment naming the sibling — into both `@kmmao/happy-coder` and
 * `@kmmao/happy-agent`. The packages cannot import each other, and the lifecycle
 * touches real timers + a live Socket so it deliberately does NOT live in the
 * pure-types `@kmmao/happy-wire` (see each file's header + ADR-0035). The
 * standing decision is "keep the two copies identical until they drift; only
 * then extract a shared `@kmmao/happy-rpc-runtime`."
 *
 * Until now "keep them identical" relied on reviewer memory. This test makes the
 * drift trigger self-detecting: edit one copy without the other and it fails,
 * pointing at the exact file pair to reconcile (or to extract). It compares
 * source modulo comments, imports, and whitespace, so import-path differences
 * are expected and ignored.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cliRpcDir = here;
const agentRpcDir = join(here, "../../../../happy-agent/src/api/rpc");

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

const PAIRS = ["RpcHandlerManager.ts", "types.ts"];

describe("RPC lifecycle parity (CLI ↔ Agent)", () => {
    for (const file of PAIRS) {
        it(`${file} is logically identical in both packages (modulo imports/comments)`, () => {
            const cli = normalize(readFileSync(join(cliRpcDir, file), "utf8"));
            const agent = normalize(readFileSync(join(agentRpcDir, file), "utf8"));
            expect(cli.length).toBeGreaterThan(0);
            // If this fails, the two copies drifted. Either re-sync them, or —
            // if the divergence is intentional — this is the documented signal
            // to extract a shared @kmmao/happy-rpc-runtime (ADR-0035).
            expect(agent).toBe(cli);
        });
    }
});
