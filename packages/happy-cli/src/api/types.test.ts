import { describe, expectTypeOf, it } from "vitest";

import type {
  SessionProgressState,
  SessionSummaryState,
} from "@kmmao/happy-wire";

import type { Metadata } from "./types";

describe("Metadata shared session state types", () => {
  it("reuses happy-wire progress and summary types", () => {
    expectTypeOf<NonNullable<Metadata["progress"]>>().toEqualTypeOf<SessionProgressState>();
    expectTypeOf<NonNullable<Metadata["sessionSummary"]>>().toEqualTypeOf<SessionSummaryState>();
  });
});
