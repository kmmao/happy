import * as React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAcceptedFriends, useFriendRequests, useRequestedFriends, useFeedItems, useFeedLoaded, useFriendsLoaded, useRealtimeStatus } from '@/sync/storage';
import { UserCard } from '@/components/UserCard';
import { t } from '@/text';
import { trackFriendsSearch, trackFriendsProfileView } from '@/track';
import { ItemGroup } from '@/components/ItemGroup';
import { UpdateBanner } from './UpdateBanner';
import { Typography } from '@/constants/Typography';
import { useRouter } from 'expo-router';
import { useLayout } from '@/components/layout';
import { useIsTablet } from '@/utils/responsive';
import { Header } from './navigation/Header';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { FeedItemCard } from './FeedItemCard';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { useInboxData } from '@/hooks/useInboxData';
import { ServerInboxItem } from '@/sync/apiInbox';
import { SharedStateView } from '@/components/SharedStateView';
import { Modal } from '@/modal';

// --- Inbox item card ---

const SEVERITY_COLORS: Record<string, string> = {
    error: "#E53E3E",
    warning: "#DD6B20",
    info: "#3182CE",
};

const CATEGORY_ICONS: Record<string, string> = {
    task: "checkbox-outline",
    trigger: "timer-outline",
    supervisor: "shield-checkmark-outline",
    session: "terminal-outline",
    knowledge: "library-outline",
    decision: "help-circle-outline",
    system: "notifications-outline",
};

function formatTimeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t('inbox.justNow');
    if (minutes < 60) return t('inbox.minutesAgo', minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('inbox.hoursAgo', hours);
    const days = Math.floor(hours / 24);
    return t('inbox.daysAgo', days);
}

const InboxItemCard = React.memo(({ item, onPress }: {
    item: ServerInboxItem;
    onPress: () => void;
}) => {
    const { theme } = useUnistyles();
    const iconName = CATEGORY_ICONS[item.category] ?? "notifications-outline";
    const severityColor = SEVERITY_COLORS[item.severity] ?? theme.colors.textSecondary;

    return (
        <Pressable
            style={({ pressed }) => [
                styles.inboxItem,
                !item.read && { backgroundColor: theme.colors.surface },
                pressed && { opacity: 0.6 },
            ]}
            onPress={onPress}
        >
            <View style={styles.inboxItemIcon}>
                <Ionicons
                    name={iconName as any}
                    size={20}
                    color={severityColor}
                />
            </View>
            <View style={styles.inboxItemContent}>
                <Text
                    style={[
                        styles.inboxItemTitle,
                        { color: theme.colors.text },
                        !item.read && { fontWeight: '600' },
                    ]}
                    numberOfLines={1}
                >
                    {item.title}
                </Text>
                {item.body ? (
                    <Text
                        style={[styles.inboxItemBody, { color: theme.colors.textSecondary }]}
                        numberOfLines={2}
                    >
                        {item.body}
                    </Text>
                ) : null}
                <Text style={[styles.inboxItemTime, { color: theme.colors.textSecondary }]}>
                    {formatTimeAgo(item.createdAt)}
                </Text>
            </View>
            {!item.read && (
                <View style={[styles.unreadDot, { backgroundColor: severityColor }]} />
            )}
        </Pressable>
    );
});

// --- Header components ---

function HeaderTitleTablet() {
    const { theme } = useUnistyles();
    return (
        <Text style={{
            fontSize: 17,
            color: theme.colors.header.tint,
            fontWeight: '600',
            ...Typography.default('semiBold'),
        }}>
            {t('tabs.inbox')}
        </Text>
    );
}

