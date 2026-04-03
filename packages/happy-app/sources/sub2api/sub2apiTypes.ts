/** Window statistics for a usage period */
export interface WindowStats {
    requests: number;
    tokens: number;
    cost: number;
    standard_cost?: number;
    user_cost?: number;
}

/** Usage progress for a single time window */
export interface UsageProgress {
    utilization: number;
    resets_at?: string;
    remaining_seconds: number;
    window_stats?: WindowStats;
}

/** Full usage info response from /api/v1/admin/accounts/:id/usage */
export interface UsageInfo {
    updated_at?: string;
    five_hour?: UsageProgress;
    seven_day?: UsageProgress;
    seven_day_sonnet?: UsageProgress;
}

/** Account summary from /api/v1/admin/accounts */
export interface AccountSummary {
    id: number;
    name: string;
    platform: string;
    type: string;
    status: string;
}

/** Login response from /api/v1/auth/login */
export interface LoginResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    user: {
        id: number;
        email: string;
        role: string;
    };
}

/** Config stored in MMKV */
export interface Sub2ApiConfig {
    baseUrl: string;
    email: string;
    password: string;
}

/** Per-account usage with account info */
export interface AccountUsage {
    account: AccountSummary;
    usage: UsageInfo;
}
