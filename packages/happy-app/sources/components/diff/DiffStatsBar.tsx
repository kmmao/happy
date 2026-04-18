import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import {
    buildDiffStatsTheme,
    type DiffStatsProvider,
} from '@/components/diff/diffStatsTheme';

interface DiffStatsBarProps {
    additions: number;
    deletions: number;
    provider?: DiffStatsProvider;
}

export const DiffStatsBar = React.memo<DiffStatsBarProps>(({
    additions,
    deletions,
    provider = 'default',
}) => {
    const { theme } = useUnistyles();
    const total = additions + deletions;

    if (total === 0) {
        return null;
    }

    const addRatio = additions / total;
    const delRatio = deletions / total;
    const providerTheme = buildDiffStatsTheme(provider, theme);

    return (
        <View style={[styles.container, { marginLeft: providerTheme.marginLeft }]}>
            <Text style={[styles.additions, { color: providerTheme.additionsColor }]}>
                +{additions}
            </Text>
            <Text style={[styles.deletions, { color: providerTheme.deletionsColor }]}>
                -{deletions}
            </Text>
            <View
                style={[
                    styles.bar,
                    providerTheme.trackColor
                        ? {
                            backgroundColor: providerTheme.trackColor,
                            borderRadius: providerTheme.radius,
                        }
                        : null,
                ]}
            >
                {additions > 0 && (
                    <View
                        style={[
                            styles.barSegment,
                            {
                                flex: addRatio,
                                backgroundColor: providerTheme.additionsColor,
                                borderTopLeftRadius: providerTheme.radius,
                                borderBottomLeftRadius: providerTheme.radius,
                                borderTopRightRadius: deletions === 0 ? providerTheme.radius : 0,
                                borderBottomRightRadius: deletions === 0 ? providerTheme.radius : 0,
                            },
                        ]}
                    />
                )}
                {deletions > 0 && (
                    <View
                        style={[
                            styles.barSegment,
                            {
                                flex: delRatio,
                                backgroundColor: providerTheme.deletionsColor,
                                borderTopRightRadius: providerTheme.radius,
                                borderBottomRightRadius: providerTheme.radius,
                                borderTopLeftRadius: additions === 0 ? providerTheme.radius : 0,
                                borderBottomLeftRadius: additions === 0 ? providerTheme.radius : 0,
                            },
                        ]}
                    />
                )}
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    additions: {
        ...Typography.mono(),
        fontSize: 11,
    },
    deletions: {
        ...Typography.mono(),
        fontSize: 11,
    },
    bar: {
        width: 40,
        height: 6,
        flexDirection: 'row',
        overflow: 'hidden',
    },
    barSegment: {
        height: 6,
    },
});
