import * as React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { type Metadata } from '@/sync/storageTypes';
import { buildToolHeaderTheme } from '@/components/tools/toolChromeTheme';
import {
    getToolProvider,
    type ToolProvider,
} from '@/components/tools/toolProvider';
interface ToolStatusIndicatorProps {
    tool: ToolCall;
    metadata?: Metadata | null;
    provider?: ToolProvider;
}

export function ToolStatusIndicator({
    tool,
    metadata = null,
    provider,
}: ToolStatusIndicatorProps) {
    const { theme } = useUnistyles();
    const resolvedProvider =
        provider ?? getToolProvider({ toolName: tool.name, metadata });
    const headerTheme = buildToolHeaderTheme(resolvedProvider, theme);

    return (
        <View style={styles.container}>
            <StatusIndicator
                state={tool.state}
                runningColor={headerTheme.runningColor}
                completedColor={headerTheme.completedColor}
                errorColor={headerTheme.errorColor}
            />
        </View>
    );
}

function StatusIndicator({
    state,
    runningColor,
    completedColor,
    errorColor,
}: {
    state: ToolCall['state'];
    runningColor: string;
    completedColor: string;
    errorColor: string;
}) {
    switch (state) {
        case 'running':
            return <ActivityIndicator size="small" color={runningColor} />;
        case 'completed':
            return <Ionicons name="checkmark-circle" size={22} color={completedColor} />;
        case 'error':
            return <Ionicons name="close-circle" size={22} color={errorColor} />;
        default:
            return null;
    }
}

const styles = StyleSheet.create({
    container: {
        width: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
