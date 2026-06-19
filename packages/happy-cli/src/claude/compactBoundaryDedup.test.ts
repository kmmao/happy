import { describe, expect, it } from "vitest";

import { tryRegisterCompactBoundaryEmission } from "./compactBoundaryDedup";

// Guards the "emit `Context compacted` exactly once per `compact_boundary` uuid"
// contract that protects the App from duplicate bubbles on every cold-restart
// replay. See compactBoundaryDedup.ts docblock for the full rationale.
describe("tryRegisterCompactBoundaryEmission", () => {
  it("returns true on the first observation of a uuid and adds it to the set", () => {
    const seen = new Set<string>();
    expect(tryRegisterCompactBoundaryEmission(seen, "uuid-1")).toBe(true);
    expect(seen.has("uuid-1")).toBe(true);
    expect(seen.size).toBe(1);
  });

  it("returns false on every subsequent observation of the same uuid", () => {
    const seen = new Set<string>();
    tryRegisterCompactBoundaryEmission(seen, "uuid-1");
    expect(tryRegisterCompactBoundaryEmission(seen, "uuid-1")).toBe(false);
    expect(tryRegisterCompactBoundaryEmission(seen, "uuid-1")).toBe(false);
    expect(seen.size).toBe(1);
  });

  it("treats distinct uuids independently", () => {
    const seen = new Set<string>();
    expect(tryRegisterCompactBoundaryEmission(seen, "uuid-1")).toBe(true);
    expect(tryRegisterCompactBoundaryEmission(seen, "uuid-2")).toBe(true);
    expect(tryRegisterCompactBoundaryEmission(seen, "uuid-1")).toBe(false);
    expect(tryRegisterCompactBoundaryEmission(seen, "uuid-2")).toBe(false);
    expect(seen.size).toBe(2);
  });

  // Pins the symptom this guard exists to fix: 4 identical "Context compacted"
  // bubbles after one /compact + 3 intervening cold restarts. Only the first
  // observation of the boundary uuid may emit; the 3 sessionScanner replays
  // must each be suppressed.
  it("suppresses 3 replays after a single real emission (cold-restart replay shape)", () => {
    const seen = new Set<string>();
    const observations = [
      "boundary-uuid", // real compact_boundary
      "boundary-uuid", // replay after 1st cold restart
      "boundary-uuid", // replay after 2nd cold restart
      "boundary-uuid", // replay after 3rd cold restart
    ];
    const emitted = observations.filter((u) =>
      tryRegisterCompactBoundaryEmission(seen, u),
    );
    expect(emitted).toEqual(["boundary-uuid"]);
  });

  // A pre-seeded set models a launcher instance that has already emitted for
  // this uuid (e.g. across re-entries of the closure). The guard must still
  // refuse — sessions that legitimately re-/compact will carry a different
  // boundary uuid, so the false here is correct.
  it("refuses uuids already present in the seed set", () => {
    const seen = new Set<string>(["pre-seeded"]);
    expect(tryRegisterCompactBoundaryEmission(seen, "pre-seeded")).toBe(false);
    expect(tryRegisterCompactBoundaryEmission(seen, "fresh")).toBe(true);
  });
});
