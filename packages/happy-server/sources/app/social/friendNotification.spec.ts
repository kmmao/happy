import { describe, it, expect, vi } from "vitest";
import { RelationshipStatus } from "@prisma/client";

// Mock the dependencies that require environment variables
vi.mock("@/storage/files", () => ({
    getPublicUrl: vi.fn((path: string) => `https://example.com/${path}`)
}));

vi.mock("@/app/feed/feedPost", () => ({
    feedPost: vi.fn()
}));

vi.mock("@/storage/inTx", () => ({
    afterTx: vi.fn()
}));

// Import after mocking
import {
    shouldSendNotification,
    sendFriendRequestNotification,
    sendFriendshipEstablishedNotification
} from "./friendNotification";
import { feedPost } from "@/app/feed/feedPost";

/** Minimal in-memory `tx.userRelationship` keyed by `from:to`. */
function makeTx(
    rels: Record<string, { lastNotifiedAt: Date | null; status: RelationshipStatus }>
) {
    const updated: Array<{ from: string; to: string }> = [];
    const tx = {
        userRelationship: {
            findUnique: vi.fn(async ({ where }: any) => {
                const { fromUserId, toUserId } = where.fromUserId_toUserId;
                return rels[`${fromUserId}:${toUserId}`] ?? null;
            }),
            update: vi.fn(async ({ where }: any) => {
                const { fromUserId, toUserId } = where.fromUserId_toUserId;
                updated.push({ from: fromUserId, to: toUserId });
                return {};
            })
        }
    } as any;
    return { tx, updated };
}

describe("friendNotification", () => {
    describe("shouldSendNotification", () => {
        it("should return true when lastNotifiedAt is null", () => {
            const result = shouldSendNotification(null, RelationshipStatus.pending);
            expect(result).toBe(true);
        });

        it("should return false for rejected relationships", () => {
            const result = shouldSendNotification(null, RelationshipStatus.rejected);
            expect(result).toBe(false);
        });

        it("should return false for rejected relationships even if 24 hours passed", () => {
            const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
            const result = shouldSendNotification(twentyFiveHoursAgo, RelationshipStatus.rejected);
            expect(result).toBe(false);
        });

        it("should return true when 24 hours have passed since last notification", () => {
            const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
            const result = shouldSendNotification(twentyFiveHoursAgo, RelationshipStatus.pending);
            expect(result).toBe(true);
        });

        it("should return false when less than 24 hours have passed", () => {
            const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000);
            const result = shouldSendNotification(tenHoursAgo, RelationshipStatus.pending);
            expect(result).toBe(false);
        });

        it("should work for friend status", () => {
            const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
            const result = shouldSendNotification(twentyFiveHoursAgo, RelationshipStatus.friend);
            expect(result).toBe(true);
        });

        it("should work for requested status", () => {
            const result = shouldSendNotification(null, RelationshipStatus.requested);
            expect(result).toBe(true);
        });
    });

    describe("sendFriendRequestNotification", () => {
        it("posts a friend_request feed item + stamps lastNotifiedAt when the gate passes", async () => {
            vi.mocked(feedPost).mockClear();
            const { tx, updated } = makeTx({
                "receiver:sender": { lastNotifiedAt: null, status: RelationshipStatus.requested }
            });

            await sendFriendRequestNotification(tx, "receiver", "sender");

            expect(feedPost).toHaveBeenCalledTimes(1);
            expect(feedPost).toHaveBeenCalledWith(
                tx,
                expect.anything(),
                { kind: "friend_request", uid: "sender" },
                "friend_request_sender"
            );
            expect(updated).toEqual([{ from: "receiver", to: "sender" }]);
        });

        it("does nothing when no relationship record exists", async () => {
            vi.mocked(feedPost).mockClear();
            const { tx, updated } = makeTx({});

            await sendFriendRequestNotification(tx, "receiver", "sender");

            expect(feedPost).not.toHaveBeenCalled();
            expect(updated).toEqual([]);
        });

        it("does nothing when the relationship is rejected (gate closed)", async () => {
            vi.mocked(feedPost).mockClear();
            const { tx, updated } = makeTx({
                "receiver:sender": { lastNotifiedAt: null, status: RelationshipStatus.rejected }
            });

            await sendFriendRequestNotification(tx, "receiver", "sender");

            expect(feedPost).not.toHaveBeenCalled();
            expect(updated).toEqual([]);
        });
    });

    describe("sendFriendshipEstablishedNotification", () => {
        it("notifies BOTH directions with friend_accepted, each gated by its own record", async () => {
            vi.mocked(feedPost).mockClear();
            const { tx, updated } = makeTx({
                "u1:u2": { lastNotifiedAt: null, status: RelationshipStatus.friend },
                "u2:u1": { lastNotifiedAt: null, status: RelationshipStatus.friend }
            });

            await sendFriendshipEstablishedNotification(tx, "u1", "u2");

            expect(feedPost).toHaveBeenCalledTimes(2);
            expect(feedPost).toHaveBeenCalledWith(
                tx, expect.anything(), { kind: "friend_accepted", uid: "u2" }, "friend_accepted_u2"
            );
            expect(feedPost).toHaveBeenCalledWith(
                tx, expect.anything(), { kind: "friend_accepted", uid: "u1" }, "friend_accepted_u1"
            );
            expect(updated).toEqual([
                { from: "u1", to: "u2" },
                { from: "u2", to: "u1" }
            ]);
        });

        it("skips the direction whose own record is missing or rejected", async () => {
            vi.mocked(feedPost).mockClear();
            const { tx, updated } = makeTx({
                "u1:u2": { lastNotifiedAt: null, status: RelationshipStatus.friend }
                // u2:u1 missing → that direction is skipped
            });

            await sendFriendshipEstablishedNotification(tx, "u1", "u2");

            expect(feedPost).toHaveBeenCalledTimes(1);
            expect(updated).toEqual([{ from: "u1", to: "u2" }]);
        });
    });
});