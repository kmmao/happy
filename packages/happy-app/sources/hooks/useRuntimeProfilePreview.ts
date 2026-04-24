import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { t } from "@/text";
import {
    fetchRuntimeProfilePreview,
    type RuntimeProfilePreviewPurpose,
    type RuntimeProfilePreviewResult,
} from "@/sync/apiRuntimeProfilePreview";

/**
 * Query the server's runtime-profile preview endpoint for a given project +
 * purpose. Returns the latest resolution result (or null while loading /
 * when inputs are incomplete).
 *
 * `refreshKey` lets callers manually trigger a re-fetch after saving a
 * profile change — pass a ref-counted number that increments on save.
 */
export function useRuntimeProfilePreview(
    projectId: string | null | undefined,
    purpose: RuntimeProfilePreviewPurpose,
    refreshKey: number = 0,
): RuntimeProfilePreviewResult | null {
    const [result, setResult] = React.useState<RuntimeProfilePreviewResult | null>(null);

    React.useEffect(() => {
        if (!projectId) {
            setResult(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || cancelled) return;
                const data = await fetchRuntimeProfilePreview(credentials, projectId, purpose);
                if (!cancelled) setResult(data);
            } catch {
                // Preview is best-effort; UI shows nothing on transient failure
                if (!cancelled) setResult(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [projectId, purpose, refreshKey]);

    return result;
}

/**
 * Wrapper around useRuntimeProfilePreview that returns a ready-to-render
 * "Effective: <name> (<source>)" label — localized through the t() text
 * pipeline. Returns undefined while loading, on preview failure, or when
 * projectId is missing.
 */
export function useRuntimeProfileEffectiveLabel(
    projectId: string | null | undefined,
    purpose: RuntimeProfilePreviewPurpose,
    refreshKey: number = 0,
): string | undefined {
    const result = useRuntimeProfilePreview(projectId, purpose, refreshKey);
    return React.useMemo(() => {
        if (!result || !result.ok) return undefined;
        const name = result.profileName ?? result.profileId;
        const source = result.profileSource === "explicit"
            ? t("triggers.profileSourceExplicit")
            : t("triggers.profileSourceProjectDefault");
        return t("triggers.profileEffective", { name, source });
    }, [result]);
}

export interface RuntimeProfileEffective {
    label: string;
    isProjectDefault: boolean;
}

/**
 * Same as useRuntimeProfileEffectiveLabel but also exposes whether the
 * resolution came from the project's default (vs an explicit binding on
 * the triggering record). Consumers use this to decide whether the
 * effective label should be tap-to-navigate — tapping only makes sense
 * when the user would want to change the project default.
 */
export function useRuntimeProfileEffective(
    projectId: string | null | undefined,
    purpose: RuntimeProfilePreviewPurpose,
    refreshKey: number = 0,
): RuntimeProfileEffective | null {
    const result = useRuntimeProfilePreview(projectId, purpose, refreshKey);
    return React.useMemo(() => {
        if (!result || !result.ok) return null;
        const name = result.profileName ?? result.profileId;
        const isProjectDefault = result.profileSource === "project-default";
        const source = isProjectDefault
            ? t("triggers.profileSourceProjectDefault")
            : t("triggers.profileSourceExplicit");
        return {
            label: t("triggers.profileEffective", { name, source }),
            isProjectDefault,
        };
    }, [result]);
}
