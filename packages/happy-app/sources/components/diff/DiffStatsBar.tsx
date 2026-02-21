import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

interface DiffStatsBarProps {
    additions: number;
    deletions: number;
}

export const DiffStatsBar = React.memo<DiffStatsBarProps>(({ additions, deletions }) => {
    const { theme } = useUnistyles();
    const total = additions + deletions;

    if (total === 0) {
        return null;
    }

    const addRatio = additions / total;
    const delRatio = deletions / total;

    return (
        <View style={styles.container}>
            <Text style={[styles.additions, { color: theme.colors.diff.success }]}>
                +{additions}
            </Text>
            <Text style={[styles.deletions, { color: theme.colors.diff.error }]}>
                -{deletions}
            </Text>
            <View style={styles.bar}>
                {additions > 0 && (
                    <View
                        style={[
                            styles.barSegment,
                            {
                                flex: addRatio,
                                backgroundColor: theme.colors.diff.success,
                                borderTopLeftRadius: 3,
                                borderBottomLeftRadius: 3,
                                borderTopRightRadius: deletions === 0 ? 3 : 0,
                                borderBottomRightRadius: deletions === 0 ? 3 : 0,
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
                                backgroundColor: theme.colors.diff.error,
                                borderTopRightRadius: 3,
                                borderBottomRightRadius: 3,
                                borderTopLeftRadius: additions === 0 ? 3 : 0,
                                borderBottomLeftRadius: additions === 0 ? 3 : 0,
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
        marginLeft: 8,
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
