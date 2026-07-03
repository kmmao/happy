import { describe, it, expect } from "vitest";
import { pickPermissionId } from "./codexApprovalHelpers";

describe("pickPermissionId", () => {
  it("uses the named field when it is a non-empty string", () => {
    expect(pickPermissionId({ callId: "c1" }, "callId", "rk")).toBe("c1");
    expect(pickPermissionId({ itemId: "i1" }, "itemId", "rk")).toBe("i1");
  });

  it("falls back to the requestKey when the field is missing", () => {
    expect(pickPermissionId({}, "callId", "rk")).toBe("rk");
  });

  it("falls back when the field is an empty string", () => {
    expect(pickPermissionId({ callId: "" }, "callId", "rk")).toBe("rk");
  });

  it("falls back when the field is not a string", () => {
    expect(pickPermissionId({ callId: 123 }, "callId", "rk")).toBe("rk");
    expect(pickPermissionId({ callId: null }, "callId", "rk")).toBe("rk");
    expect(pickPermissionId({ callId: { a: 1 } }, "callId", "rk")).toBe("rk");
  });
});
