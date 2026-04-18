import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Octicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { ToolSectionView } from '../ToolSectionView';
import { CommandView } from '@/components/CommandView';
import { Metadata } from '@/sync/storageTypes';
import { t } from '@/text';
import { buildCodexToolViewTheme } from './codexToolViewTheme';
import {
    getCodexCommandText,
    getCodexParsedCommandSummaries,
    getCodexParsedCommandSummary,
    type CodexParsedCommandSummary,
} from '../codexCommandUtils';
import {
    formatCodexBashDescription,
    getCodexBashIconName,
    getCodexBashMetaLabels,
} from '../codexBashPresentation';

interface CodexBashViewProps {
    tool: ToolCall;
    metadata: Metadata | null;
}

export const CodexBashView = React.memo<CodexBashViewProps>(({ tool, metadata }) => {
    const { theme } = useUnistyles();
    const chrome = React.useMemo(
        () => buildCodexToolViewTheme(theme.colors.codex),
        [theme.colors.codex],
    );
    const { input, result, state } = tool;

    const command = input?.command;
    const summary = React.useMemo(
        () => getCodexParsedCommandSummary(input, metadata),
        [input, metadata],
    );
    const summaries = React.useMemo(
        () => getCodexParsedCommandSummaries(input, metadata),
        [input, metadata],
    );
    const commandStr = summary?.command || getCodexCommandText(command) || null;

    const renderMetaLabels = React.useCallback((item: CodexParsedCommandSummary) => {
        const labels = getCodexBashMetaLabels(item);
        if (labels.length === 0) {
            return null;
        }

        return (
            <View style={styles.metaRow}>
                {labels.map((label, index) => (
                    <View
                        key={`${label}-${index}`}
                        style={[
                            styles.metaChip,
                            {
                                backgroundColor: chrome.chipBg,
                                borderColor: chrome.chipBorder,
                            },
                        ]}
                    >
                        <Text style={[styles.metaChipText, { color: chrome.chipText }]}>
                            {label}
                        </Text>
                    </View>
                ))}
            </View>
        );
    }, [chrome.chipBg, chrome.chipBorder, chrome.chipText]);

    const renderSemanticCard = React.useCallback((item: CodexParsedCommandSummary, key: string) => {
        const operationText =
            formatCodexBashDescription(item) ??
            item.command ??
            t('tools.names.terminal');

        return (
            <View key={key} style={styles.commandItem}>
                <View style={styles.iconRow}>
                    <Octicons
                        name={getCodexBashIconName(item) as any}
                        size={18}
                        color={chrome.subtitle}
                    />
                    <Text style={styles.operationText}>{operationText}</Text>
                </View>
                {renderMetaLabels(item)}
                {item.command ? (
                    <Text style={styles.commandText}>{item.command}</Text>
                ) : null}
            </View>
        );
    }, [chrome.subtitle, renderMetaLabels]);

    if (summaries.length > 1) {
        return (
            <ToolSectionView provider="codex">
                <View
                    style={[
                        styles.cardContainer,
                        {
                            backgroundColor: chrome.cardBg,
                            borderColor: chrome.cardBorder,
                            borderRadius: theme.codex.radius.card,
                        },
                    ]}
                >
                    <View style={styles.summaryList}>
                        {summaries.map((item, index) =>
                            renderSemanticCard(
                                item,
                                `${item.type}-${item.command ?? item.resolvedPath ?? item.displayName ?? index}`,
                            ),
                        )}
                    </View>
                </View>
            </ToolSectionView>
        );
    }

    if (summary && summary.type !== 'unknown') {
        return (
            <ToolSectionView provider="codex">
                <View
                    style={[
                        styles.cardContainer,
                        {
                            backgroundColor: chrome.cardBg,
                            borderColor: chrome.cardBorder,
                            borderRadius: theme.codex.radius.card,
                        },
                    ]}
                >
                    {renderSemanticCard(summary, 'primary')}
                </View>
            </ToolSectionView>
        );
    }

    return (
        <ToolSectionView provider="codex">
            <CommandView
                command={commandStr || ''}
                stdout={null}
                stderr={null}
                error={state === 'error' && typeof result === 'string' ? result : null}
                hideEmptyOutput
            />
        </ToolSectionView>
    );
});

const styles = StyleSheet.create((theme) => ({
    cardContainer: {
        padding: 12,
        borderWidth: theme.codex.borderWidth.soft,
    },
    summaryList: {
        gap: 12,
    },
    commandItem: {
        gap: 8,
    },
    iconRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    operationText: {
        fontSize: 14,
        color: theme.colors.codex.textPrimary,
        fontWeight: '500',
        flex: 1,
    },
    metaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    metaChip: {
        borderWidth: theme.codex.borderWidth.soft,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    metaChipText: {
        fontSize: 11,
        fontWeight: '600',
    },
    commandText: {
        fontSize: 12,
        color: theme.colors.codex.textSecondary,
        fontFamily: 'monospace',
    },
}));
