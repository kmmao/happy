import { describe, it, expect } from "vitest";
import { hasPendingAskUserQuestion } from "./messageQueries";
import type { Message } from "@/sync/typesMessage";

function toolCall(over: {
    name?: string;
    state?: "running" | "completed" | "error";
    permissionStatus?: "pending" | "approved" | "denied" | "canceled";
    children?: Message[];
}): Message {
    return {
        kind: "tool-call",
        id: "t1",
        createdAt: 0,
        tool: {
            name: over.name ?? "AskUserQuestion",
            state: over.state ?? "running",
            input: {},
            permission: over.permissionStatus
                ? { id: "p1", status: over.permissionStatus }
                : undefined,
        },
        children: over.children ?? [],
    } as unknown as Message;
}

describe("hasPendingAskUserQuestion", () => {
    it("is true for a running AskUserQuestion with a pending permission", () => {
        expect(
            hasPendingAskUserQuestion([
                toolCall({ permissionStatus: "pending" }),
            ]),
        ).toBe(true);
    });

    it("is false when the AskUserQuestion permission is already approved", () => {
        expect(
            hasPendingAskUserQuestion([
                toolCall({ permissionStatus: "approved" }),
            ]),
        ).toBe(false);
    });

    it("is false for a different tool even if pending", () => {
        expect(
            hasPendingAskUserQuestion([
                toolCall({ name: "Bash", permissionStatus: "pending" }),
            ]),
        ).toBe(false);
    });

    it("is false when the AskUserQuestion is no longer running", () => {
        expect(
            hasPendingAskUserQuestion([
                toolCall({ state: "completed", permissionStatus: "pending" }),
            ]),
        ).toBe(false);
    });

    it("recurses into Subagent children", () => {
        const parent = toolCall({
            name: "Task",
            permissionStatus: "approved",
            children: [toolCall({ permissionStatus: "pending" })],
        });
        expect(hasPendingAskUserQuestion([parent])).toBe(true);
    });

    it("is false for an empty tree", () => {
        expect(hasPendingAskUserQuestion([])).toBe(false);
    });
});
