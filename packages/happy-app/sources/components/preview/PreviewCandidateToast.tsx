/**
 * Dismissible toast that appears when a new candidate dev server is detected.
 * Auto-dismisses after 8 seconds.
 */

import * as React from "react";
import { View, Pressable, Animated } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import type { PreviewCandidate } from "@kmmao/happy-wire";

interface PreviewCandidateToastProps {
    candidate: PreviewCandidate | null;
    onView: () => void;
    onDismiss: () => void;
}

export const PreviewCandidateToast = React.memo<PreviewCandidateToastProps>(
    function PreviewCandidateToast({ candidate, onView, onDismiss }) {
        const { theme } = useUnistyles();
        const slideAnim = React.useRef(new Animated.Value(-100)).current;
        const fadeAnim = React.useRef(new Animated.Value(0)).current;
        const lastShownIdRef = React.useRef<string | null>(null);
        const autoDismissTimerRef = React.useRef<NodeJS.Timeout | null>(null);

        // Show toast when new candidate appears
        React.useEffect(() => {
            if (!candidate || candidate.id === lastShownIdRef.current) {
                return;
            }

            lastShownIdRef.current = candidate.id;

            // Clear any existing auto-dismiss timer
            if (autoDismissTimerRef.current) {
                clearTimeout(autoDismissTimerRef.current);
            }

            // Slide down and fade in
            Animated.parallel([
                Animated.timing(slideAnim, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                }),
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }),
            ]).start();

            // Auto-dismiss after 8 seconds
            autoDismissTimerRef.current = setTimeout(() => {
                handleDismiss();
            }, 8000);

            return () => {
                if (autoDismissTimerRef.current) {
                    clearTimeout(autoDismissTimerRef.current);
                }
            };
        }, [candidate?.id]);

        const handleDismiss = () => {
            // Slide up and fade out
            Animated.parallel([
                Animated.timing(slideAnim, {
                    toValue: -100,
                    duration: 300,
                    useNativeDriver: true,
                }),
                Animated.timing(fadeAnim, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                }),
            ]).start(() => {
                onDismiss();
            });
        };

        // Don't render if no candidate or already shown
        if (!candidate || candidate.id === lastShownIdRef.current) {
            return null;
        }

        const description = candidate.devServerType
            ? `${candidate.devServerType} at ${candidate.host}:${candidate.port}`
            : `${candidate.host}:${candidate.port}`;

        return (
            <Animated.View
                style={[
                    styles.container,
                    {
                        transform: [{ translateY: slideAnim }],
                        opacity: fadeAnim,
                    },
                ]}
            >
                <View style={[styles.toast, { backgroundColor: theme.colors.button.primary.background }]}>
                    <View style={styles.content}>
                        <Ionicons name="rocket" size={18} color="#fff" />
                        <View style={styles.textContainer}>
                            <Text style={styles.title}>{t("preview.candidateDetected")}</Text>
                            <Text style={styles.description} numberOfLines={1}>
                                {description}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.actions}>
                        <Pressable
                            onPress={onView}
                            style={({ pressed }) => [
                                styles.viewButton,
                                { opacity: pressed ? 0.7 : 1 },
                            ]}
                        >
                            <Text style={styles.viewButtonText}>{t("preview.viewPreview")}</Text>
                        </Pressable>
                        <Pressable
                            onPress={handleDismiss}
                            style={({ pressed }) => [
                                styles.closeButton,
                                { opacity: pressed ? 0.7 : 1 },
                            ]}
                        >
                            <Ionicons name="close" size={18} color="#fff" />
                        </Pressable>
                    </View>
                </View>
            </Animated.View>
        );
    },
);

const styles = StyleSheet.create((_theme) => ({
    container: {
        position: "absolute",
        top: 16,
        left: 16,
        right: 16,
        zIndex: 100,
    },
    toast: {
        borderRadius: 10,
        padding: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    content: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    textContainer: {
        flex: 1,
        gap: 2,
    },
    title: {
        fontSize: 13,
        fontWeight: "600",
        color: "#fff",
    },
    description: {
        fontSize: 12,
        fontWeight: "400",
        color: "#fff",
        opacity: 0.9,
    },
    actions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    viewButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: "rgba(255, 255, 255, 0.2)",
    },
    viewButtonText: {
        fontSize: 12,
        fontWeight: "600",
        color: "#fff",
    },
    closeButton: {
        padding: 4,
    },
}));
