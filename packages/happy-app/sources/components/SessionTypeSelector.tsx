import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';

interface SessionTypeSelectorProps {
    value: 'simple' | 'worktree';
    onChange: (value: 'simple' | 'worktree') => void;
}

const OPTIONS: ReadonlyArray<{
    key: 'simple' | 'worktree';
    icon: keyof typeof Ionicons.glyphMap;
}> = [
    { key: 'simple', icon: 'document-outline' },
    { key: 'worktree', icon: 'git-branch-outline' },
];

const LABELS: Record<'simple' | 'worktree', () => string> = {
    simple: () => t('newSession.sessionType.simple'),
    worktree: () => t('newSession.sessionType.worktree'),
};

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        backgroundColor: theme.colors.input.background,
        borderRadius: 10,
        padding: 3,
    },
    option: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        gap: 6,
    },
    optionActive: {
        backgroundColor: theme.colors.surface,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    label: {
        fontSize: 14,
        ...Typography.default('semiBold'),
    },
    labelActive: {
        color: theme.colors.text,
    },
    labelInactive: {
        color: theme.colors.textSecondary,
    },
}));

export const SessionTypeSelector: React.FC<SessionTypeSelectorProps> = ({ value, onChange }) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;

    return (
        <View style={styles.container}>
            {OPTIONS.map((option) => {
                const isActive = value === option.key;
                return (
                    <Pressable
                        key={option.key}
                        onPress={() => onChange(option.key)}
                        style={[
                            styles.option,
                            isActive && styles.optionActive,
                        ]}
                    >
                        <Ionicons
                            name={option.icon}
                            size={16}
                            color={isActive ? theme.colors.text : theme.colors.textSecondary}
                        />
                        <Text style={[
                            styles.label,
                            isActive ? styles.labelActive : styles.labelInactive,
                        ]}>
                            {LABELS[option.key]()}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
};
