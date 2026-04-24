import * as React from "react";
import { Item } from "@/components/Item";
import { t } from "@/text";
import { fetchBinaryVersion } from "@/sync/apiClaudeControl";
import { log } from "@/log";

interface BinaryVersionRowProps {
    sessionId: string;
}

/**
 * Settings-row widget that displays the remote Claude Code binary version
 * and the happy-cli package version controlling it. One-shot fetch on
 * mount with silent error fallback — the remote CLI reports "unknown"
 * via its own API when the SDK `initializationResult()` is not ready.
 */
export const BinaryVersionRow = React.memo(function BinaryVersionRow({
    sessionId,
}: BinaryVersionRowProps) {
    const [version, setVersion] = React.useState<string | null>(null);
    const [happyCli, setHappyCli] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        fetchBinaryVersion(sessionId)
            .then((res) => {
                if (cancelled) return;
                setVersion(res.version || null);
                setHappyCli(res.happyCliVersion || null);
            })
            .catch((e) => {
                log.log("[BinaryVersionRow] fetch failed", e);
                if (!cancelled) setVersion(null);
            });
        return () => {
            cancelled = true;
        };
    }, [sessionId]);

    const detail = version ?? t("claudeControl.version.unknown");
    const subtitle = happyCli
        ? `${t("claudeControl.version.happyCli")} ${happyCli}`
        : undefined;

    return (
        <Item
            title={t("claudeControl.version.remoteCli")}
            subtitle={subtitle}
            detail={detail}
        />
    );
});
