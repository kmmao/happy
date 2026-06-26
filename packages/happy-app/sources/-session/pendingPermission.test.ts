import { describe, it, expect } from "vitest";
import { resolvePendingPermission, findPendingPermission } from "./pendingPermission";
import type { Message } from "@/sync/typesMessage";

function toolCall(
    name: string,
    permissionStatus: "pending" | "approved" | null,
    children: Message[] = [],
): Message {
    return {
        kind: "tool-call",
        id: name,
        localId: null,
        createdAt: 0,
        tool: {
            name,
            input: { from: name },
            permission: permissionStatus ? { id: `perm-${name}`, status: permissionStatus } : undefined,
        },
        children,
    } as unknown as Message;
}

const requests = (entries: Record<string, { tool: string; arguments: unknown }>) => entries;

describe("resolvePendingPermission", () => {
    it("returns null when the session is not awaiting permission", () => {
        expect(
            resolvePendingPermission({ hasPendingPermission: false, requests: requests({ a: { tool: "Bash", arguments: {} } }), messages: [] }),
        ).toBeNull();
    });

    it("prefers an AskUserQuestion entry from agentState.requests", () => {
        const result = resolvePendingPermission({
            hasPendingPermission: true,
            requests: requests({
                first: { tool: "Bash", arguments: { cmd: "ls" } },
                q: { tool: "AskUserQuestion", arguments: { question: "pick" } },
            }),
            messages: [],
        });
        expect(result).toEqual({
            toolName: "AskUserQuestion",
            toolInput: { question: "pick" },
            permission: { id: "q", status: "pending" },
        });
    });

    it("falls back to the first request entry when no AskUserQuestion is present", () => {
        const result = resolvePendingPermission({
            hasPendingPermission: true,
            requests: requests({ first: { tool: "Bash", arguments: { cmd: "ls" } } }),
            messages: [],
        });
        expect(result?.toolName).toBe("Bash");
        expect(result?.permission).toEqual({ id: "first", status: "pending" });
    });

    it("searches the message tree (incl. children) when no requests exist", () => {
        const messages = [
            toolCall("Read", "approved"),
            toolCall("Parent", null, [toolCall("Edit", "pending")]),
        ];
        const result = resolvePendingPermission({ hasPendingPermission: true, requests: null, messages });
        expect(result?.toolName).toBe("Edit");
        expect(result?.permission.status).toBe("pending");
    });

    it("returns null when pending but nothing resolves (empty requests + no pending tool)", () => {
        const result = resolvePendingPermission({
            hasPendingPermission: true,
            requests: {},
            messages: [toolCall("Read", "approved")],
        });
        expect(result).toBeNull();
    });
});

describe("findPendingPermission", () => {
    it("returns the first pending tool depth-first, parents before children", () => {
        const messages = [
            toolCall("Parent", "pending", [toolCall("Child", "pending")]),
        ];
        // Parent is pending itself, so it wins over its child.
        expect(findPendingPermission(messages)?.toolName).toBe("Parent");
    });
});
