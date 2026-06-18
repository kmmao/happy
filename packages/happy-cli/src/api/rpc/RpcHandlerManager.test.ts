import { describe, it, expect } from "vitest";

import { createRpcHandlerManager } from "./RpcHandlerManager";
import { createCipher, getRandomBytes } from "@/api/encryption";

/**
 * End-to-end Cipher round-trip for the local class wrapper.
 *
 * The plaintext routing core (`dispatchRpcMethod`) now lives in
 * `@kmmao/happy-wire`; its routing invariants (unknown method, throwing
 * handler, falsy passthrough, logger sequencing) are pinned by the wire
 * test (`packages/happy-wire/src/rpcDispatch.test.ts`) so we don't repeat
 * them here.
 *
 * What stays test-worthy locally is the wire-in: that `handleRequest`
 * decrypts, dispatches, and re-encrypts through the package's actual
 * `Cipher` (NaCl secretbox / AES-GCM). A regression in that wiring would
 * silently produce wire envelopes the server can't decrypt — the wire-
 * level routing test would still pass and the bug would only surface in
 * production.
 */
describe("RpcHandlerManager.handleRequest (Cipher round-trip)", () => {
  it("round-trips a request end-to-end through the Cipher seam", async () => {
    const cipher = createCipher(getRandomBytes(32), "dataKey");
    const mgr = createRpcHandlerManager({
      scopePrefix: "scope",
      cipher,
      logger: () => {},
    });
    mgr.registerHandler("echo", (data: unknown) => ({ echoed: data }));

    const wire = await mgr.handleRequest({
      method: "scope:echo",
      params: cipher.encrypt({ x: 7 }),
    });
    expect(cipher.decrypt(wire)).toEqual({
      ok: true,
      value: { echoed: { x: 7 } },
    });
  });
});
