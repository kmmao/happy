import { describe, it, expect } from "vitest";
import { cronNextRunAt } from "./cronNextRunAt";

describe("cronNextRunAt", () => {
    it("returns null for an unparseable cron expression", () => {
        expect(cronNextRunAt("not a cron")).toBeNull(); // invalid characters
        expect(cronNextRunAt("60 * * * *")).toBeNull(); // minute out of range
        expect(cronNextRunAt("1 2 3 4 5 6 7")).toBeNull(); // too many fields
    });

    it("documents that an empty string is NOT rejected (cron-parser parses it)", () => {
        // The route layer relies on its own `z.string().min(1)` to reject empty
        // input — cronNextRunAt itself treats "" as a valid (every-minute) cron.
        expect(cronNextRunAt("")).not.toBeNull();
    });

    it("computes the next occurrence strictly after the given currentDate", () => {
        // Every day at 00:00. From noon Jan 1, next is midnight Jan 2.
        const from = new Date("2024-01-01T12:00:00.000Z");
        const next = cronNextRunAt("0 0 * * *", from);
        expect(next).not.toBeNull();
        expect(next!.getTime()).toBeGreaterThan(from.getTime());
    });

    it("advances to the next matching minute for a frequent schedule", () => {
        const from = new Date("2024-01-01T12:00:30.000Z"); // 12:00:30
        // Every 5 minutes — next boundary after 12:00:30 is 12:05.
        const next = cronNextRunAt("*/5 * * * *", from);
        expect(next).not.toBeNull();
        expect(next!.getTime()).toBeGreaterThan(from.getTime());
        // Lands on a 5-minute boundary, seconds zeroed.
        expect(next!.getUTCMinutes() % 5).toBe(0);
        expect(next!.getUTCSeconds()).toBe(0);
    });

    it("defaults currentDate to now when omitted (returns a future date)", () => {
        const next = cronNextRunAt("* * * * *"); // every minute
        expect(next).not.toBeNull();
        expect(next!.getTime()).toBeGreaterThan(Date.now() - 1000);
    });
});
