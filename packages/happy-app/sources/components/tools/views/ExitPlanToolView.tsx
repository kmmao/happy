import * as React from 'react';
import { ToolViewProps } from "./_all";
import { ToolSectionView } from '../../tools/ToolSectionView';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { knownTools } from '../../tools/knownTools';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { sessionGetPlanFileContent } from '@/sync/ops';
import { t } from '@/text';

export const ExitPlanToolView = React.memo<ToolViewProps>(({ tool, sessionId }) => {
    const { theme } = useUnistyles();
    const [planContent, setPlanContent] = React.useState<string | null>(null);
    const [planFilePath, setPlanFilePath] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);

    // Parse plan from tool input as fallback
    const parsed = knownTools.ExitPlanMode.input.safeParse(tool.input);
    const inputPlan = parsed.success ? (parsed.data.plan || null) : null;

    const displayPlan = planContent ?? inputPlan;

    const handleRefreshFromFile = React.useCallback(async () => {
        if (!sessionId) return;
        setIsLoading(true);
        try {
            const result = await sessionGetPlanFileContent(sessionId);
            if (result.content) {
                setPlanContent(result.content);
            }
            if (result.filePath) {
                setPlanFilePath(result.filePath);
            }
        } finally {
            setIsLoading(false);
        }
    }, [sessionId]);

    // Auto-fetch plan file content when tool input is empty
    React.useEffect(() => {
        if (!inputPlan && sessionId && !planContent) {
            handleRefreshFromFile();
        }
    }, [inputPlan, sessionId, planContent, handleRefreshFromFile]);

    return (
        <ToolSectionView>
            <View style={{ paddingHorizontal: 8, marginTop: -10 }}>
                {displayPlan ? (
                    <MarkdownView markdown={displayPlan!} />
                ) : (
                    <ActivityIndicator size="small" style={{ paddingVertical: 12 }} />
                )}
            </View>

            {/* Plan file actions */}
            {sessionId && (
                <View style={styles.actionsContainer}>
                    <Pressable
                        onPress={handleRefreshFromFile}
                        disabled={isLoading}
                        style={({ pressed }) => [
                            styles.refreshButton,
                            { backgroundColor: theme.colors.surfaceHighest },
                            pressed && { opacity: 0.7 },
                        ]}
                    >
                        {isLoading ? (
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        ) : (
                            <Text style={[styles.refreshButtonText, { color: theme.colors.textSecondary }]}>
                                {t('tools.planFile.refreshFromFile')}
                            </Text>
                        )}
                    </Pressable>

                    {planFilePath && (
                        <Text
                            style={[styles.filePathText, { color: theme.colors.textSecondary }]}
                            numberOfLines={1}
                            ellipsizeMode="middle"
                        >
                            {planFilePath}
                        </Text>
                    )}
                </View>
            )}
        </ToolSectionView>
    );
});

const styles = StyleSheet.create((_, rt) => ({
    actionsContainer: {
        paddingHorizontal: 8,
        paddingTop: 8,
        paddingBottom: 4,
        gap: 6,
    },
    refreshButton: {
        alignSelf: 'flex-start',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
    },
    refreshButtonText: {
        fontSize: 13,
    },
    filePathText: {
        fontSize: 11,
        fontFamily: 'monospace',
    },
}));
