import * as React from "react";
import { Pressable, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { parseGithubPrUrl } from "@/utils/parseGithubPrUrl";
import { t } from "@/text";

/**
 * In-conversation card that appears under an agent message containing a GitHub
 * PR URL (Phase 2B). Tapping it opens the full PR diff for on-device review —
 * the "review-driven" closing of the loop after `gh pr create`.
 *
 * Renders nothing when the text has no PR reference, so it is safe to drop
 * under every agent message.
 */
export const PrReviewCard = React.memo<{ text: string; sessionId: string }>(
    ({ text, sessionId }) => {
        const router = useRouter();
        const { theme } = useUnistyles();
        const pr = React.useMemo(() => parseGithubPrUrl(text), [text]);
        if (!pr) return null;

        return (
            <Pressable
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
                onPress={() =>
                    router.push(
                        `/session/${sessionId}/pr-diff?owner=${encodeURIComponent(pr.owner)}&repo=${encodeURIComponent(pr.repo)}&number=${pr.number}`,
                    )
                }
            >
                <Ionicons name="git-pull-request-outline" size={16} color={theme.colors.text} />
                <View style={styles.body}>
                    <Text style={styles.title} numberOfLines={1}>
                        {t("githubPr.reviewCard")}
                    </Text>
                    <Text style={styles.subtitle} numberOfLines={1}>
                        {pr.owner}/{pr.repo} #{pr.number}
                    </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
            </Pressable>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    card: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    body: {
        flex: 1,
    },
    title: {
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: "600",
    },
    subtitle: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 1,
    },
}));
