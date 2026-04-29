import React from 'react';
import { View, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { Text } from '@/components/StyledText';
import { useArtifacts } from '@/sync/storage';
import { DecryptedArtifact } from '@/sync/artifactTypes';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { t } from '@/text';
import { useLayout } from '@/components/layout';
import { sync } from '@/sync/sync';
import { FAB } from '@/components/FAB';
import { SharedStateView } from '@/components/SharedStateView';
import { resolveSharedCollectionState } from '@/components/sharedCollectionState';
// Date formatting

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        paddingBottom: 100,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    emptyIcon: {
        marginBottom: 16,
        color: theme.colors.textSecondary,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: theme.colors.text,
        marginBottom: 8,
        textAlign: 'center',
    },
    emptyDescription: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 20,
    },
    artifactItem: {
        backgroundColor: theme.colors.surface,
        marginHorizontal: 16,
        marginBottom: 1,
        paddingHorizontal: 16,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
    },
    artifactItemFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        marginTop: 16,
    },
    artifactItemLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 16,
    },
    artifactItemSingle: {
        borderRadius: 12,
        marginTop: 16,
        marginBottom: 16,
    },
    artifactContent: {
        flex: 1,
        marginRight: 8,
    },
    artifactTitle: {
        fontSize: 16,
        fontWeight: '500',
        color: theme.colors.text,
        marginBottom: 4,
    },
    artifactUntitled: {
        color: theme.colors.textSecondary,
        fontStyle: 'italic',
    },
    artifactMeta: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    artifactDate: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    artifactChevron: {
        color: theme.colors.textSecondary,
    },
    fab: {
        position: 'absolute',
        bottom: 24,
        right: 24,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: theme.colors.fab.background,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 4,
    },
    fabIcon: {
        color: theme.colors.fab.icon,
    },
}));

function ArtifactsScreen() {
    const layout = useLayout();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const artifacts = useArtifacts();
    const [isLoading, setIsLoading] = React.useState(false);
    const [loadError, setLoadError] = React.useState<string | null>(null);

    const loadArtifacts = React.useCallback(async () => {
        try {
            const credentials = sync.getCredentials();
            if (!credentials) {
                setLoadError(t('errors.authenticationFailed'));
                return;
            }

            setIsLoading(true);
            setLoadError(null);
            await sync.fetchArtifactsList();
        } catch (_error) {
            setLoadError(t('artifacts.error'));
        } finally {
            setIsLoading(false);
        }
    }, []);
    
    // Fetch artifacts on mount
    React.useEffect(() => {
        let cancelled = false;

        (async () => {
            if (!cancelled) {
                await loadArtifacts();
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [loadArtifacts]);

    const artifactsState = resolveSharedCollectionState({
        loading: isLoading,
        error: loadError,
        count: artifacts.length,
    });

    const renderItem = React.useCallback(({ item, index }: { item: DecryptedArtifact; index: number }) => {
        const isFirst = index === 0;
        const isLast = index === artifacts.length - 1;
        const isSingle = artifacts.length === 1;

        return (
            <Pressable
                style={[
                    styles.artifactItem,
                    isSingle ? styles.artifactItemSingle :
                    isFirst ? styles.artifactItemFirst :
                    isLast ? styles.artifactItemLast : {}
                ]}
                onPress={() => router.push(`/artifacts/${item.id}`)}
            >
                <View style={styles.artifactContent}>
                    <Text 
                        style={[
                            styles.artifactTitle,
                            !item.title && styles.artifactUntitled
                        ]}
                        numberOfLines={1}
                    >
                        {item.title || t('artifacts.untitled')}
                    </Text>
                    <View style={styles.artifactMeta}>
                        <Text style={styles.artifactDate}>
                            {new Date(item.updatedAt).toLocaleDateString()}
                        </Text>
                    </View>
                </View>
                <Ionicons 
                    name="chevron-forward" 
                    size={18} 
                    style={styles.artifactChevron}
                    color={theme.colors.textSecondary}
                />
            </Pressable>
        );
    }, [artifacts, router, styles]);

    const keyExtractor = React.useCallback((item: DecryptedArtifact) => item.id, []);

    const ListEmptyComponent = React.useCallback(() => {
        if (artifactsState === 'loading') {
            return (
                <SharedStateView kind="loading" title={t('artifacts.loading')} />
            );
        }

        if (artifactsState === 'error') {
            return (
                <SharedStateView
                    kind="error"
                    title={t('common.error')}
                    description={loadError ?? t('artifacts.error')}
                    onAction={() => {
                        void loadArtifacts();
                    }}
                />
            );
        }

        return (
            <SharedStateView
                kind="empty"
                icon={
                    <Ionicons 
                        name="document-text-outline" 
                        size={64} 
                        style={styles.emptyIcon}
                        color={theme.colors.textSecondary}
                    />
                }
                title={t('artifacts.empty')}
                description={t('artifacts.emptyDescription')}
            />
        );
    }, [artifactsState, loadError, loadArtifacts, styles, theme.colors.textSecondary]);

    return (
        <View style={styles.container}>
            <FlatList
                data={artifacts}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                contentContainerStyle={[
                    styles.contentContainer,
                    artifacts.length === 0 && { flex: 1 },
                    { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }
                ]}
                ListEmptyComponent={ListEmptyComponent}
            />
            
            {/* Floating Action Button */}
            <FAB onPress={() => router.push('/artifacts/new')} accessibilityLabel={t('common.create')} />
        </View>
    );
}

export default React.memo(ArtifactsScreen);
