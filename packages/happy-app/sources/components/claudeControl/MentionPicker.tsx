import * as React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import { fetchFileSuggestions } from "@/sync/apiClaudeControl";
import type { FileSuggestionsResponse } from "@kmmao/happy-wire";
import { log } from "@/log";

interface MentionPickerProps {
    sessionId: string;
    query: string;
    onSelect: (path: string) => void;
    /** Max suggestions; defaults to 20. CLI hard-caps 50. */
    limit?: number;
}

type Suggestion = FileSuggestionsResponse["suggestions"][number];

/**
 * Floating list of remote-file suggestions, driven by a 300ms-debounced
 * `fetchFileSuggestions` call. Intended to render above the message
 * composer when the user types `@<partial>`. No keyboard navigation yet —
 * add when integrated into the composer for web/desktop.
 */
export const MentionPicker = React.memo(function MentionPicker({
    sessionId,
    query,
    onSelect,
    limit = 20,
}: MentionPickerProps) {
    const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
    const [loading, setLoading] = React.useState(false);

    React.useEffect(() => {
        const trimmed = query.trim();
        if (!trimmed) {
            setSuggestions([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        let cancelled = false;
        const handle = setTimeout(() => {
            fetchFileSuggestions(sessionId, trimmed, limit)
                .then((res) => {
                    if (cancelled) return;
                    setSuggestions(res.suggestions);
                    setLoading(false);
                })
                .catch((e) => {
                    log.log("[MentionPicker] file_suggestions failed", e);
                    if (!cancelled) {
                        setSuggestions([]);
                        setLoading(false);
                    }
                });
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [sessionId, query, limit]);

    if (!query.trim()) {
        return null;
    }

    return (
        <View style={styles.container}>
            {loading && suggestions.length === 0 && (
                <View style={styles.row}>
                    <ActivityIndicator size="small" />
                    <Text style={styles.muted}>
                        {t("claudeControl.mention.searching")}
                    </Text>
                </View>
            )}
            {!loading && suggestions.length === 0 && (
                <View style={styles.row}>
                    <Text style={styles.muted}>
                        {t("claudeControl.mention.noResults")}
                    </Text>
                </View>
            )}
            {suggestions.map((s) => (
                <Pressable
                    key={`${s.type}:${s.path}`}
                    onPress={() => onSelect(s.path)}
                    style={({ pressed }) => [
                        styles.row,
                        pressed && styles.rowPressed,
                    ]}
                >
                    <Text style={styles.icon}>
                        {s.type === "directory" ? "📁" : "📄"}
                    </Text>
                    <Text style={styles.path} numberOfLines={1} ellipsizeMode="middle">
                        {s.path}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.primary,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        paddingVertical: 4,
        maxHeight: 260,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    rowPressed: {
        backgroundColor: theme.colors.divider,
    },
    icon: {
        fontSize: 16,
    },
    path: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.text,
    },
    muted: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
}));
