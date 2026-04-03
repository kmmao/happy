import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/auth/AuthContext';
import type { AccountUsage } from './sub2apiTypes';
import { getConfig, fetchUsage } from './sub2apiApi';

interface Sub2ApiUsageState {
    data: AccountUsage[];
    loading: boolean;
    error: string | null;
    configured: boolean;
    refresh: () => void;
}

/**
 * Hook to fetch sub2api account usage via Happy Server proxy.
 * Server stores config and proxies requests to sub2api over Tailscale.
 */
export function useSub2ApiUsage(): Sub2ApiUsageState {
    const auth = useAuth();
    const [data, setData] = useState<AccountUsage[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [configured, setConfigured] = useState(false);
    const mountedRef = useRef(true);

    const doFetch = useCallback(async () => {
        if (!auth.credentials) return;

        setLoading(true);
        setError(null);

        try {
            const configStatus = await getConfig(auth.credentials);
            if (mountedRef.current) {
                setConfigured(configStatus.configured);
            }

            if (!configStatus.configured) {
                if (mountedRef.current) {
                    setData([]);
                    setLoading(false);
                }
                return;
            }

            const results = await fetchUsage(auth.credentials);
            if (mountedRef.current) {
                setData(results);
            }
        } catch (e: any) {
            if (mountedRef.current) {
                setError(e.message || 'Failed to fetch usage');
            }
        } finally {
            if (mountedRef.current) {
                setLoading(false);
            }
        }
    }, [auth.credentials]);

    useEffect(() => {
        mountedRef.current = true;
        doFetch();
        return () => { mountedRef.current = false; };
    }, [doFetch]);

    return { data, loading, error, configured, refresh: doFetch };
}
