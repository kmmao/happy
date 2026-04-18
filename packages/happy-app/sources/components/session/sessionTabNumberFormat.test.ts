import { describe, expect, it } from "vitest";

import { formatCompactTabNumber } from "./sessionTabNumberFormat";

describe("formatCompactTabNumber", () => {
    it("keeps small numbers uncompact", () => {
        expect(formatCompactTabNumber(0)).toBe("0");
        expect(formatCompactTabNumber(17)).toBe("17");
        expect(formatCompactTabNumber(999)).toBe("999");
    });

    it("formats thousands with a single decimal under 10k", () => {
        expect(formatCompactTabNumber(1000)).toBe("1k");
        expect(formatCompactTabNumber(1639)).toBe("1.6k");
        expect(formatCompactTabNumber(3128)).toBe("3.1k");
    });

    it("drops the decimal once the compact value is 10 or more", () => {
        expect(formatCompactTabNumber(12_543)).toBe("13k");
        expect(formatCompactTabNumber(125_430)).toBe("125k");
    });

    it("supports larger units and negative values", () => {
        expect(formatCompactTabNumber(1_250_000)).toBe("1.3m");
        expect(formatCompactTabNumber(-1639)).toBe("-1.6k");
    });
});
