import { describe, expect, it } from "vitest";
import {
  PreviewCandidateSchema,
  PreviewCandidateReportSchema,
  PreviewConnectionSchema,
  PreviewProxyRequestSchema,
  PreviewProxyResponseStartSchema,
  PreviewProxyResponseBodySchema,
  PreviewProxyResponseEndSchema,
  PreviewProxyResponseErrorSchema,
  PreviewWsConnectSchema,
  PreviewWsFrameSchema,
  PreviewWsCloseSchema,
  VisualAnnotationAnchorSchema,
  VisualAnnotationReportSchema,
  PreviewCandidateReportedEphemeralSchema,
  PreviewConnectionUpdatedEphemeralSchema,
  PreviewResourceLimitsSchema,
  DEFAULT_PREVIEW_RESOURCE_LIMITS,
  DEFAULT_PREVIEW_LEASE_MS,
  DEFAULT_PREVIEW_IDLE_TIMEOUT_MS,
  PREVIEW_PROXY_CHUNK_SIZE,
  PreviewCandidateStateSchema,
  PreviewConnectionStatusSchema,
  AnnotationViewportSchema,
  AnnotationRectSchema,
  AnnotationTargetSchema,
  AnnotationAncestorSchema,
} from "./previewTypes";
import {
  HAPPY_MCP_AUTO_APPROVE_TOOL_NAMES,
  HAPPY_MCP_TOOL_NAMES,
} from "./happyMcp";

