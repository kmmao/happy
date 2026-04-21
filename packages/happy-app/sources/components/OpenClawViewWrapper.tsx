import * as React from 'react';
import { View, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { RoundButton } from '@/components/RoundButton';
import { Ionicons } from '@expo/vector-icons';
import { ItemList } from '@/components/ItemList';
import { ItemGroup } from '@/components/ItemGroup';
import { Item } from '@/components/Item';
import { t } from '@/text';
import { useUnistyles } from 'react-native-unistyles';
import { useOpenClawStatus, useOpenClawSessions } from '@/openclaw';
import type { OpenClawSession } from '@/openclaw';
import { SharedEmptyState } from '@/components/SharedEmptyState';
import { SharedStateView } from '@/components/SharedStateView';

/**
 * Wrapper for OpenClaw view in the main tab bar.
 * Shows sessions list when connected, connect prompt otherwise.
 */
export const OpenClawViewWrapper = React.memo(function OpenClawViewWrapper() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const { isConnected, serverHost } = useOpenClawStatus();
    const { sessions, loading, error, state, refresh } = useOpenClawSessions();

    // Not connected - show connect prompt
    if (!isConnected) {
        return (
            <SharedEmptyState
                icon={
                    <Ionicons
                        name="cloud-offline-outline"
                        size={64}
                        color={theme.colors.textSecondary}
                    />
                }
                title={t('openclaw.notConnected')}
                description={t('openclaw.notConnectedDescription')}
            >
                <View style={{ width: 240 }}>
                    <RoundButton
                        title={t('openclaw.connectToGateway')}
                        onPress={() => router.push('/(app)/openclaw/connect')}
                        size="large"
                    />
                </View>
            </SharedEmptyState>
        );
    }

    const handleSessionPress = (session: OpenClawSession) => {
        router.push({
            pathname: '/(app)/openclaw/chat/[sessionKey]',
            params: { sessionKey: session.key }
        });
    };

    const handleNewChat = () => {
        router.push('/(app)/openclaw/new');
    };

    return (
        <ItemList
            refreshControl={
                <RefreshControl
                    refreshing={loading}
                    onRefresh={refresh}
                    tintColor={theme.colors.button.primary.background}
                />
            }
        >
            {/* Connection Status */}
            <ItemGroup>
                <Item
                    title={t('openclaw.connectedTo')}
                    detail={serverHost ?? t('status.unknown')}
                    icon={<Ionicons name="checkmark-circle" size={29} color="#34C759" />}
                    showChevron={false}
                />
            </ItemGroup>

            {/* New Chat Button */}
            <ItemGroup>
                <View style={{
                    paddingHorizontal: 16,
                    paddingVertical: 12
                }}>
                    <RoundButton
                        title={t('openclaw.newChat')}
                        onPress={handleNewChat}
                        size="large"
                    />
                </View>
            </ItemGroup>

            {state.kind === 'error' ? (
                <SharedStateView
                    inline
                    kind="error"
                    title={t('common.error')}
                    description={error ?? undefined}
                    onAction={refresh}
                />
            ) : null}

            {state.kind === 'loading' ? (
                <SharedStateView
                    inline
                    kind="loading"
                    title={t('common.loading')}
                />
            ) : null}

            {/* Sessions List */}
            {sessions.length > 0 && (
                <ItemGroup title={t('openclaw.recentSessions')}>
                    {sessions.map((session) => (
                        <Item
                            key={session.key}
                            title={session.displayName || session.label || session.key}
                            subtitle={formatSessionSubtitle(session)}
                            icon={<Ionicons name="chatbubble-outline" size={29} color={theme.colors.button.primary.background} />}
                            onPress={() => handleSessionPress(session)}
                        />
                    ))}
                </ItemGroup>
            )}

            {/* Empty State */}
            {state.kind === 'empty' && (
                <SharedStateView
                    inline
                    kind="empty"
                    icon={
                        <Ionicons
                            name="chatbubbles-outline"
                            size={48}
                            color={theme.colors.textSecondary}
                        />
                    }
                    title={t('openclaw.noSessions')}
                    description={t('openclaw.startConversation')}
                />
            )}

            {/* Settings Link */}
            <ItemGroup>
                <Item
                    title={t('openclaw.connectionSettings')}
                    icon={<Ionicons name="settings-outline" size={29} color={theme.colors.button.primary.background} />}
                    onPress={() => router.push('/(app)/openclaw/connect')}
                />
            </ItemGroup>
        </ItemList>
    );
});

function formatSessionSubtitle(session: OpenClawSession): string {
    const parts: string[] = [];

    // Show kind/surface info
    if (session.surface) {
        parts.push(session.surface);
    } else if (session.kind && session.kind !== 'unknown') {
        parts.push(session.kind);
    }

    // Show token count if available
    if (session.totalTokens !== undefined && session.totalTokens > 0) {
        parts.push(`${session.totalTokens.toLocaleString()} tokens`);
    }

    // Show last update time
    if (session.updatedAt) {
        const date = new Date(session.updatedAt);
        parts.push(date.toLocaleDateString());
    }

    return parts.join(' \u2022 ') || session.key;
}
