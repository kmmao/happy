import { describe, expect, it } from "vitest";

import { replayLocalId } from "./transcriptReplay";

const scope = {
  sourceSessionId: "93a9705e-bc6a-406d-8dce-8acc014dedbd",
  recordKey: "record-1",
};

describe("transcriptReplay", () => {
  it("generates stable localIds for the same source record and envelope index", () => {
    expect(replayLocalId(scope, 0)).toBe(replayLocalId(scope, 0));
  });

  it("separates envelopes emitted from the same source record", () => {
    expect(replayLocalId(scope, 0)).not.toBe(replayLocalId(scope, 1));
  });

  it("separates source records", () => {
    expect(replayLocalId(scope, 0)).not.toBe(
      replayLocalId({ ...scope, recordKey: "record-2" }, 0),
    );
  });
});
