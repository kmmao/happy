import * as React from "react";
import { View, Text, AppState, type AppStateStatus } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import { fetchSessionCost } from "@/sync/apiClaudeControl";
import { log } from "@/log";

interface CostBadgeProps {
    sessionId: string;
    /** When true, renders as a compact `$X.XX` chip. */
    compact?: boolean;
}

/**
 * Inline badge showing the remote session's running USD cost. Refreshes
 * every 60s while the app is in the foreground; pauses while backgrounded
 * to avoid quiet battery drain and unnecessary E2E RPC traffic.
 */
export const CostBadge = React.memo(function CostBadge({
    sessionId,
    compact = false,
}: CostBadgeProps) {
    const [totalUsd, setTotalUsd] = React.useState<number | null>(null);
    const [error, setError] = React.useState(false);
    const appStateRef = React.useRef<AppStateStatus>(AppState.currentState);

    const refresh = React.useCallback(async () => {
        try {
            const res = await fetchSessionCost(sessionId);
            setTotalUsd(res.totalUsd);
            setError(false);
        } catch (e) {
            log.log("[CostBadge] fetch failed", e);
            setError(true);
        }
    }, [sessionId]);

    React.useEffect(() => {
        refresh();
        const interval = setInterval(() => {
            if (appStateRef.current === "active") refresh();
        }, 60_000);
        const sub = AppState.addEventListener("change", (next) => {
            appStateRef.current = next;
            if (next === "active") refresh();
        });
        return () => {
            clearInterval(interval);
            sub.remove();
        };
    }, [refresh]);

    if (error && totalUsd === null) {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText} numberOfLines={1}>
                    {t("claudeControl.cost.error")}
                </Text>
            </View>
        );
    }
    if (totalUsd === null) {
        return (
            <View style={styles.container}>
                <Text style={styles.mutedText} numberOfLines={1}>
                    {t("claudeControl.cost.loading")}
                </Text>
            </View>
        );
    }

    const formatted = compact ? `$${totalUsd.toFixed(2)}` : `$${totalUsd.toFixed(4)}`;
    return (
        <View style={styles.container}>
            {!compact && (
                <Text style={styles.labelText} numberOfLines={1}>
                    {t("claudeControl.cost.label")}
                </Text>
            )}
            <Text style={styles.valueText} numberOfLines={1}>
                {formatted}
            </Text>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingVertical: 4,
        gap: 6,
    },
    labelText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    valueText: {
        fontSize: 13,
        fontWeight: "600",
        color: theme.colors.text,
    },
    mutedText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    errorText: {
        fontSize: 12,
        color: theme.colors.textDestructive,
    },
}));
