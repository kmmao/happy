import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { decryptString } from "@/modules/encrypt";
import { log } from "@/utils/log";
import { PrDiffRequestSchema, type PrDiffResponse } from "@kmmao/happy-wire";

/** Cap the diff payload so a huge PR can't blow up the mobile client. */
const MAX_DIFF_BYTES = 512 * 1024;

/**
 * Resolve the connected GitHub OAuth token for an account. The token is stored
 * encrypted on the shared GithubUser row, keyed by the account that connected
 * it — so we decrypt with that same account id.
 */
async function getAccountGithubToken(accountId: string): Promise<string | null> {
    const account = await db.account.findUnique({
        where: { id: accountId },
        select: { githubUserId: true },
    });
    if (!account?.githubUserId) return null;
    const githubUser = await db.githubUser.findUnique({
        where: { id: account.githubUserId },
        select: { token: true },
    });
    if (!githubUser?.token) return null;
    try {
        return decryptString(["user", accountId, "github", "token"], githubUser.token);
    } catch (error) {
        log({ module: "github-pr" }, `Failed to decrypt GitHub token: ${error}`);
        return null;
    }
}

/**
 * GitHub PR diff route (Phase 2B). Fetches a pull request's metadata + unified
 * diff using the account's own GitHub token and returns it for on-device
 * review. The token never leaves the server.
 */
export function githubPrRoutes(app: Fastify) {
    app.get(
        "/v1/github/pr-diff",
        {
            preHandler: app.authenticate,
            schema: { querystring: PrDiffRequestSchema },
        },
        async (request, reply) => {
            const { owner, repo, number } = request.query;

            const token = await getAccountGithubToken(request.userId);
            if (!token) {
                return reply.code(400).send({ error: "github_not_connected" });
            }

            const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`;
            const headers = {
                Authorization: `Bearer ${token}`,
                "User-Agent": "happy-server",
                "X-GitHub-Api-Version": "2022-11-28",
            };

            // Metadata (JSON) + unified diff (diff media type) in parallel.
            const [metaRes, diffRes, filesRes] = await Promise.all([
                fetch(base, { headers: { ...headers, Accept: "application/vnd.github+json" } }),
                fetch(base, { headers: { ...headers, Accept: "application/vnd.github.v3.diff" } }),
                fetch(`${base}/files?per_page=100`, {
                    headers: { ...headers, Accept: "application/vnd.github+json" },
                }),
            ]);

            if (!metaRes.ok) {
                if (metaRes.status === 404) {
                    return reply.code(404).send({ error: "pr_not_found" });
                }
                log({ module: "github-pr" }, `PR meta fetch failed: ${metaRes.status}`);
                return reply.code(502).send({ error: "github_error", status: metaRes.status });
            }

            const meta = (await metaRes.json()) as {
                number: number;
                title: string;
                state: string;
                draft?: boolean;
                html_url: string;
            };

            let diff = diffRes.ok ? await diffRes.text() : "";
            let truncated = false;
            if (Buffer.byteLength(diff, "utf8") > MAX_DIFF_BYTES) {
                diff = diff.slice(0, MAX_DIFF_BYTES);
                truncated = true;
            }

            const filesJson = filesRes.ok
                ? ((await filesRes.json()) as Array<{
                      filename: string;
                      status: string;
                      additions: number;
                      deletions: number;
                  }>)
                : [];

            const response: PrDiffResponse = {
                number: meta.number,
                title: meta.title,
                state: meta.state,
                draft: meta.draft ?? false,
                url: meta.html_url,
                diff,
                truncated,
                files: filesJson.map((f) => ({
                    filename: f.filename,
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                })),
            };
            return reply.send(response);
        },
    );
}
