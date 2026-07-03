/**
 * Tunnel Provider abstraction — the contract lives in @kmmao/happy-wire
 * (tunnelProvider.ts) so happy-cli and happy-agent type-check against the
 * SAME interface; the hand-copied versions drifted (renewLeases?) and the
 * drift was the ADR-0035 trigger to extract. This module re-exports so
 * existing `./types` / `../types` import sites stay stable.
 */

export type {
  TunnelProvider,
  TunnelAddParams,
  TunnelRemoveParams,
  TunnelOpResult,
} from "@kmmao/happy-wire";
