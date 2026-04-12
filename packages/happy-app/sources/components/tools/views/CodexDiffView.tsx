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
    }, [isFullView, tool.id]);

    // If we have a filename, show it as a header
    const fileHeader = fileName && isFullView ? (
        <View style={styles.fileHeader}>
            <Text style={styles.fileName}>{fileName}</Text>
        </View>
    ) : null;

    return (
        <>
            {fileHeader}
            <ToolSectionView fullWidth>
                {!isFullView && (
                    <Pressable style={styles.toggleRow} onPress={() => setExpanded((v) => !v)}>
                        <Ionicons
                            name={expanded ? 'chevron-down' : 'chevron-forward'}
                            size={14}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={styles.toggleText}>
                            {expanded ? t('diff.toolbar.collapse') : t('diff.toolbar.expand')}
                        </Text>
                        <Text style={[styles.statsText, { color: theme.colors.diff.success }]}>
                            +{diffStats.additions}
                        </Text>
                        <Text style={[styles.statsText, { color: theme.colors.diff.error }]}>
                            -{diffStats.deletions}
                        </Text>
                    </Pressable>
                )}
                {(expanded || isFullView) && (
                    <ToolDiffView 
                        oldText={oldText} 
                        newText={newText} 
                        showLineNumbers={showLineNumbersInToolViews}
                        showPlusMinusSymbols={showLineNumbersInToolViews}
                    />
                )}
            </ToolSectionView>
        </>
    );
});

const styles = StyleSheet.create((theme) => ({
    fileHeader: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: theme.colors.surfaceHigh,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    fileName: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontFamily: 'monospace',
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 4,
        paddingBottom: 8,
    },
    toggleText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        flex: 1,
    },
    statsText: {
        fontSize: 11,
    },
}));
