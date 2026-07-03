/**
 * Shared OAuth flow helpers for the `happy connect <vendor>` commands.
 *
 * PKCE generation and the loopback-callback port discovery are byte-identical
 * across the Codex, Gemini, and Claude authenticate flows (only the vendor
 * `generateState` format and the endpoint/exchange details differ, so those stay
 * per-vendor). Concentrating these three pure/local helpers here removes the
 * three-way copy and gives the crypto + port logic a single test surface.
 */

import { createServer } from "http";
import { randomBytes, createHash } from "crypto";
import { PKCECodes } from "./types";

/**
 * Generate PKCE codes for the OAuth authorization-code flow: a base64url code
 * verifier and its SHA-256 challenge (base64url, padding/·+·/·stripped).
 */
export function generatePKCE(): PKCECodes {
    // Generate code verifier (43-128 characters, base64url)
    const verifier = randomBytes(32)
        .toString("base64url")
        .replace(/[^a-zA-Z0-9\-._~]/g, "");

    // Generate code challenge (SHA256 of verifier, base64url encoded)
    const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

    return { verifier, challenge };
}

/** Find an available loopback port for the OAuth callback server. */
export async function findAvailablePort(): Promise<number> {
    return new Promise((resolve) => {
        const server = createServer();
        server.listen(0, "127.0.0.1", () => {
            const port = (server.address() as any).port;
            server.close(() => resolve(port));
        });
    });
}

/** Check whether a specific loopback port is available to bind. */
export async function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const testServer = createServer();
        testServer.once("error", () => {
            testServer.close();
            resolve(false);
        });
        testServer.listen(port, "127.0.0.1", () => {
            testServer.close(() => resolve(true));
        });
    });
}
