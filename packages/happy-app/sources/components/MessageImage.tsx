/**
 * Renders an image attachment inside a chat message bubble.
 *
 * Loads image data on-demand via `sessionReadFile` RPC (base64) and displays
 * it with expo-image. Tapping the image navigates to a full-screen viewer.
 *
 * States: loading → loaded | error
 */

import * as React from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from './StyledText';
import { sessionReadFile } from '@/sync/ops';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';

const MAX_IMAGE_WIDTH = 240;
const MAX_IMAGE_HEIGHT = 240;

type LoadState =
    | { status: 'loading' }
    | { status: 'loaded'; uri: string }
    | { status: 'error' };

export const MessageImage = React.memo((props: {
    sessionId: string;
    imagePath: string;
}) => {
    const [state, setState] = React.useState<LoadState>({ status: 'loading' });
    const router = useRouter();

    React.useEffect(() => {
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
    }, [props.sessionId, props.imagePath]);

    const handlePress = React.useCallback(() => {
        if (state.status !== 'loaded') return;
        router.push(
            `/session/${props.sessionId}/image?path=${encodeURIComponent(props.imagePath)}`,
        );
    }, [state.status, props.sessionId, props.imagePath, router]);

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
                <Ionicons name="image-outline" size={24} color="#999" />
                <Text style={styles.errorText}>{t('session.imageLoadFailed')}</Text>
            </View>
        );
    }

    return (
        <Pressable onPress={handlePress} style={({ pressed }) => [pressed && styles.pressed]}>
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
}));
