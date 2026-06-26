import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Mock the shared logger so we can assert the warn/error convention the seam
// owns without writing real log lines.
const logMock = vi.hoisted(() => vi.fn());
vi.mock("@/utils/log", () => ({ log: logMock }));

import { registerSocketEvent } from "./registerSocketEvent";

function createMockSocket() {
    const handlers = new Map<string, (...args: any[]) => void>();
    return {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
            handlers.set(event, handler);
        }),
        emit(event: string, data: unknown) {
            const handler = handlers.get(event);
            if (!handler) throw new Error(`No handler for event: ${event}`);
            return handler(data);
        },
    };
}

const SCHEMA = z.object({ id: z.string().min(1), n: z.number() });
const USER_ID = "user-1";

describe("registerSocketEvent", () => {
    let socket: ReturnType<typeof createMockSocket>;

    beforeEach(() => {
        vi.clearAllMocks();
        socket = createMockSocket();
    });

    it("registers the handler under the event name", () => {
        registerSocketEvent({
            socket: socket as any,
            userId: USER_ID,
            event: "demo-event",
            schema: SCHEMA,
            module: "demo",
            handler: vi.fn(),
        });
        expect(socket.on).toHaveBeenCalledWith("demo-event", expect.any(Function));
    });

    it("runs the handler with validated data + context on a valid payload", async () => {
        const handler = vi.fn();
        registerSocketEvent({
            socket: socket as any,
            userId: USER_ID,
            event: "demo-event",
            schema: SCHEMA,
            module: "demo",
            handler,
        });

        await socket.emit("demo-event", { id: "abc", n: 7 });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(
            { id: "abc", n: 7 },
            { userId: USER_ID, socket },
        );
    });

    it("drops an invalid payload with a warn log and never calls the handler", async () => {
        const handler = vi.fn();
        registerSocketEvent({
            socket: socket as any,
            userId: USER_ID,
            event: "demo-event",
            schema: SCHEMA,
            module: "demo",
            handler,
        });

        await socket.emit("demo-event", { id: "", n: "not-a-number" });

        expect(handler).not.toHaveBeenCalled();
        expect(logMock).toHaveBeenCalledWith(
            { module: "demo", level: "warn" },
            expect.stringContaining("demo-event: invalid data:"),
        );
    });

    it("catches a throwing handler with an error log instead of crashing the socket", async () => {
        const handler = vi.fn(async () => {
            throw new Error("boom");
        });
        registerSocketEvent({
            socket: socket as any,
            userId: USER_ID,
            event: "demo-event",
            schema: SCHEMA,
            module: "demo",
            handler,
        });

        // Must resolve, not reject — a thrown handler must not take down the socket.
        await expect(socket.emit("demo-event", { id: "abc", n: 1 })).resolves.toBeUndefined();

        expect(logMock).toHaveBeenCalledWith(
            { module: "demo", level: "error" },
            expect.stringContaining("demo-event handler error:"),
        );
    });
});
