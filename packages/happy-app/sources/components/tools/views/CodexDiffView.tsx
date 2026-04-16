import * as React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { ToolSectionView } from '../ToolSectionView';
import { ToolDiffView } from '@/components/tools/ToolDiffView';
import { useSetting } from '@/sync/storage';
import { t } from '@/text';
import { DiffStatsBar } from '@/components/diff/DiffStatsBar';
import { getCodexDiffStats, parseCodexUnifiedDiff } from '../codexDiffUtils';
import { Metadata } from '@/sync/storageTypes';

interface CodexDiffViewProps {
    tool: ToolCall;
    metadata?: Metadata | null;
    scrollViewRef?: React.RefObject<ScrollView | null>;
}

function formatToolDuration(tool: ToolCall): string | null {
    if (tool.createdAt == null || tool.completedAt == null) {
        return null;
    }
    const seconds = (tool.completedAt - tool.createdAt) / 1000;
    if (seconds < 1) {
        return `${Math.round(seconds * 1000)}ms`;
    }
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
    }
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export const CodexDiffView = React.memo<CodexDiffViewProps>(({ tool, scrollViewRef }) => {
    const { theme } = useUnistyles();
    const showLineNumbersInToolViews = useSetting('showLineNumbersInToolViews');
    const { input } = tool;

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
    const durationText = React.useMemo(() => formatToolDuration(tool), [tool]);
    const [expanded, setExpanded] = React.useState(isFullView);
    const displayName = fileName ? (fileName.split('/').pop() || fileName) : t('tools.names.viewDiff');
    const showPath = !!fileName && fileName !== displayName;

    React.useEffect(() => {
        setExpanded(isFullView);
    }, [isFullView, tool.createdAt]);

    return (
        <ToolSectionView fullWidth>
            <View style={styles.item}>
                <Pressable style={styles.cardHeader} onPress={() => setExpanded((v) => !v)}>
                    <View style={styles.cardHeaderLeft}>
                        <View style={styles.fileIconWrap}>
                            <Ionicons
                                name="git-compare-outline"
                                size={18}
                                color={theme.colors.text}
                            />
                        </View>
                        <View style={styles.fileMeta}>
                            <Text style={styles.fileName} numberOfLines={1}>
                                {displayName}
                            </Text>
                            {showPath && (
                                <Text style={styles.filePath} numberOfLines={1}>
                                    {fileName}
                                </Text>
                            )}
                        </View>
                    </View>
                    <View style={styles.cardHeaderRight}>
                        <DiffStatsBar
                            additions={diffStats.additions}
                            deletions={diffStats.deletions}
                        />
                        {!isFullView && durationText && (
                            <Text style={styles.durationText}>{durationText}</Text>
                        )}
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
                            visibleLineCount={isFullView ? undefined : 5}
                        />
                    </View>
                )}
            </View>
        </ToolSectionView>
    );
});

const styles = StyleSheet.create((theme) => ({
    item: {
        overflow: 'hidden',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
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
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fileMeta: {
        flex: 1,
        minWidth: 0,
    },
    fileName: {
        fontSize: 15,
        fontWeight: '700',
        color: theme.colors.text,
    },
    filePath: {
        marginTop: 2,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    durationText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontVariant: ['tabular-nums'],
    },
    diffWrap: {
        borderTopWidth: 1,
        marginTop: 4,
        paddingTop: 8,
    },
}));

