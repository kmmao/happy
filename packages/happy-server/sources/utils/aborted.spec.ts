import { describe, it, expect } from "vitest";
import { AbortedExeption } from "./aborted";

describe("AbortedExeption", () => {
    it("should create with default message", () => {
        const error = new AbortedExeption();
        expect(error.message).toBe("Operation aborted");
        expect(error.name).toBe("AbortedExeption");
    });

    it("should create with custom message", () => {
        const error = new AbortedExeption("Custom abort");
        expect(error.message).toBe("Custom abort");
        expect(error.name).toBe("AbortedExeption");
    });

    it("should be an instance of Error", () => {
        const error = new AbortedExeption();
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(AbortedExeption);
    });

    it("should have a stack trace", () => {
        const error = new AbortedExeption();
        expect(error.stack).toBeDefined();
    });

    describe("isAborted", () => {
        it("should return true for AbortedExeption instances", () => {
            const error = new AbortedExeption();
            expect(AbortedExeption.isAborted(error)).toBe(true);
        });

        it("should return false for regular Error", () => {
            const error = new Error("not aborted");
            expect(AbortedExeption.isAborted(error)).toBe(false);
        });

        it("should return false for null", () => {
            expect(AbortedExeption.isAborted(null)).toBe(false);
        });

        it("should return false for undefined", () => {
            expect(AbortedExeption.isAborted(undefined)).toBe(false);
        });

        it("should return false for string", () => {
            expect(AbortedExeption.isAborted("aborted")).toBe(false);
        });

        it("should return false for number", () => {
            expect(AbortedExeption.isAborted(42)).toBe(false);
        });
    });
});
