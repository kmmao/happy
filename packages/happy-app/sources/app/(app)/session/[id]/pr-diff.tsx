/**
 * Full-screen PR diff review page (Phase 2B).
 *
 * Route: /session/{id}/pr-diff?owner={owner}&repo={repo}&number={n}
 * Opened from the in-conversation "Review PR diff" card when the agent's
 * output contains a GitHub PR URL.
 */
import * as React from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { PrDiffView } from "@/components/tools/PrDiffView";

export default React.memo(function PrDiffPage() {
    const { owner, repo, number } = useLocalSearchParams<{
        owner: string;
        repo: string;
        number: string;
    }>();
    const prNumber = Number.parseInt(number ?? "", 10);

    if (!owner || !repo || !Number.isFinite(prNumber)) {
        return <View style={styles.container} />;
    }

    return (
        <View style={styles.container}>
            <PrDiffView owner={owner} repo={repo} number={prNumber} />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
}));
