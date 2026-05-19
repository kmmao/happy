import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { SessionsList } from './SessionsList';
import { EmptyMainScreen } from './EmptyMainScreen';
import { SharedStateView } from './SharedStateView';
import { AgentsDashboard } from './AgentsDashboard';
import { UpdateBanner } from './UpdateBanner';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { useSessions, useSetting } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    loadingContainerWrapper: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 32,
    },
    emptyStateContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        flexDirection: 'column',
        backgroundColor: theme.colors.groupped.background,
    },
    emptyStateContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
}));

export const SessionsListWrapper = React.memo(() => {
    useUnistyles();
    const sessionListViewData = useVisibleSessionListViewData();
    const allSessions = useSessions();
    const styles = stylesheet;

    const showAgentsDashboard = useSetting('showAgentsDashboard');

    const activeSessions = React.useMemo(() => {
        if (!allSessions) return [] as Session[];
        return (allSessions as Session[]).filter((item): item is Session =>
            typeof item !== 'string' && item.active === true
        );
    }, [allSessions]);

    if (sessionListViewData === null) {
        return (
            <View style={styles.container}>
                <View style={styles.loadingContainerWrapper}>
                    <SharedStateView kind="loading" title={t("common.loading")} />
                </View>
            </View>
        );
    }

    if (sessionListViewData.length === 0) {
        return (
            <View style={styles.container}>
                <View style={styles.emptyStateContainer}>
                    <View style={styles.emptyStateContentContainer}>
                        <EmptyMainScreen />
                    </View>
                </View>
            </View>
        );
    }

    const shouldShowDashboard = showAgentsDashboard && activeSessions.length >= 2;

    return (
        <View style={styles.container}>
            {shouldShowDashboard && <UpdateBanner />}
            {shouldShowDashboard && <AgentsDashboard sessions={activeSessions} />}
            <SessionsList hideUpdateBanner={shouldShowDashboard} />
        </View>
    );
});