function HeaderRightTablet() {
    const router = useRouter();
    const { theme } = useUnistyles();
    return (
        <Pressable
            onPress={() => {
                trackFriendsSearch();
                router.push('/friends/search');
            }}
            hitSlop={15}
            style={{
                width: 32,
                height: 32,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Ionicons name="person-add-outline" size={24} color={theme.colors.header.tint} />
        </Pressable>
    );
}

// --- Main InboxView ---

interface InboxViewProps {
}

export const InboxView = React.memo(({}: InboxViewProps) => {
    const layout = useLayout();
    const router = useRouter();
    const friends = useAcceptedFriends();
    const friendRequests = useFriendRequests();
    const requestedFriends = useRequestedFriends();
    const feedItems = useFeedItems();
    const feedLoaded = useFeedLoaded();
    const friendsLoaded = useFriendsLoaded();
    const { theme } = useUnistyles();
    const isTablet = useIsTablet();
    const realtimeStatus = useRealtimeStatus();

    const inbox = useInboxData();

    const isLoading = !feedLoaded || !friendsLoaded || inbox.loading;
    const isEmpty = !isLoading
        && inbox.items.length === 0
        && friendRequests.length === 0
        && requestedFriends.length === 0
        && friends.length === 0
        && feedItems.length === 0;

    const handleInboxItemPress = React.useCallback((item: ServerInboxItem) => {
        if (!item.read) {
            void inbox.markRead(item.id);
        }
        if (item.referenceUrl) {
            router.push(item.referenceUrl as any);
        } else if (item.body) {
            Modal.alert(item.title, item.body);
        }
    }, [inbox.markRead, router]);

    const tabletHeader = isTablet ? (
        <View style={{ backgroundColor: theme.colors.groupped.background }}>
            <Header
                title={<HeaderTitleTablet />}
                headerRight={() => <HeaderRightTablet />}
                headerLeft={() => null}
                headerShadowVisible={false}
                headerTransparent={true}
            />
            {realtimeStatus !== 'disconnected' && (
                <VoiceAssistantStatusBar variant="full" />
            )}
        </View>
    ) : null;

    if (isLoading) {
        return (
            <View style={styles.container}>
                {tabletHeader}
                <UpdateBanner />
                <SharedStateView kind="loading" title={t('common.loading')} />
            </View>
        );
    }

    if (isEmpty) {
        return (
            <View style={styles.container}>
                {tabletHeader}
                <UpdateBanner />
                <SharedStateView
                    kind="empty"
                    icon={
                        <Image
                            source={require('@/assets/images/brutalist/Brutalism 10.png')}
                            contentFit="contain"
                            style={[{ width: 64, height: 64 }, styles.emptyIcon]}
                            tintColor={theme.colors.textSecondary}
                        />
                    }
                    title={t('inbox.emptyTitle')}
                    description={t('inbox.emptyDescription')}
                />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {tabletHeader}
            <ScrollView contentContainerStyle={{
                maxWidth: layout.maxWidth,
                alignSelf: 'center',
                width: '100%'
            }}>
                <UpdateBanner />

                {/* Inbox notifications */}
                {inbox.items.length > 0 && (
                    <ItemGroup
                        title={
                            <View style={styles.notificationHeader}>
                                <Text style={[styles.notificationTitle, { color: theme.colors.groupped.sectionTitle }]}>
                                    {t('inbox.notifications')}
                                </Text>
                                {inbox.unreadCount > 0 && (
                                    <Pressable onPress={() => void inbox.markAllRead()} hitSlop={8}>
                                        <Text style={[styles.markAllRead, { color: theme.colors.header.tint }]}>
                                            {t('inbox.markAllRead')}
                                        </Text>
                                    </Pressable>
                                )}
                            </View>
                        }
                    >
                        {inbox.items.map((item) => (
                            <InboxItemCard
                                key={item.id}
                                item={item}
                                onPress={() => handleInboxItemPress(item)}
                            />
                        ))}
                    </ItemGroup>
                )}

                {/* Feed updates (social) */}
                {feedItems.length > 0 && (
                    <ItemGroup title={t('inbox.updates')}>
                        {feedItems.map((item) => (
                            <FeedItemCard
                                key={item.id}
                                item={item}
                            />
                        ))}
                    </ItemGroup>
                )}

                {friendRequests.length > 0 && (
                    <ItemGroup title={t('friends.pendingRequests')}>
                        {friendRequests.map((friend) => (
                            <UserCard
                                key={friend.id}
                                user={friend}
                                onPress={() => {
                                    trackFriendsProfileView();
                                    router.push(`/user/${friend.id}`);
                                }}
                            />
                        ))}
                    </ItemGroup>
                )}

                {requestedFriends.length > 0 && (
                    <ItemGroup title={t('friends.requestPending')}>
                        {requestedFriends.map((friend) => (
                            <UserCard
                                key={friend.id}
                                user={friend}
                                onPress={() => {
                                    trackFriendsProfileView();
                                    router.push(`/user/${friend.id}`);
                                }}
                            />
                        ))}
                    </ItemGroup>
                )}

                {friends.length > 0 && (
                    <ItemGroup title={t('friends.myFriends')}>
                        {friends.map((friend) => (
                            <UserCard
                                key={friend.id}
                                user={friend}
                                onPress={() => {
                                    trackFriendsProfileView();
                                    router.push(`/user/${friend.id}`);
                                }}
                            />
                        ))}
                    </ItemGroup>
                )}
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    emptyIcon: {
        marginBottom: 0,
    },
    sectionHeader: {
        fontSize: 14,
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        paddingHorizontal: 16,
        paddingTop: 24,
        paddingBottom: 8,
        textTransform: 'uppercase',
    },
    // Notification header with "Mark All Read"
    notificationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
    },
    notificationTitle: {
        fontSize: 14,
        ...Typography.default('semiBold'),
        textTransform: 'uppercase',
    },
    markAllRead: {
        fontSize: 13,
        ...Typography.default(),
    },
    // Inbox item styles
    inboxItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
    },
    inboxItemIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: theme.colors.groupped.background,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    inboxItemContent: {
        flex: 1,
    },
    inboxItemTitle: {
        fontSize: 15,
        ...Typography.default(),
        marginBottom: 2,
    },
    inboxItemBody: {
        fontSize: 13,
        ...Typography.default(),
        marginBottom: 4,
    },
    inboxItemTime: {
        fontSize: 12,
        ...Typography.default(),
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginTop: 8,
    },
}));
