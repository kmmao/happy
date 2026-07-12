import { AuthCredentials } from "@/auth/tokenStorage";
import { apiRequest } from "./apiRequest";
import type { PrDiffResponse } from "@kmmao/happy-wire";

/**
 * Fetch a pull request's diff for on-device review (Phase 2B). The Server holds
 * the GitHub token and returns metadata + unified diff.
 */
export async function fetchPrDiff(
    credentials: AuthCredentials,
    input: { owner: string; repo: string; number: number },
): Promise<PrDiffResponse> {
    return await apiRequest<PrDiffResponse>(credentials, "/v1/github/pr-diff", {
        query: {
            owner: input.owner,
            repo: input.repo,
            number: input.number,
        },
        errorMessage: "Failed to fetch PR diff",
    });
}
