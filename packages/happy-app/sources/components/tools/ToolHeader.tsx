import * as React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { knownTools } from '@/components/tools/knownTools';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { type Metadata } from '@/sync/storageTypes';
import { buildToolHeaderTheme } from '@/components/tools/toolChromeTheme';
import {
    getToolProvider,
    type ToolProvider,
} from '@/components/tools/toolProvider';
import {
    resolveToolTitle,
    resolveToolSubtitle,
} from '@/components/tools/toolMetadataResolve';

interface ToolHeaderProps {
    tool: ToolCall;
    metadata?: Metadata | null;
    provider?: ToolProvider;
}

export function ToolHeader({ tool, metadata = null, provider }: ToolHeaderProps) {
    const { theme } = useUnistyles();
    const resolvedProvider =
        provider ?? getToolProvider({ toolName: tool.name, metadata });
    const headerTheme = buildToolHeaderTheme(resolvedProvider, theme);
    const knownTool = tool.name in knownTools
        ? knownTools[tool.name as keyof typeof knownTools]
        : undefined;

    // Title + subtitle resolution shared with ToolView via toolMetadataResolve.
    const toolTitle = resolveToolTitle(knownTool, tool, metadata);

    const icon = knownTool?.icon
        ? knownTool.icon(18, headerTheme.iconColor)
        : <Ionicons name="construct-outline" size={18} color={headerTheme.iconColor} />;

    const subtitle = resolveToolSubtitle(knownTool, tool, metadata);

    return (
        <View style={styles.container}>
            <View style={styles.titleContainer}>
                <View style={styles.titleRow}>
                    {icon}
                    <Text
                        style={[styles.title, { color: headerTheme.titleColor }]}
                        numberOfLines={1}
                    >
                        {toolTitle}
                    </Text>
                </View>
                {subtitle && (
                    <Text
                        style={[styles.subtitle, { color: headerTheme.subtitleColor }]}
                        numberOfLines={1}
                    >
                        {subtitle}
                    </Text>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 1,
        paddingHorizontal: 4,
        overflow: 'hidden',
    },
    titleContainer: {
        flexDirection: 'column',
        alignItems: 'center',
        flexShrink: 1,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flexShrink: 1,
    },
    title: {
        fontSize: 14,
        fontWeight: '500',
        textAlign: 'center',
        flexShrink: 1,
    },
    subtitle: {
        fontSize: 11,
        textAlign: 'center',
        marginTop: 2,
    },
}));
