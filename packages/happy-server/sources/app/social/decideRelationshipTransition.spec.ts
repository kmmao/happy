import { describe, it, expect } from "vitest";
import { RelationshipStatus } from "@prisma/client";
import { decideRelationshipTransition } from "./decideRelationshipTransition";

const { none, requested, pending, friend, rejected } = RelationshipStatus;

describe("decideRelationshipTransition — add", () => {
    it("accepting an incoming request makes both friends and notifies", () => {
        // target has requested us → accept, regardless of our own side
        expect(decideRelationshipTransition("add", none, requested)).toEqual({
            currentNext: friend,
            targetNext: friend,
            notify: "friendship-established",
            resultStatus: friend,
        });
        // precedence: target=requested wins even if we already hold pending
        expect(decideRelationshipTransition("add", pending, requested)).toMatchObject({ resultStatus: friend });
    });

    it("from none/rejected sends a request; brings target to pending only if it was none", () => {
        expect(decideRelationshipTransition("add", none, none)).toEqual({
            currentNext: requested,
            targetNext: pending,
            notify: "friend-request",
            resultStatus: requested,
        });
        expect(decideRelationshipTransition("add", rejected, none)).toMatchObject({
            currentNext: requested,
            targetNext: pending,
        });
        // target not none (e.g. rejected) → leave target side unchanged
        expect(decideRelationshipTransition("add", none, rejected)).toEqual({
            currentNext: requested,
            targetNext: undefined,
            notify: "friend-request",
            resultStatus: requested,
        });
    });

    it("is a no-op when already requested/pending/friend (and target not requesting)", () => {
        expect(decideRelationshipTransition("add", requested, pending)).toEqual({ resultStatus: requested });
        expect(decideRelationshipTransition("add", friend, friend)).toEqual({ resultStatus: friend });
        expect(decideRelationshipTransition("add", pending, none)).toEqual({ resultStatus: pending });
    });
});

describe("decideRelationshipTransition — remove", () => {
    it("requested → rejected (decline / withdraw)", () => {
        expect(decideRelationshipTransition("remove", requested, pending)).toEqual({
            currentNext: rejected,
            resultStatus: rejected,
        });
    });

    it("friend → we go pending, they go requested", () => {
        expect(decideRelationshipTransition("remove", friend, friend)).toEqual({
            currentNext: pending,
            targetNext: requested,
            resultStatus: requested,
        });
    });

    it("pending → none; clears target too unless they rejected us", () => {
        expect(decideRelationshipTransition("remove", pending, none)).toEqual({
            currentNext: none,
            targetNext: none,
            resultStatus: none,
        });
        expect(decideRelationshipTransition("remove", pending, rejected)).toEqual({
            currentNext: none,
            targetNext: undefined,
            resultStatus: none,
        });
    });

    it("is a no-op for none/rejected", () => {
        expect(decideRelationshipTransition("remove", none, friend)).toEqual({ resultStatus: none });
        expect(decideRelationshipTransition("remove", rejected, none)).toEqual({ resultStatus: rejected });
    });
});
