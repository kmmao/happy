import { describe, expect, it } from "vitest";
import {
    coerceElicitationValue,
    parseElicitationFields,
} from "./elicitationSchema";

describe("elicitationSchema", () => {
    it("extracts selectable options and custom metadata from request schemas", () => {
        const fields = parseElicitationFields({
            type: "object",
            required: ["choice"],
            properties: {
                choice: {
                    type: "string",
                    title: "Pick one",
                    description: "Choose an option",
                    oneOf: [
                        {
                            const: "Fast (Recommended)",
                            title: "Fast (Recommended)",
                            description: "Lower effort",
                        },
                        {
                            const: "Deep",
                            title: "Deep",
                            description: "Higher effort",
                        },
                    ],
                    "x-happy-other": true,
                    "x-happy-secret": true,
                },
            },
        });

        expect(fields).toEqual([
            {
                key: "choice",
                label: "Pick one",
                description: "Choose an option",
                type: "string",
                defaultValue: "",
                required: true,
                allowOther: true,
                secret: true,
                options: [
                    {
                        value: "Fast (Recommended)",
                        label: "Fast (Recommended)",
                        description: "Lower effort",
                    },
                    {
                        value: "Deep",
                        label: "Deep",
                        description: "Higher effort",
                    },
                ],
            },
        ]);
    });

    it("falls back to enum values when oneOf is absent", () => {
        const fields = parseElicitationFields({
            type: "object",
            properties: {
                mode: {
                    type: "string",
                    description: "Mode",
                    enum: ["Auto", "Manual"],
                },
            },
        });

        expect(fields[0]?.options).toEqual([
            {
                value: "Auto",
                label: "Auto",
                description: "",
            },
            {
                value: "Manual",
                label: "Manual",
                description: "",
            },
        ]);
    });

    it("coerces primitive values using the schema field type", () => {
        expect(
            coerceElicitationValue(
                { type: "integer" },
                "42",
            ),
        ).toBe(42);
        expect(
            coerceElicitationValue(
                { type: "number" },
                "3.5",
            ),
        ).toBe(3.5);
        expect(
            coerceElicitationValue(
                { type: "boolean" },
                "true",
            ),
        ).toBe(true);
        expect(
            coerceElicitationValue(
                { type: "boolean" },
                "false",
            ),
        ).toBe(false);
        expect(
            coerceElicitationValue(
                { type: "string" },
                "hello",
            ),
        ).toBe("hello");
    });
});
