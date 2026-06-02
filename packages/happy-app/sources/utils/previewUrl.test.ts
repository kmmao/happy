import { describe, expect, it } from "vitest";
import { buildPreviewUrl } from "./previewUrl";

describe("buildPreviewUrl", () => {
    it("uses Tailscale IP when available", () => {
        const machine = {
            daemonState: {
                tailscale: { status: "connected", ipv4: "100.64.0.1" },
            },
        } as any;
        expect(buildPreviewUrl(3000, machine)).toBe("http://100.64.0.1:3000");
    });

    it("falls back to localhost when no Tailscale", () => {
        expect(buildPreviewUrl(3000, null)).toBe("http://localhost:3000");
    });

    it("falls back to localhost when daemonState is null", () => {
        const machine = {
            daemonState: null,
        } as any;
        expect(buildPreviewUrl(5173, machine)).toBe("http://localhost:5173");
    });

    it("falls back to localhost when Tailscale is null", () => {
        const machine = {
            daemonState: {
                tailscale: null,
            },
        } as any;
        expect(buildPreviewUrl(8080, machine)).toBe("http://localhost:8080");
    });

    it("falls back to localhost when Tailscale disconnected", () => {
        const machine = {
            daemonState: {
                tailscale: { status: "disconnected" },
            },
        } as any;
        expect(buildPreviewUrl(5173, machine)).toBe("http://localhost:5173");
    });

    it("falls back to localhost when Tailscale has no IPv4", () => {
        const machine = {
            daemonState: {
                tailscale: { status: "connected" },
            },
        } as any;
        expect(buildPreviewUrl(8080, machine)).toBe("http://localhost:8080");
    });

    it("falls back to localhost when Tailscale IPv4 is empty string", () => {
        const machine = {
            daemonState: {
                tailscale: { status: "connected", ipv4: "" },
            },
        } as any;
        expect(buildPreviewUrl(9000, machine)).toBe("http://localhost:9000");
    });

    it("handles various port numbers", () => {
        const machine = {
            daemonState: {
                tailscale: { status: "connected", ipv4: "100.64.1.50" },
            },
        } as any;
        expect(buildPreviewUrl(80, machine)).toBe("http://100.64.1.50:80");
        expect(buildPreviewUrl(443, machine)).toBe("http://100.64.1.50:443");
        expect(buildPreviewUrl(3000, machine)).toBe("http://100.64.1.50:3000");
        expect(buildPreviewUrl(5173, machine)).toBe("http://100.64.1.50:5173");
        expect(buildPreviewUrl(8080, machine)).toBe("http://100.64.1.50:8080");
        expect(buildPreviewUrl(9999, machine)).toBe("http://100.64.1.50:9999");
    });

    it("works with different Tailscale IPv4 addresses", () => {
        const machine1 = {
            daemonState: {
                tailscale: { status: "connected", ipv4: "100.64.0.1" },
            },
        } as any;
        const machine2 = {
            daemonState: {
                tailscale: { status: "connected", ipv4: "100.127.255.255" },
            },
        } as any;
        expect(buildPreviewUrl(3000, machine1)).toBe("http://100.64.0.1:3000");
        expect(buildPreviewUrl(3000, machine2)).toBe("http://100.127.255.255:3000");
    });

    it("uses localhost for port 0", () => {
        expect(buildPreviewUrl(0, null)).toBe("http://localhost:0");
    });

    it("uses localhost for negative port numbers (invalid but handled)", () => {
        expect(buildPreviewUrl(-1, null)).toBe("http://localhost:-1");
    });

    it("handles Tailscale status that is not 'connected'", () => {
        const machine = {
            daemonState: {
                tailscale: { status: "disconnected", ipv4: "100.64.0.1" },
            },
        } as any;
        expect(buildPreviewUrl(3000, machine)).toBe("http://localhost:3000");
    });

    it("ignores ipv4 when status is not connected", () => {
        const machine = {
            daemonState: {
                tailscale: { status: "notconnected", ipv4: "100.64.0.1" },
            },
        } as any;
        expect(buildPreviewUrl(3000, machine)).toBe("http://localhost:3000");
    });
});
