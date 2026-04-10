import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchSupervisorRun, type SupervisorRun } from "@/sync/apiSupervisor";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { layout } from "@/components/layout";
import { useProject } from "@/hooks/useProjects";

function ResearchReportScreen() {
    const { id, runId } = useLocalSearchParams<{ id: string; runId: string }>();
    const project = useProject(id);
    const navigation = useNavigation();
    const { theme } = useUnistyles();
    const [run, setRun] = React.useState<SupervisorRun | null>(null);
    const [loading, setLoading] = React.useState(true);
    const waitingForProject = Boolean(id && !project?.serverId);

    React.useEffect(() => {
        async function load() {
            if (waitingForProject) {
                return;
            }
            try {
                const credentials = await TokenStorage.getCredentials();
                const projectServerId = project?.serverId;
                if (!credentials || !projectServerId || !runId) return;
                const data = await fetchSupervisorRun(credentials, projectServerId, runId);
                setRun(data);
            } catch {
                // silent
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [id, project?.serverId, runId, waitingForProject]);

    React.useLayoutEffect(() => {
        if (run?.reportTitle) {
            navigation.setOptions({ headerTitle: run.reportTitle });
        } else {
            navigation.setOptions({
                headerTitle: t("competitorResearch.reportDetail"),
            });
        }
    }, [navigation, run]);

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator />
            </View>
        );
    }

    if (!run || !run.reportContent) {
        return (
            <View style={styles.center}>
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                    {t("competitorResearch.reportNotFound")}
                </Text>
            </View>
        );
    }

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.contentContainer}
        >
            <View style={styles.innerContainer}>
                <Text style={[styles.date, { color: theme.colors.textSecondary }]}>
                    {run.completedAt
                        ? new Date(run.completedAt).toLocaleString()
                        : ""}
                </Text>
                <MarkdownView markdown={run.reportContent} />
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        paddingBottom: 32,
    },
    innerContainer: {
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
        paddingHorizontal: 16,
        paddingTop: 12,
    },
    center: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: theme.colors.groupped.background,
    },
    date: {
        ...Typography.default(),
        fontSize: 12,
        marginBottom: 8,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 15,
    },
}));

export default React.memo(ResearchReportScreen);
