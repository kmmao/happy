/**
 * Renders an image or file attachment inside a chat message bubble.
 *
 * For images: loads data on-demand via `sessionReadFile` RPC (base64) and
 * displays with expo-image. Tapping navigates to a full-screen viewer.
 *
 * For non-image files: displays a file card with icon + filename.
 *
 * States: loading → loaded | error
 */

import * as React from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from './StyledText';
import { sessionReadFile } from '@/sync/ops';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';

const MAX_IMAGE_WIDTH = 240;
const MAX_IMAGE_HEIGHT = 240;

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif'];

function getFileIcon(ext: string): React.ComponentProps<typeof Ionicons>['name'] {
    if (IMAGE_EXTS.includes(ext)) return 'image';
    if (['.pdf'].includes(ext)) return 'document-text-outline';
    if (['.xls', '.xlsx', '.csv'].includes(ext)) return 'grid-outline';
    if (['.doc', '.docx', '.txt', '.rtf', '.md'].includes(ext)) return 'document-text-outline';
    if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return 'archive-outline';
    if (['.mp3', '.wav', '.aac', '.flac', '.ogg'].includes(ext)) return 'musical-note-outline';
    if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'videocam-outline';
    if (['.json', '.xml', '.yaml', '.yml', '.toml'].includes(ext)) return 'code-slash-outline';
    return 'document-outline';
}

type LoadState =
    | { status: 'loading' }
    | { status: 'loaded'; uri: string }
    | { status: 'error' };

export const MessageImage = React.memo((props: {
    sessionId: string;
    imagePath: string;
    displayName?: string;
}) => {
    const nameForExt = props.displayName ?? props.imagePath;
    const ext = nameForExt.slice(nameForExt.lastIndexOf('.')).toLowerCase();
    const isImage = IMAGE_EXTS.includes(ext);

    const [state, setState] = React.useState<LoadState>(
        isImage ? { status: 'loading' } : { status: 'error' },
    );
    const { theme } = useUnistyles();
    const router = useRouter();

    React.useEffect(() => {
        if (!isImage) return;
        let cancelled = false;

        async function load() {
            try {
                const response = await sessionReadFile(props.sessionId, props.imagePath);
                if (cancelled) return;

                if (response.success && response.content) {
                    setState({
                        status: 'loaded',
                        uri: `data:image/jpeg;base64,${response.content}`,
                    });
                } else {
                    setState({ status: 'error' });
                }
            } catch {
                if (!cancelled) {
                    setState({ status: 'error' });
                }
            }
        }

        load();
        return () => { cancelled = true; };
    }, [props.sessionId, props.imagePath, isImage]);

    const handlePress = React.useCallback(() => {
        if (!isImage || state.status !== 'loaded') return;
        router.push(
            `/session/${props.sessionId}/image?path=${encodeURIComponent(props.imagePath)}`,
        );
    }, [state.status, props.sessionId, props.imagePath, router, isImage]);

    // Non-image file: render a file card
    if (!isImage) {
        const fileName = props.displayName ?? props.imagePath.slice(props.imagePath.lastIndexOf('/') + 1);
        const icon = getFileIcon(ext);
        return (
            <View style={[styles.fileCard, { backgroundColor: theme.colors.surfaceHighest }]}>
                <View style={[styles.fileIconContainer, { backgroundColor: `${theme.colors.success}18` }]}>
                    <Ionicons name={icon} size={20} color={theme.colors.success} />
                </View>
                <View style={styles.fileInfo}>
                    <Text
                        style={[styles.fileName, { color: theme.colors.text }]}
                        numberOfLines={1}
                        ellipsizeMode="middle"
                    >
                        {fileName}
                    </Text>
                    <Text style={[styles.fileExt, { color: theme.colors.textSecondary }]}>
                        {ext.replace('.', '').toUpperCase()}
                    </Text>
                </View>
            </View>
        );
    }

    if (state.status === 'loading') {
        return (
            <View style={styles.placeholder}>
                <ActivityIndicator size="small" />
            </View>
        );
    }

    if (state.status === 'error') {
        return (
            <View style={styles.placeholder}>
                <Ionicons name="image-outline" size={24} color={theme.colors.textSecondary} />
                <Text style={styles.errorText}>{t('session.imageLoadFailed')}</Text>
            </View>
        );
    }

    return (
        <Pressable onPress={handlePress} style={({ pressed }) => [pressed && styles.pressed]} accessibilityLabel="View image" accessibilityRole="image">
            <Image
                source={{ uri: state.uri }}
                style={{ width: MAX_IMAGE_WIDTH, height: MAX_IMAGE_HEIGHT }}
                contentFit="cover"
                recyclingKey={props.imagePath}
                transition={200}
            />
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    placeholder: {
        width: MAX_IMAGE_WIDTH,
        height: 120,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHighest,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
    },
    errorText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    pressed: {
        opacity: 0.7,
    },
    fileCard: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 10,
        padding: 10,
        gap: 10,
        maxWidth: MAX_IMAGE_WIDTH,
    },
    fileIconContainer: {
        width: 36,
        height: 36,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fileInfo: {
        flex: 1,
        gap: 2,
    },
    fileName: {
        fontSize: 13,
        ...Typography.default('semiBold'),
    },
    fileExt: {
        fontSize: 11,
    },
}));
