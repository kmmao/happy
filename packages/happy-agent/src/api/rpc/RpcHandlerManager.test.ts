import { describe, it, expect } from "vitest";
import { createRpcHandlerManager } from "./RpcHandlerManager";
import { createCipher, getRandomBytes } from "../../encryption";

/**
 * Tests for the plaintext routing core of the RpcHandlerManager.
 *
 * `dispatch` is the seam the wire `handleRequest` delegates to once the Cipher
 * has removed the encryption: given a (prefixed) method + plaintext params it
 * routes to the handler. Because it knows nothing about the wire it is TOTAL —
 * unknown methods and throwing handlers both resolve to an `{ error }` value —
 * so these tests need no crypto setup (the cipher below is only a constructor
 * dependency that `dispatch` never touches).
 */
describe("RpcHandlerManager.dispatch", () => {
  const newManager = () =>
    createRpcHandlerManager({
      scopePrefix: "scope",
      cipher: createCipher(getRandomBytes(32), "dataKey"),
      logger: () => {},
    });

  it("routes a prefixed method to its handler and returns the result", async () => {
    const mgr = newManager();
    mgr.registerHandler("echo", (data: unknown) => ({ echoed: data }));
    expect(await mgr.dispatch("scope:echo", { a: 1 })).toEqual({ echoed: { a: 1 } });
  });

  it("returns the handler result verbatim for legitimately-falsy values", async () => {
    const mgr = newManager();
    mgr.registerHandler("zero", () => 0);
    mgr.registerHandler("no", () => false);
    expect(await mgr.dispatch("scope:zero", null)).toBe(0);
    expect(await mgr.dispatch("scope:no", null)).toBe(false);
  });

  it('returns { error: "Method not found" } for an unregistered method', async () => {
    const mgr = newManager();
    expect(await mgr.dispatch("scope:missing", null)).toEqual({ error: "Method not found" });
  });

  it("absorbs a throwing handler into { error } instead of rejecting", async () => {
    const mgr = newManager();
    mgr.registerHandler("boom", () => {
      throw new Error("handler failed");
    });
    expect(await mgr.dispatch("scope:boom", null)).toEqual({ error: "handler failed" });
  });

  it("round-trips a request end-to-end through the Cipher seam", async () => {
    const cipher = createCipher(getRandomBytes(32), "dataKey");
    const mgr = createRpcHandlerManager({ scopePrefix: "scope", cipher, logger: () => {} });
    mgr.registerHandler("echo", (data: unknown) => ({ echoed: data }));

    const wire = await mgr.handleRequest({ method: "scope:echo", params: cipher.encrypt({ x: 7 }) });
    expect(cipher.decrypt(wire)).toEqual({ ok: true, value: { echoed: { x: 7 } } });
  });
});
