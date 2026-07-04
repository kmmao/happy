import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { useLayout } from "./layout";
const DOT_COUNT = 3;
const DOT_SIZE = 7;
const DOT_GAP = 5;
const STAGGER_DELAY = 250;
const DOT_DURATION = 600;
const BREATH_DURATION = 1800;
const BREATH_DOT_SIZE = 10;
const FADE_IN_DURATION = 200;

export const TypingBubble = React.memo((props: { contentMaxWidth?: number; label?: string }) => {
    const layout = useLayout();
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const breathAnim = useRef(new Animated.Value(0)).current;
    const dotAnims = useRef<Animated.Value[]>(
        Array.from({ length: DOT_COUNT }, () => new Animated.Value(0)),
    ).current;

    // Fade in on mount
    useEffect(() => {
        Animated.timing(fadeAnim, {
            toValue: 1,
            duration: FADE_IN_DURATION,
            useNativeDriver: true,
        }).start();
    }, [fadeAnim]);

    // Breathing dot animation: scale + opacity loop
    useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(breathAnim, {
                    toValue: 1,
                    duration: BREATH_DURATION,
                    useNativeDriver: true,
                }),
                Animated.timing(breathAnim, {
                    toValue: 0,
                    duration: BREATH_DURATION,
                    useNativeDriver: true,
                }),
            ]),
        );
        animation.start();
        return () => animation.stop();
    }, [breathAnim]);

    // Staggered wave animation for the three dots
    useEffect(() => {
        let cancelled = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const runningAnimations: Animated.CompositeAnimation[] = [];

        dotAnims.forEach((anim, i) => {
            const timer = setTimeout(() => {
                if (cancelled) return;
                const animation = Animated.loop(
                    Animated.sequence([
                        Animated.timing(anim, {
                            toValue: 1,
                            duration: DOT_DURATION,
                            useNativeDriver: true,
                        }),
                        Animated.timing(anim, {
                            toValue: 0,
                            duration: DOT_DURATION,
                            useNativeDriver: true,
                        }),
                    ]),
                );
                runningAnimations.push(animation);
                animation.start();
            }, i * STAGGER_DELAY);
            timers.push(timer);
        });

        return () => {
            cancelled = true;
            timers.forEach(clearTimeout);
            runningAnimations.forEach((a) => a.stop());
            dotAnims.forEach((anim) => anim.setValue(0));
        };
    }, [dotAnims]);

    const breathScale = breathAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.85, 1.2],
    });
    const breathOpacity = breathAnim.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.4, 1, 0.4],
    });

    return (
        <View style={styles.container}>
            <Animated.View style={[styles.row, { opacity: fadeAnim, maxWidth: props.contentMaxWidth ?? layout.maxWidth }]}>
                <View style={styles.avatarSlot}>
                    <Animated.View
                        style={[
                            styles.breathDot,
                            {
                                transform: [{ scale: breathScale }],
                                opacity: breathOpacity,
                            },
                        ]}
                    />
                </View>
                <View style={styles.bubble}>
                    <View style={styles.dotsRow}>
                        {dotAnims.map((anim, i) => {
                            const scale = anim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.85, 1.15],
                            });
                            const opacity = anim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.3, 1],
                            });
                            return (
                                <Animated.View
                                    key={i}
                                    style={[
                                        styles.dot,
                                        {
                                            opacity,
                                            transform: [{ scale }],
                                        },
                                    ]}
                                />
                            );
                        })}
                        {props.label ? (
                            <Text style={styles.label} numberOfLines={1}>
                                {props.label}
                            </Text>
                        ) : null}
                    </View>
                </View>
            </Animated.View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: "row",
        justifyContent: "center",
        marginTop: 8,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 8,
        flexGrow: 1,
        flexBasis: 0,
    },
    avatarSlot: {
        width: 32,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    breathDot: {
        width: BREATH_DOT_SIZE,
        height: BREATH_DOT_SIZE,
        borderRadius: BREATH_DOT_SIZE / 2,
        backgroundColor: theme.colors.userMessageBackground,
    },
    bubble: {
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginRight: 16,
        backgroundColor: theme.colors.userMessageBackground,
    },
    dotsRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: DOT_GAP,
        minHeight: DOT_SIZE,
    },
    dot: {
        width: DOT_SIZE,
        height: DOT_SIZE,
        borderRadius: DOT_SIZE / 2,
        backgroundColor: theme.colors.textSecondary,
    },
    label: {
        marginLeft: 4,
        fontSize: 13,
        color: theme.colors.textSecondary,
        flexShrink: 1,
    },
}));
