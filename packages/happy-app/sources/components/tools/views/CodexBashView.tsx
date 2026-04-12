import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { ToolSectionView } from '../ToolSectionView';
import { CommandView } from '@/components/CommandView';
import { Metadata } from '@/sync/storageTypes';
import { t } from '@/text';
import {
    getCodexCommandText,
    getCodexParsedCommandSummaries,
    getCodexParsedCommandSummary,
} from '../codexCommandUtils';

interface CodexBashViewProps {
    tool: ToolCall;
    metadata: Metadata | null;
}

export const CodexBashView = React.memo<CodexBashViewProps>(({ tool, metadata }) => {
    const { theme } = useUnistyles();
    const { input, result, state } = tool;

    // Parse the input structure
    const command = input?.command;
    const summary = React.useMemo(
        () => getCodexParsedCommandSummary(input, metadata),
        [input, metadata],
    );
    const summaries = React.useMemo(
        () => getCodexParsedCommandSummaries(input, metadata),
        [input, metadata],
    );
    const operationType = summary?.type ?? 'unknown';
    const commandStr = summary?.command || getCodexCommandText(command) || null;

    const getIconForType = React.useCallback((type: string) => {
        switch (type) {
            case 'read':
                return <Octicons name="eye" size={18} color={theme.colors.textSecondary} />;
            case 'write':
                return <Octicons name="file-diff" size={18} color={theme.colors.textSecondary} />;
            case 'search':
            case 'list_files':
                return <Octicons name="search" size={18} color={theme.colors.textSecondary} />;
            default:
                return <Octicons name="terminal" size={18} color={theme.colors.textSecondary} />;
        }
    }, [theme.colors.textSecondary]);

    const getOperationText = React.useCallback((item: (typeof summaries)[number]) => {
        switch (item.type) {
            case 'read':
                return item.resolvedPath
                    ? t('tools.desc.readingFile', { file: item.resolvedPath })
                    : item.command;
            case 'write':
                return item.resolvedPath
                    ? t('tools.desc.writingFile', { file: item.resolvedPath })
                    : item.command;
            case 'search':
                return item.query
                    ? t('tools.desc.searchPattern', { pattern: item.query })
                    : t('tools.names.searchContent');
            case 'list_files':
                return item.displayName
                    ? t('tools.desc.searchPath', { basename: item.displayName })
                    : t('tools.names.listFiles');
            default:
                return item.command;
        }
    }, []);

    if (summaries.length > 1) {
        return (
            <ToolSectionView>
                <View style={styles.readContainer}>
                    <View style={styles.summaryList}>
                        {summaries.map((item, index) => {
                            const operationText = getOperationText(item);
                            if (!operationText) {
                                return null;
                            }

                            return (
                                <View key={`${item.type}-${item.command ?? item.resolvedPath ?? index}`} style={styles.commandItem}>
                                    <View style={styles.iconRow}>
                                        {getIconForType(item.type)}
                                        <Text style={styles.operationText}>{operationText}</Text>
                                    </View>
                                    {item.command && (
                                        <Text style={styles.commandText}>{item.command}</Text>
                                    )}
                                </View>
                            );
                        })}
                    </View>
                </View>
            </ToolSectionView>
        );
    }

    // Format the display based on operation type
    if (operationType === 'read' && summary?.resolvedPath) {
        return (
            <ToolSectionView>
                <View style={styles.readContainer}>
                    <View style={styles.iconRow}>
                        {getIconForType(operationType)}
                        <Text style={styles.operationText}>
                            {t('tools.desc.readingFile', { file: summary.resolvedPath })}
                        </Text>
                    </View>
                    {commandStr && (
                        <Text style={styles.commandText}>{commandStr}</Text>
                    )}
                </View>
            </ToolSectionView>
        );
    } else if (operationType === 'write' && summary?.resolvedPath) {
        return (
            <ToolSectionView>
                <View style={styles.readContainer}>
                    <View style={styles.iconRow}>
                        {getIconForType(operationType)}
                        <Text style={styles.operationText}>
                            {t('tools.desc.writingFile', { file: summary.resolvedPath })}
                        </Text>
                    </View>
                    {commandStr && (
                        <Text style={styles.commandText}>{commandStr}</Text>
                    )}
                </View>
            </ToolSectionView>
        );
    } else if (operationType === 'search') {
        const operationText = summary?.query
            ? t('tools.desc.searchPattern', { pattern: summary.query })
            : t('tools.names.searchContent');

        return (
            <ToolSectionView>
                <View style={styles.readContainer}>
                    <View style={styles.iconRow}>
                        {getIconForType(operationType)}
                        <Text style={styles.operationText}>{operationText}</Text>
                    </View>
                    {commandStr && (
                        <Text style={styles.commandText}>{commandStr}</Text>
                    )}
                </View>
            </ToolSectionView>
        );
    } else if (operationType === 'list_files') {
        const operationText = summary?.displayName
            ? t('tools.desc.searchPath', { basename: summary.displayName })
            : t('tools.names.listFiles');

        return (
            <ToolSectionView>
                <View style={styles.readContainer}>
                    <View style={styles.iconRow}>
                        {getIconForType(operationType)}
                        <Text style={styles.operationText}>{operationText}</Text>
                    </View>
                    {commandStr && (
                        <Text style={styles.commandText}>{commandStr}</Text>
                    )}
                </View>
            </ToolSectionView>
        );
    } else {
        // Display as a regular command
        const commandDisplay = commandStr || '';
        
        return (
            <ToolSectionView>
                <CommandView 
                    command={commandDisplay}
                    stdout={null}
                    stderr={null}
                    error={state === 'error' && typeof result === 'string' ? result : null}
                    hideEmptyOutput
                />
            </ToolSectionView>
        );
    }
});

const styles = StyleSheet.create((theme) => ({
    readContainer: {
        padding: 12,
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 8,
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
        color: theme.colors.text,
        fontWeight: '500',
    },
    commandText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        fontFamily: 'monospace',
        marginTop: 8,
    },
}));
