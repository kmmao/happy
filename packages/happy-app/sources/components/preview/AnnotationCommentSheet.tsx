/**
 * Bottom sheet for visual annotation comments.
 * Shows the selected element info and lets the user write feedback.
 */

import * as React from "react";
import {
    View,
    TextInput,
    Pressable,
    KeyboardAvoidingView,
    Platform,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";

interface AnnotationCommentSheetProps {
    /** The annotation payload from the injected script. */
    annotation: any; // VisualAnnotationAnchor payload
    /** Called when user submits a comment. */
    onSubmit: (comment: string) => void;
    /** Called when user dismisses the sheet. */
    onDismiss: () => void;
}

export const AnnotationCommentSheet = React.memo<AnnotationCommentSheetProps>(
    function AnnotationCommentSheet({ annotation, onSubmit, onDismiss }) {
        const { theme } = useUnistyles();
        const [comment, setComment] = React.useState("");
        const inputRef = React.useRef<TextInput>(null);

        React.useEffect(() => {
            // Auto-focus the input
            setTimeout(() => inputRef.current?.focus(), 300);
        }, []);

        const handleSubmit = React.useCallback(() => {
            if (!comment.trim()) return;
            onSubmit(comment.trim());
            setComment("");
        }, [comment, onSubmit]);

        const target = annotation?.target;

        return (
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={styles.container}
            >
                <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={[styles.title, { color: theme.colors.text }]}>
                            {t("preview.annotationTitle")}
                        </Text>
                        <Pressable onPress={onDismiss} hitSlop={8}>
                            <Ionicons
                                name="close"
                                size={20}
                                color={theme.colors.textSecondary}
                            />
                        </Pressable>
                    </View>

                    {/* Selected element info */}
                    {target && (
                        <View
                            style={[
                                styles.elementInfo,
                                { backgroundColor: theme.colors.surfaceHighest },
                            ]}
                        >
                            <Text
                                style={[styles.elementTag, { color: theme.colors.textLink }]}
                            >
                                {"<"}
                                {target.tag}
                                {target.id ? ` id="${target.id}"` : ""}
                                {">"}
                            </Text>
                            {target.text && (
                                <Text
                                    numberOfLines={2}
                                    style={[
                                        styles.elementText,
                                        { color: theme.colors.textSecondary },
                                    ]}
                                >
                                    {target.text}
                                </Text>
                            )}
                            <Text
                                style={[
                                    styles.elementSelector,
                                    { color: theme.colors.textSecondary },
                                ]}
                            >
                                {target.selector}
                            </Text>
                        </View>
                    )}

                    {/* Comment input */}
                    <TextInput
                        ref={inputRef}
                        value={comment}
                        onChangeText={setComment}
                        placeholder={t("preview.annotationPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        multiline
                        style={[
                            styles.input,
                            {
                                color: theme.colors.text,
                                backgroundColor: theme.colors.surfaceHighest,
                                borderColor: theme.colors.textSecondary,
                            },
                        ]}
                        onSubmitEditing={handleSubmit}
                        blurOnSubmit={false}
                    />

                    {/* Send button */}
                    <Pressable
                        onPress={handleSubmit}
                        disabled={!comment.trim()}
                        style={[
                            styles.sendButton,
                            {
                                backgroundColor: comment.trim()
                                    ? theme.colors.textLink
                                    : theme.colors.surfaceHighest,
                            },
                        ]}
                    >
                        <Ionicons
                            name="send"
                            size={16}
                            color={
                                comment.trim() ? "#fff" : theme.colors.textSecondary
                            }
                        />
                        <Text
                            style={{
                                color: comment.trim()
                                    ? "#fff"
                                    : theme.colors.textSecondary,
                                fontWeight: "600",
                                fontSize: 14,
                                marginLeft: 6,
                            }}
                        >
                            {t("common.submit")}
                        </Text>
                    </Pressable>
                </View>
            </KeyboardAvoidingView>
        );
    },
);

const styles = StyleSheet.create((_theme) => ({
    container: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
    },
    sheet: {
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        padding: 16,
        gap: 12,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 8,
    },
    header: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    title: {
        fontSize: 15,
        fontWeight: "600",
    },
    elementInfo: {
        padding: 10,
        borderRadius: 8,
        gap: 4,
    },
    elementTag: {
        fontSize: 13,
        fontWeight: "600",
        fontFamily: Platform.select({
            ios: "Menlo",
            android: "monospace",
            default: "monospace",
        }),
    },
    elementText: {
        fontSize: 12,
    },
    elementSelector: {
        fontSize: 11,
        fontFamily: Platform.select({
            ios: "Menlo",
            android: "monospace",
            default: "monospace",
        }),
    },
    input: {
        minHeight: 60,
        maxHeight: 120,
        borderRadius: 8,
        borderWidth: 1,
        padding: 10,
        fontSize: 14,
        textAlignVertical: "top",
    },
    sendButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 10,
        borderRadius: 8,
    },
}));
