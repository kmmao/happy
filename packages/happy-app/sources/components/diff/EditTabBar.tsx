import * as React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

export interface EditTabItem {
    index: number;
    label: string;
    additions: number;
    deletions: number;
}

interface EditTabBarProps {
    items: EditTabItem[];
    activeIndex: number;
    onTabPress: (index: number) => void;
}

export const EditTabBar = React.memo<EditTabBarProps>(({ items, activeIndex, onTabPress }) => {
    const { theme } = useUnistyles();

    if (items.length <= 1) {
        return null;
    }

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.container}
            contentContainerStyle={styles.contentContainer}
        >
            {items.map((item) => {
                const isActive = item.index === activeIndex;
                return (
                    <Pressable
                        key={item.index}
                        onPress={() => onTabPress(item.index)}
                        style={[
                            styles.tab,
                            {
                                backgroundColor: isActive
                                    ? theme.colors.surfaceHighest
                                    : 'transparent',
                                borderColor: isActive
                                    ? theme.colors.diff.outline
                                    : 'transparent',
                                borderWidth: isActive ? 1 : 0,
                            },
                        ]}
                    >
                        <Text
                            style={[
                                styles.tabLabel,
                                { color: isActive ? theme.colors.text : theme.colors.textSecondary },
                            ]}
                            numberOfLines={1}
                        >
                            {item.label}
                        </Text>
                        <Text style={[styles.tabStats, { color: theme.colors.diff.success }]}>
                            +{item.additions}
                        </Text>
                        <Text style={[styles.tabStats, { color: theme.colors.diff.error }]}>
                            -{item.deletions}
                        </Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
});

const styles = StyleSheet.create({
    container: {
        maxHeight: 40,
        marginBottom: 8,
    },
    contentContainer: {
        gap: 6,
        paddingHorizontal: 4,
    },
    tab: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        gap: 4,
    },
    tabLabel: {
        ...Typography.mono(),
        fontSize: 12,
        fontWeight: '500',
    },
    tabStats: {
        ...Typography.mono(),
        fontSize: 10,
    },
});
