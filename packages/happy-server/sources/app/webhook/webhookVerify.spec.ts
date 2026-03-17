import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
    verifyGitHubSignature,
    verifyGiteaSignature,
    verifyGitLabToken,
    verifyWebhookSignature,
} from "./webhookVerify";

describe("verifyGitHubSignature", () => {
    const secret = "test-secret";
    const body = '{"action":"opened"}';

    function makeSignature(s: string, b: string): string {
        return "sha256=" + createHmac("sha256", s).update(b).digest("hex");
    }

    it("should verify a valid signature", () => {
        const sig = makeSignature(secret, body);
        expect(verifyGitHubSignature(secret, body, sig)).toBe(true);
    });

    it("should reject an invalid signature", () => {
        const sig = makeSignature("wrong-secret", body);
        expect(verifyGitHubSignature(secret, body, sig)).toBe(false);
    });

    it("should reject signature without sha256= prefix", () => {
        const hex = createHmac("sha256", secret).update(body).digest("hex");
        expect(verifyGitHubSignature(secret, body, hex)).toBe(false);
    });

    it("should reject empty signature", () => {
        expect(verifyGitHubSignature(secret, body, "")).toBe(false);
    });

    it("should reject signature with wrong length", () => {
        expect(verifyGitHubSignature(secret, body, "sha256=abc")).toBe(false);
    });
});

describe("verifyGiteaSignature", () => {
    const secret = "gitea-secret";
    const body = '{"ref":"refs/heads/main"}';

    function makeSignature(s: string, b: string): string {
        return createHmac("sha256", s).update(b).digest("hex");
    }

    it("should verify a valid signature", () => {
        const sig = makeSignature(secret, body);
        expect(verifyGiteaSignature(secret, body, sig)).toBe(true);
    });

    it("should reject an invalid signature", () => {
        const sig = makeSignature("wrong-secret", body);
        expect(verifyGiteaSignature(secret, body, sig)).toBe(false);
    });

    it("should reject signature with wrong length", () => {
        expect(verifyGiteaSignature(secret, body, "abc")).toBe(false);
    });
});

describe("verifyGitLabToken", () => {
    it("should verify matching token", () => {
        expect(verifyGitLabToken("my-token", "my-token")).toBe(true);
    });

    it("should reject non-matching token", () => {
        expect(verifyGitLabToken("my-token", "wrong-token")).toBe(false);
    });

    it("should reject token with different length", () => {
        expect(verifyGitLabToken("short", "a-longer-token")).toBe(false);
    });
});

describe("verifyWebhookSignature", () => {
    const secret = "webhook-secret";
    const body = '{"test":true}';

    function makeGitHubSig(s: string, b: string): string {
        return "sha256=" + createHmac("sha256", s).update(b).digest("hex");
    }

    function makeGiteaSig(s: string, b: string): string {
        return createHmac("sha256", s).update(b).digest("hex");
    }

    it("should verify GitHub webhook with correct header", () => {
        const sig = makeGitHubSig(secret, body);
        expect(
            verifyWebhookSignature("github", secret, body, {
                "x-hub-signature-256": sig,
            }),
        ).toBe(true);
    });

    it("should reject GitHub webhook without signature header", () => {
        expect(
            verifyWebhookSignature("github", secret, body, {}),
        ).toBe(false);
    });

    it("should verify Gitea webhook with correct header", () => {
        const sig = makeGiteaSig(secret, body);
        expect(
            verifyWebhookSignature("gitea", secret, body, {
                "x-gitea-signature": sig,
            }),
        ).toBe(true);
    });

    it("should reject Gitea webhook without signature header", () => {
        expect(
            verifyWebhookSignature("gitea", secret, body, {}),
        ).toBe(false);
    });

    it("should verify GitLab webhook with correct token", () => {
        expect(
            verifyWebhookSignature("gitlab", secret, body, {
                "x-gitlab-token": secret,
            }),
        ).toBe(true);
    });

    it("should reject GitLab webhook without token header", () => {
        expect(
            verifyWebhookSignature("gitlab", secret, body, {}),
        ).toBe(false);
    });

    it("should reject unknown provider", () => {
        expect(
            verifyWebhookSignature("bitbucket", secret, body, {}),
        ).toBe(false);
    });
});
