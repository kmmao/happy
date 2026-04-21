import * as React from "react";
import type { AuthCredentials } from "@/auth/tokenStorage";
import { TokenStorage } from "@/auth/tokenStorage";
import { t } from "@/text";
import { getErrorMessage } from "@/utils/errors";

interface UseProjectScopedAsyncDataParams<TData> {
    readonly projectServerId: string | null | undefined;
    readonly isActive: boolean;
    readonly createEmptyData: () => TData;
    readonly load: (
        credentials: AuthCredentials,
        projectServerId: string,
    ) => Promise<TData>;
}

interface UseProjectScopedAsyncDataResult<TData> {
    readonly data: TData;
    readonly setData: React.Dispatch<React.SetStateAction<TData>>;
    readonly loading: boolean;
    readonly error: string | null;
    readonly refresh: () => Promise<void>;
}

export function useProjectScopedAsyncData<TData>({
    projectServerId,
    isActive,
    createEmptyData,
    load,
}: UseProjectScopedAsyncDataParams<TData>): UseProjectScopedAsyncDataResult<TData> {
    const [data, setData] = React.useState<TData>(() => createEmptyData());
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const mountedRef = React.useRef(true);
    const latestRequestTokenRef = React.useRef(0);
    const latestProjectIdRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        return () => { mountedRef.current = false; };
    }, []);

    React.useEffect(() => {
        if (!projectServerId) {
            latestRequestTokenRef.current += 1;
            latestProjectIdRef.current = null;
            setData(createEmptyData());
            setLoading(false);
            setError(null);
            return;
        }

        if (latestProjectIdRef.current !== projectServerId) {
            latestRequestTokenRef.current += 1;
            latestProjectIdRef.current = projectServerId;
            setData(createEmptyData());
            setLoading(false);
            setError(null);
        }
    }, [createEmptyData, projectServerId]);

    const refresh = React.useCallback(async () => {
        if (!projectServerId) return;

        const requestToken = latestRequestTokenRef.current + 1;
        latestRequestTokenRef.current = requestToken;
        setLoading(true);
        setError(null);

        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) {
                throw new Error(t("errors.authenticationFailed"));
            }

            const nextData = await load(credentials, projectServerId);
            if (!mountedRef.current || requestToken !== latestRequestTokenRef.current) {
                return;
            }

            setData(nextData);
        } catch (loadFailure) {
            if (!mountedRef.current || requestToken !== latestRequestTokenRef.current) {
                return;
            }

            setError(getErrorMessage(loadFailure, t("common.error")));
        } finally {
            if (!mountedRef.current || requestToken !== latestRequestTokenRef.current) {
                return;
            }

            setLoading(false);
        }
    }, [load, projectServerId]);

    React.useEffect(() => {
        if (!isActive) return;
        void refresh();
    }, [isActive, refresh]);

    return {
        data,
        setData,
        loading,
        error,
        refresh,
    };
}
