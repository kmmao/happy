import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ToolViewProps } from './_all';
import { ToolSectionView } from '../ToolSectionView';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { CodeView } from '@/components/CodeView';
import { knownTools } from '../knownTools';
import { t } from '@/text';

/**
 * Renders Skill tool invocations. The tool header already shows the skill
 * name, so the body focuses on the human-readable `args` string (rendered as
 * Markdown in a quoted block) instead of dumping the raw `{ skill, args }`
 * JSON. Any unexpected extra keys fall back to a JSON section.
 */
export const SkillView = React.memo<ToolViewProps>(({ tool }) => {
    const { theme } = useUnistyles();

    const parsed = knownTools.Skill.input.safeParse(tool.input);
    const args =
        parsed.success && typeof parsed.data.args === 'string'
            ? parsed.data.args.trim()
            : '';

    // Anything beyond the known skill/args keys is rare; surface it as JSON.
    const rest: Record<string, unknown> = {};
    if (tool.input && typeof tool.input === 'object') {
        for (const [key, value] of Object.entries(
            tool.input as Record<string, unknown>,
        )) {
            if (key !== 'skill' && key !== 'args') rest[key] = value;
        }
    }
    const hasRest = Object.keys(rest).length > 0;

    if (!args && !hasRest) return null;

    return (
        <>
            {!!args && (
                <ToolSectionView title={t('toolView.arguments')}>
                    <View
                        style={[
                            styles.argsBlock,
                            { borderLeftColor: theme.colors.textSecondary + '40' },
                        ]}
                    >
                        <MarkdownView markdown={args} />
                    </View>
                </ToolSectionView>
            )}

            {hasRest && (
                <ToolSectionView title={t('toolView.input')}>
                    <CodeView code={JSON.stringify(rest, null, 2)} />
                </ToolSectionView>
            )}
        </>
    );
});

const styles = StyleSheet.create(() => ({
    argsBlock: {
        borderLeftWidth: 2,
        borderRadius: 6,
        paddingLeft: 10,
        paddingRight: 8,
    },
}));
