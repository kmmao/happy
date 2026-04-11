import { PrismaClient } from "@prisma/client";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import * as fs from "fs";
import * as path from "path";

let pgliteInstance: PGlite | null = null;

type WasmModule = object;
type WebAssemblyModuleCtor = new (bytes: Buffer) => WasmModule;

function getWebAssemblyModuleCtor(): WebAssemblyModuleCtor | null {
    const moduleCtor = (globalThis as { WebAssembly?: { Module?: unknown } }).WebAssembly?.Module;
    return typeof moduleCtor === "function"
        ? (moduleCtor as WebAssemblyModuleCtor)
        : null;
}

function findPGliteWasm(): { wasmModule: WasmModule; fsBundle: Blob } | null {
    const wasmModuleCtor = getWebAssemblyModuleCtor();
    if (!wasmModuleCtor) {
        return null;
    }
    const searchPaths = [
        process.cwd(),
        path.dirname(process.execPath),
    ];
    for (const dir of searchPaths) {
        const wasmPath = path.join(dir, "pglite.wasm");
        const dataPath = path.join(dir, "pglite.data");
        if (fs.existsSync(wasmPath) && fs.existsSync(dataPath)) {
            const wasmModule = new wasmModuleCtor(fs.readFileSync(wasmPath));
            const fsBundle = new Blob([fs.readFileSync(dataPath)]);
            return { wasmModule, fsBundle };
        }
    }
    return null;
}

function createClient(): PrismaClient {
    const pgliteDir = process.env.PGLITE_DIR;
    if (pgliteDir) {
        const wasmOpts = findPGliteWasm();
        if (wasmOpts) {
            pgliteInstance = new PGlite({ dataDir: pgliteDir, ...(wasmOpts as any) });
        } else {
            pgliteInstance = new PGlite(pgliteDir);
        }
        const adapter = new PrismaPGlite(pgliteInstance);
        return new PrismaClient({ adapter } as any);
    }
    return new PrismaClient();
}

export const db = createClient();

export function getPGlite(): PGlite | null {
    return pgliteInstance;
}
