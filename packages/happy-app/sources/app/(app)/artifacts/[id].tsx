import React from 'react';
import { View, ScrollView, Pressable, Platform } from 'react-native';
import { Text } from '@/components/StyledText';
import { useArtifact } from '@/sync/storage';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { useLayout } from '@/components/layout';
import { Ionicons } from '@expo/vector-icons';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { deleteArtifact } from '@/sync/apiArtifacts';
import { storage } from '@/sync/storage';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { log } from '@/log';
import { SharedStateView } from '@/components/SharedStateView';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollView: {
        flex: 1,
    },
    contentContainer: {
        padding: 16,
        paddingBottom: 100,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    errorContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    errorIcon: {
        marginBottom: 16,
        color: theme.colors.textDestructive,
    },
    errorText: {
        fontSize: 16,
        color: theme.colors.text,
        textAlign: 'center',
    },
    titleContainer: {
        marginBottom: 24,
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: theme.colors.text,
        marginBottom: 8,
    },
    untitledTitle: {
        color: theme.colors.textSecondary,
        fontStyle: 'italic',
    },
    meta: {
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    bodyContainer: {
        minHeight: 200,
    },
    emptyBody: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        fontStyle: 'italic',
        lineHeight: 22,
    },
}));

function ArtifactDetailScreen() {
    const layout = useLayout();
    const styles = stylesheet;
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const artifact = useArtifact(id);
    const shouldLoadArtifact = !artifact || artifact.body === undefined;
    const [isLoading, setIsLoading] = React.useState(shouldLoadArtifact);
    const [isDeleting, setIsDeleting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const loadArtifact = React.useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);

            const credentials = sync.getCredentials();
            if (!credentials) {
                throw new Error(t('errors.authenticationFailed'));
            }

            const fullArtifact = await sync.fetchArtifactWithBody(id);
            if (!fullArtifact) {
                throw new Error(t('artifacts.notFound'));
            }

            storage.getState().updateArtifact(fullArtifact);
        } catch (err) {
            log.error('Failed to load artifact:', err);
            setError(err instanceof Error ? err.message : t('artifacts.error'));
        } finally {
            setIsLoading(false);
        }
    }, [id]);

    // Load full artifact with body if not already loaded
    React.useEffect(() => {
        if (!shouldLoadArtifact) return;
        
        let cancelled = false;
        
        (async () => {
            if (!cancelled) {
                await loadArtifact();
            }
        })();
        
        return () => {
            cancelled = true;
        };
    }, [loadArtifact, shouldLoadArtifact]);

    const handleEdit = React.useCallback(() => {
        router.push(`/artifacts/edit/${id}`);
    }, [id, router]);

    const handleDelete = React.useCallback(async () => {
        const confirmed = await Modal.confirm(
            t('artifacts.deleteConfirm'),
            t('artifacts.deleteConfirmDescription'),
            {
                confirmText: t('artifacts.delete'),
                destructive: true,
            }
        );

        if (!confirmed) return;

        try {
            setIsDeleting(true);
            
            const credentials = sync.getCredentials();
            if (!credentials) {
                throw new Error('Not authenticated');
            }

            await deleteArtifact(credentials, id);
            storage.getState().deleteArtifact(id);
            
            // Navigate back
            router.back();
        } catch (err) {
            log.error('Failed to delete artifact:', err);
            Modal.alert(
                t('common.error'),
                'Failed to delete artifact'
            );
        } finally {
            setIsDeleting(false);
        }
    }, [id, router]);

    // Format date
    const formattedDate = React.useMemo(() => {
        if (!artifact) return '';
        return new Date(artifact.updatedAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }, [artifact]);

    if (isLoading) {
        return (
            <View style={styles.container}>
                <Stack.Screen 
                    options={{
                        headerShown: true,
                        headerTitle: t('artifacts.loading'),
                    }}
                />
                <SharedStateView kind="loading" title={t('artifacts.loading')} />
            </View>
        );
    }

    if (error || !artifact) {
        const artifactError = error ?? t('artifacts.notFound');
        return (
            <View style={styles.container}>
                <Stack.Screen 
                    options={{
                        headerShown: true,
                        headerTitle: t('common.error'),
                    }}
                />
                <SharedStateView
                    kind="error"
                    title={
                        artifactError === t('artifacts.notFound')
                            ? artifactError
                            : t('common.error')
                    }
                    description={
                        artifactError === t('artifacts.notFound')
                            ? undefined
                            : artifactError
                    }
                    onAction={
                        artifactError === t('artifacts.notFound')
                            ? undefined
                            : () => {
                                void loadArtifact();
                            }
                    }
                />
            </View>
        );
    }

    return (
        <>
            <Stack.Screen 
                options={{
                    headerShown: true,
                    headerTitle: artifact.title || t('artifacts.untitled'),
                    headerRight: () => (
                        <View style={{ flexDirection: 'row' }}>
                            <Pressable
                                onPress={handleEdit}
                                style={{ padding: 8, marginRight: 8 }}
                                disabled={isDeleting}
                            >
                                <Ionicons name="create-outline" size={22} color={styles.title.color} />
                            </Pressable>
                            <Pressable
                                onPress={handleDelete}
                                style={{ padding: 8 }}
                                disabled={isDeleting}
                            >
                                <Ionicons 
                                    name="trash-outline" 
                                    size={22} 
                                    color={isDeleting ? styles.meta.color : styles.errorIcon.color} 
                                />
                            </Pressable>
                        </View>
                    ),
                }}
            />
            <View style={styles.container}>
                <ScrollView 
                    style={styles.scrollView}
                    contentContainerStyle={[
                        styles.contentContainer,
                        { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }
                    ]}
                >
                    <View style={styles.titleContainer}>
                        <Text 
                            style={[
                                styles.title,
                                !artifact.title && styles.untitledTitle
                            ]}
                        >
                            {artifact.title || t('artifacts.untitled')}
                        </Text>
                        <Text style={styles.meta}>
                            {formattedDate}
                        </Text>
                    </View>

                    <View style={styles.bodyContainer}>
                        {artifact.body ? (
                            <MarkdownView markdown={artifact.body} />
                        ) : (
                            <Text style={styles.emptyBody}>
                                No content
                            </Text>
                        )}
                    </View>
                </ScrollView>
            </View>
        </>
    );
}

export default React.memo(ArtifactDetailScreen);
