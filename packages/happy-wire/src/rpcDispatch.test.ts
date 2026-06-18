import { describe, it, expect } from "vitest";

import {
  dispatchRpcMethod,
  type RpcHandlerMap,
  type RpcLogger,
} from "./rpcDispatch";

// dispatchRpcMethod is the plaintext routing core consumed by both
// happy-coder and happy-agent. Previously this logic lived as a method on
// near-identical 200-line `RpcHandlerManager` classes in both packages; the
// dispatch invariants — "unknown method → { error: 'Method not found' }",
// "throwing handler → { error: <msg> }", falsy-passthrough — were tested
// twice, once per copy.
//
// These tests pin the contract once, here. The per-package class wrappers
// keep an end-to-end `handleRequest` test that runs through their local
// cipher, but they no longer duplicate dispatch-level routing tests.

describe("dispatchRpcMethod", () => {
  const noLog: RpcLogger = () => {};

  it("routes a method to its handler and returns the result", async () => {
    const handlers: RpcHandlerMap = new Map([
      ["scope:echo", (d: unknown) => ({ echoed: d })],
    ]);
    expect(
      await dispatchRpcMethod(handlers, "scope:echo", { a: 1 }, noLog),
    ).toEqual({ echoed: { a: 1 } });
  });

  it("returns the handler result verbatim for legitimately-falsy values", async () => {
    // Catching this required splitting handler errors from the
    // "Method not found" branch into typed `{ error }` envelopes; this
    // test pins that the legitimate falsy result still flows through.
    const handlers: RpcHandlerMap = new Map<string, () => unknown>([
      ["scope:zero", () => 0],
      ["scope:no", () => false],
      ["scope:null", () => null],
      ["scope:empty", () => ""],
    ]);
    expect(await dispatchRpcMethod(handlers, "scope:zero", null, noLog)).toBe(0);
    expect(await dispatchRpcMethod(handlers, "scope:no", null, noLog)).toBe(false);
    expect(await dispatchRpcMethod(handlers, "scope:null", null, noLog)).toBe(null);
    expect(await dispatchRpcMethod(handlers, "scope:empty", null, noLog)).toBe("");
  });

  it("returns { error: 'Method not found' } for an unregistered method", async () => {
    const handlers: RpcHandlerMap = new Map();
    expect(
      await dispatchRpcMethod(handlers, "scope:missing", null, noLog),
    ).toEqual({ error: "Method not found" });
  });

  it("absorbs a throwing handler into { error: <msg> } instead of rejecting", async () => {
    const handlers: RpcHandlerMap = new Map([
      [
        "scope:boom",
        () => {
          throw new Error("handler failed");
        },
      ],
    ]);
    expect(
      await dispatchRpcMethod(handlers, "scope:boom", null, noLog),
    ).toEqual({ error: "handler failed" });
  });

  it("absorbs an async-throwing handler the same way", async () => {
    const handlers: RpcHandlerMap = new Map([
      [
        "scope:asyncBoom",
        async () => {
          throw new Error("async failed");
        },
      ],
    ]);
    expect(
      await dispatchRpcMethod(handlers, "scope:asyncBoom", null, noLog),
    ).toEqual({ error: "async failed" });
  });

  it("absorbs non-Error throw into a generic { error: 'Unknown error' }", async () => {
    const handlers: RpcHandlerMap = new Map([
      [
        "scope:weirdThrow",
        () => {
          throw "not an Error instance";
        },
      ],
    ]);
    expect(
      await dispatchRpcMethod(handlers, "scope:weirdThrow", null, noLog),
    ).toEqual({ error: "Unknown error" });
  });

  it("calls the logger at the documented inflection points", async () => {
    const calls: Array<{ msg: string; data?: unknown }> = [];
    const logger: RpcLogger = (msg, data) => {
      calls.push({ msg, data });
    };
    const handlers: RpcHandlerMap = new Map([
      ["scope:echo", (d: unknown) => d],
    ]);

    await dispatchRpcMethod(handlers, "scope:echo", "hi", logger);

    const msgs = calls.map((c) => c.msg);
    expect(msgs).toEqual(["[RPC] Calling handler", "[RPC] Handler returned"]);

    await dispatchRpcMethod(handlers, "scope:missing", null, logger);
    expect(calls.at(-1)?.msg).toBe("[RPC] [ERROR] Method not found");
  });
});
