import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAllMachines } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { useRouter } from 'expo-router';
import { SharedEmptyState } from '@/components/SharedEmptyState';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    iconContainer: {
        marginBottom: 24,
    },
    button: {
        backgroundColor: theme.colors.button.primary.background,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    buttonIcon: {
        marginRight: 8,
    },
    buttonText: {
        fontSize: 16,
        color: theme.colors.button.primary.tint,
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
}));

export function EmptySessionsTablet() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const machines = useAllMachines();
    
    const hasOnlineMachines = React.useMemo(() => {
        return machines.some(machine => isMachineOnline(machine));
    }, [machines]);
    
    const handleStartNewSession = () => {
        router.push('/new');
    };
    
    return (
        <SharedEmptyState
            icon={
                <Ionicons 
                    name="terminal-outline" 
                    size={64} 
                    color={theme.colors.textSecondary}
                    style={styles.iconContainer}
                />
            }
            title={t("projects.noSessions")}
            description={hasOnlineMachines ? undefined : t("newSession.noMachinesFound")}
        >
            {hasOnlineMachines ? (
                <Pressable
                    style={styles.button}
                    onPress={handleStartNewSession}
                >
                    <Ionicons
                        name="add"
                        size={20}
                        color={theme.colors.button.primary.tint}
                        style={styles.buttonIcon}
                    />
                    <Text style={styles.buttonText}>
                        {t("newSession.title")}
                    </Text>
                </Pressable>
            ) : null}
        </SharedEmptyState>
    );
}
