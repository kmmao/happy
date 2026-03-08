import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify GitHub webhook signature (HMAC-SHA256).
 * Header: x-hub-signature-256 = "sha256=<hex>"
 */
export function verifyGitHubSignature(
    secret: string,
    rawBody: string,
    signature: string,
): boolean {
    if (!signature.startsWith("sha256=")) return false;
    const expected = Buffer.from(
        "sha256=" +
            createHmac("sha256", secret).update(rawBody).digest("hex"),
    );
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
}

/**
 * Verify Gitea webhook signature (HMAC-SHA256).
 * Header: x-gitea-signature = "<hex>"
 */
export function verifyGiteaSignature(
    secret: string,
    rawBody: string,
    signature: string,
): boolean {
    const expected = Buffer.from(
        createHmac("sha256", secret).update(rawBody).digest("hex"),
    );
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
}

/**
 * Verify GitLab webhook token (direct comparison).
 * Header: x-gitlab-token = "<token>"
 */
export function verifyGitLabToken(secret: string, token: string): boolean {
    const expected = Buffer.from(secret);
    const actual = Buffer.from(token);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
}

/**
 * Verify webhook signature for any supported provider.
 */
export function verifyWebhookSignature(
    provider: string,
    secret: string,
    rawBody: string,
    headers: Record<string, string | undefined>,
): boolean {
    switch (provider) {
        case "github": {
            const sig = headers["x-hub-signature-256"];
            if (!sig) return false;
            return verifyGitHubSignature(secret, rawBody, sig);
        }
        case "gitea": {
            const sig = headers["x-gitea-signature"];
            if (!sig) return false;
            return verifyGiteaSignature(secret, rawBody, sig);
        }
        case "gitlab": {
            const token = headers["x-gitlab-token"];
            if (!token) return false;
            return verifyGitLabToken(secret, token);
        }
        default:
            return false;
    }
}