describe("previewTypes", () => {
  describe("PreviewCandidateStateSchema", () => {
    it("accepts all valid states", () => {
      expect(PreviewCandidateStateSchema.safeParse("reported").success).toBe(true);
      expect(PreviewCandidateStateSchema.safeParse("validating").success).toBe(true);
      expect(PreviewCandidateStateSchema.safeParse("available").success).toBe(true);
      expect(PreviewCandidateStateSchema.safeParse("invalid").success).toBe(true);
    });

    it("rejects invalid state", () => {
      expect(PreviewCandidateStateSchema.safeParse("pending").success).toBe(false);
    });
  });

  describe("PreviewCandidateSchema", () => {
    it("parses a valid candidate with required fields", () => {
      const data = {
        id: "cand-1",
        sessionId: "sess-1",
        state: "reported" as const,
        host: "localhost",
        port: 3000,
        reportedAt: Date.now(),
      };
      const result = PreviewCandidateSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.protocol).toBe("http"); // default
      }
    });

    it("parses a full candidate with all optional fields", () => {
      const data = {
        id: "cand-1",
        sessionId: "sess-1",
        state: "available" as const,
        protocol: "https" as const,
        host: "example.com",
        port: 443,
        path: "/app",
        devServerType: "next",
        command: "npm run dev",
        cwd: "/home/user/project",
        pid: 1234,
        reportedAt: Date.now(),
        validatedAt: Date.now(),
        error: undefined,
      };
      const result = PreviewCandidateSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.protocol).toBe("https");
        expect(result.data.path).toBe("/app");
      }
    });

    it("rejects missing required fields", () => {
      const data = {
        id: "cand-1",
        sessionId: "sess-1",
        state: "reported" as const,
        // missing host
        port: 3000,
        reportedAt: Date.now(),
      };
      expect(PreviewCandidateSchema.safeParse(data).success).toBe(false);
    });

    it("rejects invalid port (0)", () => {
      const data = {
        id: "cand-1",
        sessionId: "sess-1",
        state: "reported" as const,
        host: "localhost",
        port: 0,
        reportedAt: Date.now(),
      };
      expect(PreviewCandidateSchema.safeParse(data).success).toBe(false);
    });

    it("rejects invalid port (> 65535)", () => {
      const data = {
        id: "cand-1",
        sessionId: "sess-1",
        state: "reported" as const,
        host: "localhost",
        port: 99999,
        reportedAt: Date.now(),
      };
      expect(PreviewCandidateSchema.safeParse(data).success).toBe(false);
    });

    it("defaults protocol to http", () => {
      const data = {
        id: "cand-1",
        sessionId: "sess-1",
        state: "reported" as const,
        host: "localhost",
        port: 3000,
        reportedAt: Date.now(),
      };
      const result = PreviewCandidateSchema.safeParse(data);
      expect(result.success && result.data.protocol).toBe("http");
    });
  });

  describe("PreviewCandidateReportSchema", () => {
    it("parses a minimal report with protocol, host, port", () => {
      const data = {
        sessionId: "sess-1",
        host: "localhost",
        port: 3000,
      };
      const result = PreviewCandidateReportSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.protocol).toBe("http");
      }
    });

    it("parses a full report with all optional fields", () => {
      const data = {
        sessionId: "sess-1",
        protocol: "https" as const,
        host: "example.com",
        port: 8080,
        path: "/app",
        devServerType: "vite",
        command: "yarn dev",
        cwd: "/project",
        pid: 5678,
      };
      const result = PreviewCandidateReportSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.devServerType).toBe("vite");
        expect(result.data.pid).toBe(5678);
      }
    });

    it("rejects empty host", () => {
      const data = {
        sessionId: "sess-1",
        host: "",
        port: 3000,
      };
      expect(PreviewCandidateReportSchema.safeParse(data).success).toBe(false);
    });

    it("rejects missing sessionId", () => {
      const data = {
        host: "localhost",
        port: 3000,
      };
      expect(PreviewCandidateReportSchema.safeParse(data).success).toBe(false);
    });
  });

  describe("PreviewConnectionStatusSchema", () => {
    it("accepts all valid statuses", () => {
      expect(PreviewConnectionStatusSchema.safeParse("creating").success).toBe(true);
      expect(PreviewConnectionStatusSchema.safeParse("active").success).toBe(true);
      expect(PreviewConnectionStatusSchema.safeParse("idle").success).toBe(true);
      expect(PreviewConnectionStatusSchema.safeParse("failed").success).toBe(true);
      expect(PreviewConnectionStatusSchema.safeParse("expired").success).toBe(true);
    });

    it("rejects invalid status", () => {
      expect(PreviewConnectionStatusSchema.safeParse("disconnected").success).toBe(false);
    });
  });

  describe("PreviewConnectionSchema", () => {
    it("parses a valid connection", () => {
      const data = {
        tunnelId: "tun-1",
        candidateId: "cand-1",
        sessionId: "sess-1",
        publicUrl: "https://tunnel.example.com",
        status: "active" as const,
        createdAt: Date.now(),
        leaseExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
        idleTimeoutMs: 45 * 60 * 1000,
        lastActiveAt: Date.now(),
      };
      const result = PreviewConnectionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("validates all status values in connection", () => {
      const baseData = {
        tunnelId: "tun-1",
        candidateId: "cand-1",
        sessionId: "sess-1",
        publicUrl: "https://tunnel.example.com",
        createdAt: Date.now(),
        leaseExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
        idleTimeoutMs: 45 * 60 * 1000,
        lastActiveAt: Date.now(),
      };

      const statuses = ["creating", "active", "idle", "failed", "expired"] as const;
      for (const status of statuses) {
        const result = PreviewConnectionSchema.safeParse({
          ...baseData,
          status,
        });
        expect(result.success).toBe(true);
      }
    });

    it("accepts optional error field", () => {
      const data = {
        tunnelId: "tun-1",
        candidateId: "cand-1",
        sessionId: "sess-1",
        publicUrl: "https://tunnel.example.com",
        status: "failed" as const,
        createdAt: Date.now(),
        leaseExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
        idleTimeoutMs: 45 * 60 * 1000,
        lastActiveAt: Date.now(),
        error: "Connection timeout",
      };
      const result = PreviewConnectionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe("PreviewProxyRequestSchema", () => {
    it("parses request with empty bodyChunks default", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
        method: "GET",
        path: "/api/users",
        headers: { "content-type": "application/json" },
      };
      const result = PreviewProxyRequestSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.bodyChunks).toEqual([]);
      }
    });

    it("parses request with body chunks", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
        method: "POST",
        path: "/api/users",
        headers: { "content-type": "application/json" },
        bodyChunks: ["eyJuYW1lIjoiSm9obiJ9"], // base64
      };
      const result = PreviewProxyRequestSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.bodyChunks).toHaveLength(1);
      }
    });
  });

  describe("PreviewProxyResponseStartSchema", () => {
    it("parses a valid response start", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/html" },
        hasBody: true,
      };
      const result = PreviewProxyResponseStartSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("accepts boolean hasBody values", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
        status: 204,
        statusText: "No Content",
        headers: {},
        hasBody: false,
      };
      const result = PreviewProxyResponseStartSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasBody).toBe(false);
      }
    });
  });

  describe("PreviewProxyResponseBodySchema", () => {
    it("parses a response body chunk", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
        chunk: "PGh0bWw+...", // base64 encoded
      };
      const result = PreviewProxyResponseBodySchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe("PreviewProxyResponseEndSchema", () => {
    it("parses response end signal", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
      };
      const result = PreviewProxyResponseEndSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe("PreviewProxyResponseErrorSchema", () => {
    it("parses proxy error response", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
        message: "Connection refused",
      };
      const result = PreviewProxyResponseErrorSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe("PreviewWsConnectSchema", () => {
    it("parses ws connect without subprotocol", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
        path: "/ws/hmr",
        headers: { "upgrade": "websocket" },
      };
      const result = PreviewWsConnectSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("parses ws connect with optional subprotocol", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
        path: "/ws/chat",
        headers: { "upgrade": "websocket" },
        subprotocol: "chat-v1",
      };
      const result = PreviewWsConnectSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.subprotocol).toBe("chat-v1");
      }
    });
  });

  describe("PreviewWsFrameSchema", () => {
    it("defaults isBinary to false", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
        data: "Hello, WebSocket",
      };
      const result = PreviewWsFrameSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isBinary).toBe(false);
      }
    });

    it("accepts isBinary true for binary frames", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
        data: "YmluYXJ5IGRhdGE=", // base64
        isBinary: true,
      };
      const result = PreviewWsFrameSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isBinary).toBe(true);
      }
    });
  });

  describe("PreviewWsCloseSchema", () => {
    it("defaults code to 1000", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
      };
      const result = PreviewWsCloseSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.code).toBe(1000);
      }
    });

    it("accepts custom close code and reason", () => {
      const data = {
        tunnelId: "tun-1",
        requestId: "req-1",
        code: 1001,
        reason: "Going away",
      };
      const result = PreviewWsCloseSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.code).toBe(1001);
        expect(result.data.reason).toBe("Going away");
      }
    });
  });

  describe("AnnotationViewportSchema", () => {
    it("parses a complete viewport", () => {
      const data = {
        width: 1920,
        height: 1080,
        scrollX: 0,
        scrollY: 100,
        devicePixelRatio: 2,
      };
      const result = AnnotationViewportSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("accepts optional scroll and pixel ratio", () => {
      const data = {
        width: 800,
        height: 600,
      };
      const result = AnnotationViewportSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe("AnnotationRectSchema", () => {
    it("parses a rectangle", () => {
      const data = {
        x: 10,
        y: 20,
        width: 300,
        height: 150,
      };
      const result = AnnotationRectSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe("AnnotationTargetSchema", () => {
    it("parses a target element", () => {
      const data = {
        tag: "button",
        id: "submit-btn",
        className: "btn btn-primary",
        role: "button",
        text: "Submit",
        rect: { x: 100, y: 200, width: 80, height: 40 },
        rectRatio: { x: 0.05, y: 0.1, width: 0.04, height: 0.02 },
        selector: "button#submit-btn",
        xpath: "/html/body/button[1]",
        outerHTMLPreview: "<button id='submit-btn'>Submit</button>",
        attributes: { type: "button", class: "btn btn-primary" },
      };
      const result = AnnotationTargetSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("accepts minimal target with only required fields", () => {
      const data = {
        tag: "div",
        rect: { x: 0, y: 0, width: 100, height: 100 },
        selector: "div.container",
      };
      const result = AnnotationTargetSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe("AnnotationAncestorSchema", () => {
    it("parses an ancestor element", () => {
      const data = {
        tag: "form",
        id: "login-form",
        role: "form",
        selector: "form#login-form",
        text: "Login Form",
        attributes: { method: "post", action: "/login" },
      };
      const result = AnnotationAncestorSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("accepts minimal ancestor", () => {
      const data = {
        tag: "div",
        selector: "div.container",
      };
      const result = AnnotationAncestorSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe("VisualAnnotationAnchorSchema", () => {
    it("parses a full annotation anchor", () => {
      const data = {
        version: 1,
        page: {
          url: "https://example.com/app",
          pathname: "/app",
          title: "My App",
          viewport: { width: 1920, height: 1080 },
        },
        click: {
          clientX: 100,
          clientY: 200,
          pageX: 100,
          pageY: 300,
          viewportXRatio: 0.05,
          viewportYRatio: 0.15,
        },
        target: {
          tag: "button",
          rect: { x: 100, y: 200, width: 80, height: 40 },
          selector: "button.submit",
        },
        ancestors: [
          { tag: "form", selector: "form#myform" },
          { tag: "div", selector: "div.container" },
        ],
      };
      const result = VisualAnnotationAnchorSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("accepts optional nearbyText and style", () => {
      const data = {
        version: 1,
        page: {
          url: "https://example.com",
          pathname: "/",
          viewport: { width: 800, height: 600 },
        },
        click: {
          clientX: 50,
          clientY: 75,
        },
        target: {
          tag: "a",
          rect: { x: 50, y: 75, width: 100, height: 30 },
          selector: "a.link",
        },
        ancestors: [],
        nearbyText: {
          self: "Click here",
          parentSummary: "Navigation section",
          siblingTexts: ["Home", "About"],
        },
        style: {
          display: "block",
          color: "blue",
          backgroundColor: "white",
        },
      };
      const result = VisualAnnotationAnchorSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("rejects version !== 1", () => {
      const data = {
        version: 2,
        page: {
          url: "https://example.com",
          pathname: "/",
          viewport: { width: 800, height: 600 },
        },
        click: { clientX: 0, clientY: 0 },
        target: {
          tag: "div",
          rect: { x: 0, y: 0, width: 100, height: 100 },
          selector: "div",
        },
        ancestors: [],
      };
      expect(VisualAnnotationAnchorSchema.safeParse(data).success).toBe(false);
    });
  });

  describe("VisualAnnotationReportSchema", () => {
    it("parses a valid annotation report", () => {
      const data = {
        sessionId: "sess-1",
        commentId: "comment-1",
        body: "Please fix this button color",
        anchor: {
          version: 1,
          page: {
            url: "https://example.com/app",
            pathname: "/app",
            viewport: { width: 1920, height: 1080 },
          },
          click: { clientX: 100, clientY: 200 },
          target: {
            tag: "button",
            rect: { x: 100, y: 200, width: 80, height: 40 },
            selector: "button.primary",
          },
          ancestors: [],
        },
      };
      const result = VisualAnnotationReportSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe("ephemeral event schemas", () => {
    it("parses preview-candidate-reported event", () => {
      const data = {
        type: "preview-candidate-reported" as const,
        sessionId: "sess-1",
        candidate: {
          id: "cand-1",
          sessionId: "sess-1",
          state: "reported" as const,
          host: "localhost",
          port: 3000,
          reportedAt: Date.now(),
        },
      };
      const result = PreviewCandidateReportedEphemeralSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("parses preview-connection-updated with connection", () => {
      const data = {
        type: "preview-connection-updated" as const,
        sessionId: "sess-1",
        connection: {
          tunnelId: "tun-1",
          candidateId: "cand-1",
          sessionId: "sess-1",
          publicUrl: "https://tunnel.example.com",
          status: "active" as const,
          createdAt: Date.now(),
          leaseExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
          idleTimeoutMs: 45 * 60 * 1000,
          lastActiveAt: Date.now(),
        },
      };
      const result = PreviewConnectionUpdatedEphemeralSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("parses preview-connection-updated with null connection", () => {
      const data = {
        type: "preview-connection-updated" as const,
        sessionId: "sess-1",
        connection: null,
      };
      const result = PreviewConnectionUpdatedEphemeralSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe("resource limit constants", () => {
    it("has sensible resource limits", () => {
      expect(DEFAULT_PREVIEW_RESOURCE_LIMITS.maxRequestBodyBytes).toBe(10 * 1024 * 1024);
      expect(DEFAULT_PREVIEW_RESOURCE_LIMITS.maxResponseBodyBytes).toBe(100 * 1024 * 1024);
      expect(DEFAULT_PREVIEW_RESOURCE_LIMITS.maxRequestDurationMs).toBe(5 * 60 * 1000);
    });

    it("defaults match schema defaults", () => {
      const parsed = PreviewResourceLimitsSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual(DEFAULT_PREVIEW_RESOURCE_LIMITS);
      }
    });
  });

  describe("timeout and lease constants", () => {
    it("has expected lease timeout values", () => {
      expect(DEFAULT_PREVIEW_LEASE_MS).toBe(8 * 60 * 60 * 1000); // 8 hours
      expect(DEFAULT_PREVIEW_IDLE_TIMEOUT_MS).toBe(45 * 60 * 1000); // 45 minutes
    });

    it("has expected proxy chunk size", () => {
      expect(PREVIEW_PROXY_CHUNK_SIZE).toBe(32 * 1024); // 32 KB
    });
  });

  describe("report_preview MCP tool", () => {
    it("is listed in HAPPY_MCP_TOOL_NAMES", () => {
      expect(HAPPY_MCP_TOOL_NAMES).toContain("report_preview");
    });

    it("is auto-approved", () => {
      expect(HAPPY_MCP_AUTO_APPROVE_TOOL_NAMES).toContain("report_preview");
    });
  });
});
