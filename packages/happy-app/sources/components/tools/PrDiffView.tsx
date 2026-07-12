import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    Pressable,
    ActivityIndicator,
    Platform,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { PrDiffResponse } from "@kmmao/happy-wire";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchPrDiff } from "@/sync/apiGithubPr";
import { useHappyAction } from "@/hooks/useHappyAction";
import { t } from "@/text";
import { log } from "@/log";

interface PrDiffViewProps {
    owner: string;
    repo: string;
    number: number;
}

/** Colorize a unified-diff line by its leading marker. */
function DiffLine({ line }: { line: string }) {
    let kind: "add" | "del" | "hunk" | "meta" | "ctx" = "ctx";
    if (line.startsWith("+") && !line.startsWith("+++")) kind = "add";
    else if (line.startsWith("-") && !line.startsWith("---")) kind = "del";
    else if (line.startsWith("@@")) kind = "hunk";
    else if (
        line.startsWith("diff ") ||
        line.startsWith("index ") ||
        line.startsWith("+++") ||
        line.startsWith("---")
    )
        kind = "meta";
    return <Text style={[styles.diffLine, styles[kind]]}>{line || " "}</Text>;
}

/**
 * Renders a pull request's diff for on-device review (Phase 2B). Fetches lazily
 * on mount via the Server (which holds the GitHub token).
 */
export const PrDiffView = React.memo<PrDiffViewProps>(({ owner, repo, number }) => {
    const [data, setData] = React.useState<PrDiffResponse | null>(null);
    // Distinguishes "not fetched yet" from "fetched and failed" so we never
    // flash the failure UI before the first attempt has completed.
    const [failed, setFailed] = React.useState(false);

    const [loading, load] = useHappyAction(async () => {
        setFailed(false);
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) {
            setFailed(true);
            return;
        }
        try {
            const res = await fetchPrDiff(credentials, { owner, repo, number });
            setData(res);
        } catch (e) {
            log.error("Failed to load PR diff:", e);
            setFailed(true);
            throw e;
        }
    });

    React.useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [owner, repo, number]);

    if (!data && !failed) {
        return (
            <View style={styles.center}>
                <ActivityIndicator />
            </View>
        );
    }

    if (!data) {
        return (
            <View style={styles.center}>
                <Text style={styles.muted}>{t("githubPr.loadFailed")}</Text>
                <Pressable onPress={() => load()} style={styles.retry} disabled={loading}>
                    <Text style={styles.retryText}>{t("common.retry")}</Text>
                </Pressable>
            </View>
        );
    }

    const lines = data.diff.split("\n");

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title} numberOfLines={2}>
                    #{data.number} · {data.title}
                </Text>
                <Text style={styles.subtitle}>
                    {data.draft ? t("githubPr.draft") : data.state} ·{" "}
                    {t("githubPr.filesCount", { count: data.files.length })}
                </Text>
            </View>
            <ScrollView horizontal>
                <ScrollView style={styles.diffScroll}>
                    {lines.map((line, i) => (
                        <DiffLine key={i} line={line} />
                    ))}
                    {data.truncated ? (
                        <Text style={[styles.diffLine, styles.meta]}>
                            {t("githubPr.truncated")}
                        </Text>
                    ) : null}
                </ScrollView>
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    center: {
        padding: 24,
        alignItems: "center",
        gap: 8,
    },
    muted: {
        color: theme.colors.textSecondary,
    },
    retry: {
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    retryText: {
        color: theme.colors.text,
        fontWeight: "600",
    },
    header: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    title: {
        color: theme.colors.text,
        fontSize: 15,
        fontWeight: "600",
    },
    subtitle: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 2,
    },
    diffScroll: {
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
    diffLine: {
        fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
        fontSize: 11,
        lineHeight: 15,
    },
    add: {
        color: theme.colors.success,
    },
    del: {
        color: theme.colors.permissionButton.deny.background,
    },
    hunk: {
        color: theme.colors.textSecondary,
        fontWeight: "600",
    },
    meta: {
        color: theme.colors.textSecondary,
    },
    ctx: {
        color: theme.colors.text,
    },
}));
