import * as React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { ToolSectionView } from '../ToolSectionView';
import { ToolDiffView } from '@/components/tools/ToolDiffView';
import { Metadata } from '@/sync/storageTypes';
import { useSetting } from '@/sync/storage';
import { t } from '@/text';
import { DiffStatsBar } from '@/components/diff/DiffStatsBar';
import { getCodexDiffStats, parseCodexUnifiedDiff } from '../codexDiffUtils';

interface CodexDiffViewProps {
    tool: ToolCall;
    metadata: Metadata | null;
    scrollViewRef?: React.RefObject<ScrollView | null>;
}

export const CodexDiffView = React.memo<CodexDiffViewProps>(({ tool, metadata, scrollViewRef }) => {
    const { theme } = useUnistyles();
    const showLineNumbersInToolViews = useSetting('showLineNumbersInToolViews');
    const { input } = tool;

    // Parse the unified diff
    let oldText = '';
    let newText = '';
    let fileName: string | undefined;

    if (input?.unified_diff && typeof input.unified_diff === 'string') {
        const parsed = parseCodexUnifiedDiff(input.unified_diff);
        oldText = parsed.oldText;
        newText = parsed.newText;
        fileName = parsed.fileName;
    }

    const diffStats = React.useMemo(
        () => (input?.unified_diff && typeof input.unified_diff === 'string'
            ? getCodexDiffStats(input.unified_diff) ?? { additions: 0, deletions: 0 }
            : { additions: 0, deletions: 0 }),
        [input?.unified_diff],
    );
    const isFullView = !!scrollViewRef;
    const [expanded, setExpanded] = React.useState(isFullView);

    React.useEffect(() => {
        setExpanded(isFullView);
    }, [isFullView, tool.createdAt]);

    return (
        <ToolSectionView fullWidth>
            <View
                style={[
                    styles.card,
                    {
                        backgroundColor: theme.colors.surfaceHigh,
                        borderColor: expanded ? theme.colors.diff.outline : theme.colors.divider,
                    },
                ]}
            >
                <Pressable style={styles.cardHeader} onPress={() => setExpanded((v) => !v)}>
                    <View style={styles.cardHeaderLeft}>
                        <View
                            style={[
                                styles.fileIconWrap,
                                { backgroundColor: theme.colors.surfaceHighest },
                            ]}
                        >
                            <Ionicons
                                name="git-compare-outline"
                                size={18}
                                color={theme.colors.text}
                            />
                        </View>
                        <View style={styles.fileMeta}>
                            <Text style={styles.fileName} numberOfLines={1}>
                                {fileName || t('tools.names.viewDiff')}
                            </Text>
                            {fileName ? (
                                <Text
                                    style={styles.filePath}
                                    numberOfLines={isFullView ? 2 : 1}
                                >
                                    {fileName}
                                </Text>
                            ) : null}
                        </View>
                    </View>
                    <View style={styles.cardHeaderRight}>
                        <DiffStatsBar
                            additions={diffStats.additions}
                            deletions={diffStats.deletions}
                        />
                        <Ionicons
                            name={expanded ? 'chevron-down' : 'chevron-forward'}
                            size={16}
                            color={theme.colors.textSecondary}
                        />
                    </View>
                </Pressable>
                {expanded && (
                    <View
                        style={[
                            styles.diffWrap,
                            { borderTopColor: theme.colors.divider },
                        ]}
                    >
                        <ToolDiffView 
                            oldText={oldText} 
                            newText={newText} 
                            showLineNumbers={showLineNumbersInToolViews}
                            showPlusMinusSymbols={showLineNumbersInToolViews}
                        />
                    </View>
                )}
            </View>
        </ToolSectionView>
    );
});

const styles = StyleSheet.create((theme) => ({
    card: {
        borderWidth: 1,
        borderRadius: 16,
        overflow: 'hidden',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    cardHeaderLeft: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    cardHeaderRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    fileIconWrap: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fileMeta: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    fileName: {
        fontSize: 15,
        fontWeight: '700',
        color: theme.colors.text,
    },
    filePath: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    diffWrap: {
        borderTopWidth: 1,
        paddingTop: 8,
    },
}));
