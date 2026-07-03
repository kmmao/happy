import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { generatePKCE, findAvailablePort, isPortAvailable } from "./oauthUtils";

describe("generatePKCE", () => {
  it("produces a base64url-safe verifier and a matching SHA-256 challenge", () => {
    const { verifier, challenge } = generatePKCE();

    // Verifier only contains RFC 7636 unreserved chars.
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);

    // Challenge = base64url(SHA256(verifier)) with padding/+// normalized.
    const expected = createHash("sha256")
      .update(verifier)
      .digest("base64url")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(challenge).toBe(expected);
    expect(challenge).not.toContain("=");
  });

  it("is random across calls", () => {
    expect(generatePKCE().verifier).not.toBe(generatePKCE().verifier);
  });
});

describe("findAvailablePort", () => {
  it("returns a bindable ephemeral port", async () => {
    const port = await findAvailablePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
    // The port it handed back should itself be free.
    expect(await isPortAvailable(port)).toBe(true);
  });
});

describe("isPortAvailable", () => {
  it("reports false for a port currently in use", async () => {
    const { createServer } = await import("http");
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const busyPort = (server.address() as any).port;
    try {
      expect(await isPortAvailable(busyPort)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
