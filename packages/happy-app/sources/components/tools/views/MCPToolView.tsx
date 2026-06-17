import * as React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ToolViewProps } from './_all';
import { ToolSectionView } from '../ToolSectionView';
import { CodeView } from '@/components/CodeView';
import { t } from '@/text';

/**
 * Converts snake_case string to PascalCase with spaces
 * Example: "create_issue" -> "Create Issue"
 */
function snakeToPascalWithSpaces(str: string): string {
    return str
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

/**
 * Formats MCP tool name to display title
 * Example: "mcp__linear__create_issue" -> "MCP: Linear Create Issue"
 */
export function formatMCPTitle(toolName: string): string {
    // Remove "mcp__" prefix
    const withoutPrefix = toolName.replace(/^mcp__/, '');

    // Split into parts by "__"
    const parts = withoutPrefix.split('__');

    if (parts.length >= 2) {
        const serverName = snakeToPascalWithSpaces(parts[0]);
        const toolNamePart = snakeToPascalWithSpaces(parts.slice(1).join('_'));
        return `MCP: ${serverName} ${toolNamePart}`;
    }

    // Fallback if format doesn't match expected pattern
    return `MCP: ${snakeToPascalWithSpaces(withoutPrefix)}`;
}

// Output preview truncation cap (chars). MCP outputs (e.g. codegraph_explore)
// can be thousands of lines; rendering them inline would tank FlatList. Full
// content is always reachable via the message detail page (ToolFullView).
const OUTPUT_PREVIEW_CHAR_CAP = 600;

function isNonEmptyInput(input: unknown): boolean {
    if (input == null) return false;
    if (typeof input !== 'object') return true;
    return Object.keys(input as Record<string, unknown>).length > 0;
}

function stringifyResult(result: unknown): string {
    if (typeof result === 'string') return result;
    try {
        return JSON.stringify(result, null, 2);
    } catch {
        return String(result);
    }
}

/**
 * Inline view for MCP tool calls without a more specific handler.
 *
 * Replaces the old `minimal = true` behavior (header-only) for any tool whose
 * name starts with `mcp__` and isn't explicitly registered in
 * `toolViewRegistry`. Shows JSON-formatted input and a truncated result
 * preview directly in the chat surface so the user no longer has to tap
 * through to the detail page to see what the MCP server returned.
 *
 * Error rendering is intentionally left to `ToolView`'s default `ToolError`
 * fallback — duplicating it here would double the error message.
 */
export const McpToolView = React.memo<ToolViewProps>(({ tool }) => {
    const { theme } = useUnistyles();

    const hasInput = isNonEmptyInput(tool.input);
    const inputJson = React.useMemo(
        () => (hasInput ? JSON.stringify(tool.input, null, 2) : ''),
        [hasInput, tool.input],
    );

    const resultText = React.useMemo(() => {
        if (tool.state !== 'completed') return null;
        if (tool.result == null) return null;
        const text = stringifyResult(tool.result);
        if (!text) return null;
        if (text.length <= OUTPUT_PREVIEW_CHAR_CAP) {
            return { body: text, truncated: false };
        }
        return {
            body: text.slice(0, OUTPUT_PREVIEW_CHAR_CAP),
            truncated: true,
        };
    }, [tool.state, tool.result]);

    if (!hasInput && !resultText) return null;

    return (
        <>
            {hasInput && (
                <ToolSectionView title={t('toolView.input')}>
                    <CodeView code={inputJson} />
                </ToolSectionView>
            )}

            {resultText && (
                <ToolSectionView title={t('toolView.output')}>
                    <CodeView code={resultText.body} />
                    {resultText.truncated && (
                        <Text
                            style={[
                                styles.truncatedHint,
                                { color: theme.colors.textSecondary },
                            ]}
                        >
                            {t('toolView.mcpOutputTruncated')}
                        </Text>
                    )}
                </ToolSectionView>
            )}
        </>
    );
});

const styles = StyleSheet.create(() => ({
    truncatedHint: {
        fontSize: 12,
        marginTop: 6,
        marginHorizontal: 4,
    },
}));
