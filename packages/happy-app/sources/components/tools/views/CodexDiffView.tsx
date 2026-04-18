import * as React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { ToolSectionView } from '../ToolSectionView';
import { ToolDiffView } from '@/components/tools/ToolDiffView';
import { useSetting } from '@/sync/storage';
import { t } from '@/text';
import { CodexDiffStats } from '@/components/session/codex/CodexDiffStats';
import { buildCodexDiffPalette } from '@/components/session/codex/codexDiffPalette';
import { getCodexDiffStats, parseCodexUnifiedDiff } from '../codexDiffUtils';
import { Metadata } from '@/sync/storageTypes';
import { getLanguageFromPath } from '@/components/diff/syntaxTokenizer';
import { buildCodexToolViewTheme } from './codexToolViewTheme';

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
    const expandDiffsByDefault = useSetting('expandDiffsByDefault');
    const chrome = React.useMemo(
        () => buildCodexToolViewTheme(theme.colors.codex),
        [theme.colors.codex],
    );
    const diffPalette = React.useMemo(
        () => buildCodexDiffPalette(theme.colors.codex),
        [theme.colors.codex],
    );
    const { input } = tool;

    let oldText = '';
    let newText = '';
    let fileName: string | undefined;
    let language: string | null = null;

    if (input?.unified_diff && typeof input.unified_diff === 'string') {
        const parsed = parseCodexUnifiedDiff(input.unified_diff);
        oldText = parsed.oldText;
        newText = parsed.newText;
        fileName = parsed.fileName;
        language = parsed.fileName ? getLanguageFromPath(parsed.fileName) : null;
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
        <ToolSectionView fullWidth provider="codex">
            <View
                style={[
                    styles.item,
                    {
                        borderColor: chrome.cardBorder,
                        backgroundColor: chrome.cardBg,
                        borderRadius: theme.codex.radius.card,
                    },
                    !expanded && styles.itemCollapsed,
                ]}
            >
                <Pressable
                    style={({ pressed }) => [
                        styles.cardHeader,
                        {
                            paddingHorizontal: theme.codex.spacing.cardPadding + 4,
                            paddingVertical: theme.codex.spacing.cardPadding - 2,
                            gap: theme.codex.spacing.sectionGap,
                        },
                        pressed && { backgroundColor: chrome.cardBgHover },
                    ]}
                    onPress={() => setExpanded((v) => !v)}
                >
                    <View style={styles.cardHeaderLeft}>
                        <View
                            style={[
                                styles.fileIconWrap,
                                {
                                    backgroundColor: chrome.iconBg,
                                    borderColor: chrome.iconBorder,
                                    borderRadius: theme.codex.radius.diff - 2,
                                },
                            ]}
                        >
                            <Ionicons
                                name="git-compare-outline"
                                size={18}
                                color={chrome.iconColor}
                            />
                        </View>
                        <View style={styles.fileMeta}>
                            <Text
                                style={[styles.fileName, { color: chrome.title }]}
                                numberOfLines={1}
                            >
                                {displayName}
                            </Text>
                            {showPath && (
                                <Text
                                    style={[styles.filePath, { color: chrome.subtitle }]}
                                    numberOfLines={1}
                                >
                                    {fileName}
                                </Text>
                            )}
                        </View>
                    </View>
                    <View style={styles.cardHeaderRight}>
                        <CodexDiffStats
                            additions={diffStats.additions}
                            deletions={diffStats.deletions}
                        />
                        {!isFullView && durationText && (
                            <Text style={[styles.durationText, { color: chrome.meta }]}>
                                {durationText}
                            </Text>
                        )}
                        <Ionicons
                            name={expanded ? 'chevron-down' : 'chevron-forward'}
                            size={16}
                            color={chrome.subtitle}
                        />
                    </View>
                </Pressable>
                {expanded && (
                    <View
                        style={[
                            styles.diffWrap,
                            {
                                borderTopColor: chrome.divider,
                                paddingTop: theme.codex.spacing.diffPadding - 2,
                            },
                        ]}
                    >
                        <ToolDiffView
                            oldText={oldText}
                            newText={newText}
                            showLineNumbers={showLineNumbersInToolViews}
                            showPlusMinusSymbols={showLineNumbersInToolViews}
                            language={language}
                            visibleLineCount={isFullView || expandDiffsByDefault ? undefined : 5}
                            palette={diffPalette}
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
        borderWidth: 1,
    },
    itemCollapsed: {
        borderBottomWidth: 0,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
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
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: theme.codex.borderWidth.soft,
    },
    fileMeta: {
        flex: 1,
        minWidth: 0,
    },
    fileName: {
        fontSize: 15,
        fontWeight: '700',
    },
    filePath: {
        marginTop: 2,
        fontSize: 12,
    },
    durationText: {
        fontSize: 13,
        fontVariant: ['tabular-nums'],
    },
    diffWrap: {
        borderTopWidth: 1,
        marginTop: 4,
    },
}));
