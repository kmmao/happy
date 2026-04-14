import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { Session } from '@/sync/storageTypes';
import { useMachine } from '@/sync/storage';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { sessionGetCompactionSummary } from '@/sync/ops';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 48,
    },
    iconContainer: {
        marginBottom: 12,
    },
    hostText: {
        fontSize: 18,
        color: theme.colors.text,
        textAlign: 'center',
        marginBottom: 4,
        ...Typography.default('semiBold'),
    },
    pathText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginBottom: 40,
        ...Typography.default('regular'),
    },
    noMessagesText: {
        fontSize: 20,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginBottom: 8,
        ...Typography.default('regular'),
    },
    createdText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 24,
        ...Typography.default(),
    },
    summaryCard: {
        width: '100%',
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 16,
        marginBottom: 24,
    },
    summaryHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
        gap: 6,
    },
    summaryTitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    summaryText: {
        fontSize: 14,
        color: theme.colors.text,
        lineHeight: 20,
        ...Typography.default('regular'),
    },
}));

interface EmptyMessagesProps {
    session: Session;
}

function getOSIcon(os?: string): keyof typeof Ionicons.glyphMap {
    if (!os) return 'hardware-chip-outline';

    const osLower = os.toLowerCase();
    if (osLower.includes('darwin') || osLower.includes('mac')) {
        return 'laptop-outline';
    } else if (osLower.includes('win')) {
        return 'desktop-outline';
    } else if (osLower.includes('linux')) {
        return 'terminal-outline';
    }
    return 'hardware-chip-outline';
}

function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) {
        return t('time.justNow');
    } else if (diffMinutes < 60) {
        return t('time.minutesAgo', { count: diffMinutes });
    } else if (diffHours < 24) {
        return t('time.hoursAgo', { count: diffHours });
    } else {
        return t('sessionHistory.daysAgo', { count: diffDays });
    }
}

export function EmptyMessages({ session }: EmptyMessagesProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const osIcon = getOSIcon(session.metadata?.os);
    const machine = useMachine(session.metadata?.machineId ?? "");
    const startedTime = formatRelativeTime(session.createdAt);

    const isOnline = session.presence === "online";
    const hasForkSource = !!session.forkedFromSessionId;

    const [compactionSummary, setCompactionSummary] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!isOnline || !hasForkSource) return;
        let cancelled = false;
        sessionGetCompactionSummary(session.id).then((summary) => {
            if (!cancelled) {
                setCompactionSummary(summary);
            }
        });
        return () => { cancelled = true; };
    }, [session.id, isOnline, hasForkSource]);

    return (
        <View style={styles.container}>
            <Ionicons
                name={osIcon}
                size={72}
                color={theme.colors.textSecondary}
                style={styles.iconContainer}
            />

            {(machine?.metadata?.displayName || session.metadata?.host) && (
                <Text style={styles.hostText}>
                    {machine?.metadata?.displayName || session.metadata?.host}
                </Text>
            )}

            {session.metadata?.path && (
                <Text style={styles.pathText}>
                    {formatPathRelativeToHome(session.metadata.path, session.metadata.homeDir)}
                </Text>
            )}

            {compactionSummary && (
                <View style={styles.summaryCard}>
                    <View style={styles.summaryHeader}>
                        <Ionicons name="git-branch-outline" size={14} color={theme.colors.textSecondary} />
                        <Text style={styles.summaryTitle}>{t('session.contextSummaryTitle')}</Text>
                    </View>
                    <Text style={styles.summaryText} numberOfLines={12}>
                        {compactionSummary}
                    </Text>
                </View>
            )}

            <Text style={styles.noMessagesText}>
                {t('session.noMessages')}
            </Text>

            <Text style={styles.createdText}>
                {t('session.created', { time: startedTime })}
            </Text>
        </View>
    );
}
