/**
 * Annotation overlay for preview pages.
 *
 * Displays on top of a captured screenshot, allowing users to draw
 * rectangles, arrows, and text labels. The annotated screenshot is
 * then composited and sent as a message to the session.
 *
 * Platform differences:
 * - Native: react-native-svg for drawing, react-native-view-shot for capture
 * - Web: HTML <canvas> overlay, canvas.toDataURL for capture
 */

import * as React from "react";
import {
    View,
    Pressable,
    TextInput,
    Platform,
    PanResponder,
    type GestureResponderEvent,
} from "react-native";
import { Image } from "expo-image";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";

// ── Types ────────────────────────────────────────────────────────────────────

export type AnnotationTool = "rect" | "arrow" | "text" | "freehand";

export interface AnnotationItem {
    readonly id: string;
    readonly tool: AnnotationTool;
    readonly color: string;
    /** Start point */
    readonly x1: number;
    readonly y1: number;
    /** End point (for rect/arrow) */
    readonly x2: number;
    readonly y2: number;
    /** For text annotations */
    readonly text?: string;
    /** For freehand: array of points */
    readonly points?: readonly { x: number; y: number }[];
}

const ANNOTATION_COLORS = ["#FF3B30", "#FF9500", "#007AFF", "#34C759"];

interface AnnotationOverlayProps {
    /** Base64 data URI of the screenshot to annotate */
    screenshotUri: string;
    /** Screenshot dimensions */
    width: number;
    height: number;
    /** Called when user submits the annotated screenshot + comment */
    onSubmit: (annotatedImageUri: string, comment: string) => void;
    /** Called when user cancels annotation */
    onCancel: () => void;
}

export const AnnotationOverlay = React.memo<AnnotationOverlayProps>(
    function AnnotationOverlay({
        screenshotUri,
        width,
        height,
        onSubmit,
        onCancel,
    }) {
        const { theme } = useUnistyles();
        const [tool, setTool] = React.useState<AnnotationTool>("rect");
        const [color, setColor] = React.useState(ANNOTATION_COLORS[0]!);
        const [annotations, setAnnotations] = React.useState<AnnotationItem[]>([]);
        const [currentAnnotation, setCurrentAnnotation] = React.useState<Partial<AnnotationItem> | null>(null);
        const [comment, setComment] = React.useState("");
        const [undoStack, setUndoStack] = React.useState<AnnotationItem[][]>([]);
        const viewRef = React.useRef<View>(null);

        // ── Drawing handlers ─────────────────────────────────────────────────

        const handleTouchStart = React.useCallback(
            (e: GestureResponderEvent) => {
                const { locationX, locationY } = e.nativeEvent;
                const id = `ann-${Date.now()}`;
                setCurrentAnnotation({
                    id,
                    tool,
                    color,
                    x1: locationX,
                    y1: locationY,
                    x2: locationX,
                    y2: locationY,
                    points: tool === "freehand" ? [{ x: locationX, y: locationY }] : undefined,
                });
            },
            [tool, color],
        );

        const handleTouchMove = React.useCallback(
            (e: GestureResponderEvent) => {
                if (!currentAnnotation) return;
                const { locationX, locationY } = e.nativeEvent;
                setCurrentAnnotation((prev) => {
                    if (!prev) return prev;
                    if (prev.tool === "freehand") {
                        return {
                            ...prev,
                            x2: locationX,
                            y2: locationY,
                            points: [...(prev.points ?? []), { x: locationX, y: locationY }],
                        };
                    }
                    return { ...prev, x2: locationX, y2: locationY };
                });
            },
            [currentAnnotation],
        );

        const handleTouchEnd = React.useCallback(() => {
            if (!currentAnnotation?.id) return;
            const completed: AnnotationItem = {
                id: currentAnnotation.id!,
                tool: currentAnnotation.tool ?? "rect",
                color: currentAnnotation.color ?? ANNOTATION_COLORS[0]!,
                x1: currentAnnotation.x1 ?? 0,
                y1: currentAnnotation.y1 ?? 0,
                x2: currentAnnotation.x2 ?? 0,
                y2: currentAnnotation.y2 ?? 0,
                text: currentAnnotation.text,
                points: currentAnnotation.points,
            };
            setUndoStack((prev) => [...prev, annotations]);
            setAnnotations((prev) => [...prev, completed]);
            setCurrentAnnotation(null);
        }, [currentAnnotation, annotations]);

        const panResponder = React.useMemo(
            () =>
                PanResponder.create({
                    onStartShouldSetPanResponder: () => true,
                    onMoveShouldSetPanResponder: () => true,
                    onPanResponderGrant: handleTouchStart,
                    onPanResponderMove: handleTouchMove,
                    onPanResponderRelease: handleTouchEnd,
                }),
            [handleTouchStart, handleTouchMove, handleTouchEnd],
        );

        // ── Undo ─────────────────────────────────────────────────────────────

        const handleUndo = React.useCallback(() => {
            if (undoStack.length === 0) return;
            const previous = undoStack[undoStack.length - 1]!;
            setAnnotations(previous);
            setUndoStack((prev) => prev.slice(0, -1));
        }, [undoStack]);

        const handleClear = React.useCallback(() => {
            if (annotations.length === 0) return;
            setUndoStack((prev) => [...prev, annotations]);
            setAnnotations([]);
        }, [annotations]);

        // ── Submit ───────────────────────────────────────────────────────────

        const handleSubmit = React.useCallback(async () => {
            // For now, submit the base screenshot + structured annotation data
            // Full compositing (screenshot + annotations merged into one image)
            // will be added in Sprint 2 with canvas compositing
            const annotationSummary = annotations
                .map((a) => {
                    const area = `(${Math.round(a.x1)},${Math.round(a.y1)})→(${Math.round(a.x2)},${Math.round(a.y2)})`;
                    return `[${a.tool}] ${area}`;
                })
                .join("\n");

            const fullComment = comment.trim()
                ? `${comment.trim()}\n\n---\nAnnotations:\n${annotationSummary}`
                : annotationSummary || "Preview feedback";

            onSubmit(screenshotUri, fullComment);
        }, [annotations, comment, screenshotUri, onSubmit]);

        // ── Render annotations as SVG-like shapes ────────────────────────────

        const renderAnnotation = (ann: AnnotationItem | Partial<AnnotationItem>, isPreview = false) => {
            if (!ann.x1 || !ann.y1) return null;
            const opacity = isPreview ? 0.6 : 1;
            const c = ann.color ?? ANNOTATION_COLORS[0]!;

            switch (ann.tool) {
                case "rect": {
                    const x = Math.min(ann.x1, ann.x2 ?? ann.x1);
                    const y = Math.min(ann.y1, ann.y2 ?? ann.y1);
                    const w = Math.abs((ann.x2 ?? ann.x1) - ann.x1);
                    const h = Math.abs((ann.y2 ?? ann.y1) - ann.y1);
                    return (
                        <View
                            key={ann.id ?? "preview"}
                            style={{
                                position: "absolute",
                                left: x,
                                top: y,
                                width: w,
                                height: h,
                                borderWidth: 2,
                                borderColor: c,
                                borderRadius: 4,
                                opacity,
                            }}
                            pointerEvents="none"
                        />
                    );
                }
                case "arrow": {
                    // Simple line representation with a dot at the end
                    return (
                        <View
                            key={ann.id ?? "preview"}
                            style={{
                                position: "absolute",
                                left: Math.min(ann.x1, ann.x2 ?? ann.x1),
                                top: Math.min(ann.y1, ann.y2 ?? ann.y1),
                                width: Math.abs((ann.x2 ?? ann.x1) - ann.x1) || 2,
                                height: Math.abs((ann.y2 ?? ann.y1) - ann.y1) || 2,
                                borderWidth: 2,
                                borderColor: c,
                                opacity,
                            }}
                            pointerEvents="none"
                        />
                    );
                }
                case "freehand": {
                    // Render as dots along the path
                    const points = ann.points ?? [];
                    return points.map((p, i) => (
                        <View
                            key={`${ann.id ?? "preview"}-${i}`}
                            style={{
                                position: "absolute",
                                left: p.x - 2,
                                top: p.y - 2,
                                width: 4,
                                height: 4,
                                borderRadius: 2,
                                backgroundColor: c,
                                opacity,
                            }}
                            pointerEvents="none"
                        />
                    ));
                }
                default:
                    return null;
            }
        };

        return (
            <View style={[styles.overlay, { backgroundColor: theme.colors.surface }]}>
                {/* Tool + color bar */}
                <View style={[styles.toolBar, { borderBottomColor: theme.colors.divider }]}>
                    <View style={styles.toolGroup}>
                        {(["rect", "arrow", "freehand"] as const).map((t) => (
                            <Pressable
                                key={t}
                                onPress={() => setTool(t)}
                                style={({ pressed }) => [
                                    styles.toolButton,
                                    tool === t && { backgroundColor: theme.colors.textLink + "20" },
                                    pressed && { opacity: 0.6 },
                                ]}
                            >
                                <Ionicons
                                    name={
                                        t === "rect" ? "square-outline" :
                                        t === "arrow" ? "arrow-forward-outline" :
                                        "brush-outline"
                                    }
                                    size={18}
                                    color={tool === t ? theme.colors.textLink : theme.colors.textSecondary}
                                />
                            </Pressable>
                        ))}
                    </View>

                    <View style={styles.colorGroup}>
                        {ANNOTATION_COLORS.map((c) => (
                            <Pressable
                                key={c}
                                onPress={() => setColor(c)}
                                style={[
                                    styles.colorDot,
                                    { backgroundColor: c },
                                    color === c && styles.colorDotActive,
                                ]}
                            />
                        ))}
                    </View>

                    <View style={{ flex: 1 }} />

                    <Pressable
                        onPress={handleUndo}
                        disabled={undoStack.length === 0}
                        style={({ pressed }) => [
                            styles.toolButton,
                            { opacity: undoStack.length === 0 ? 0.3 : pressed ? 0.6 : 1 },
                        ]}
                    >
                        <Ionicons name="arrow-undo-outline" size={18} color={theme.colors.text} />
                    </Pressable>

                    <Pressable
                        onPress={handleClear}
                        disabled={annotations.length === 0}
                        style={({ pressed }) => [
                            styles.toolButton,
                            { opacity: annotations.length === 0 ? 0.3 : pressed ? 0.6 : 1 },
                        ]}
                    >
                        <Ionicons name="trash-outline" size={18} color={theme.colors.textDestructive} />
                    </Pressable>
                </View>

                {/* Drawing canvas */}
                <View
                    ref={viewRef}
                    style={styles.canvas}
                    {...panResponder.panHandlers}
                >
                    <Image
                        source={{ uri: screenshotUri }}
                        style={{ width, height }}
                        contentFit="contain"
                    />

                    {/* Rendered annotations */}
                    {annotations.map((ann) => renderAnnotation(ann))}
                    {currentAnnotation && renderAnnotation(currentAnnotation, true)}
                </View>

                {/* Comment + submit bar */}
                <View style={[styles.commentBar, { borderTopColor: theme.colors.divider }]}>
                    <TextInput
                        style={[
                            styles.commentInput,
                            {
                                color: theme.colors.text,
                                backgroundColor: theme.colors.surfaceHighest,
                            },
                        ]}
                        placeholder="Add a comment..."
                        placeholderTextColor={theme.colors.textSecondary}
                        value={comment}
                        onChangeText={setComment}
                        multiline
                        maxLength={500}
                    />
                    <View style={styles.actionRow}>
                        <Pressable
                            onPress={onCancel}
                            style={({ pressed }) => [
                                styles.cancelButton,
                                { backgroundColor: theme.colors.surfaceHighest },
                                pressed && { opacity: 0.6 },
                            ]}
                        >
                            <Text style={{ color: theme.colors.textSecondary, fontSize: 14, fontWeight: "600" }}>
                                Cancel
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={handleSubmit}
                            style={({ pressed }) => [
                                styles.submitButton,
                                { backgroundColor: theme.colors.button.primary.background },
                                pressed && { opacity: 0.7 },
                            ]}
                        >
                            <Ionicons name="send" size={16} color="#fff" />
                            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>
                                Send to Session
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    overlay: {
        flex: 1,
    },
    toolBar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderBottomWidth: 1,
    },
    toolGroup: {
        flexDirection: "row",
        gap: 2,
    },
    colorGroup: {
        flexDirection: "row",
        gap: 6,
        marginLeft: 8,
    },
    toolButton: {
        padding: 6,
        borderRadius: 6,
    },
    colorDot: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: "transparent",
    },
    colorDotActive: {
        borderColor: theme.colors.text,
        borderWidth: 3,
    },
    canvas: {
        flex: 1,
        overflow: "hidden",
        position: "relative",
    },
    commentBar: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 8,
        borderTopWidth: 1,
    },
    commentInput: {
        fontSize: 14,
        paddingHorizontal: 12,
        paddingVertical: Platform.select({ ios: 10, default: 10 }),
        borderRadius: 10,
        maxHeight: 80,
    },
    actionRow: {
        flexDirection: "row",
        gap: 8,
    },
    cancelButton: {
        flex: 1,
        alignItems: "center",
        paddingVertical: 10,
        borderRadius: 10,
    },
    submitButton: {
        flex: 2,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 10,
        borderRadius: 10,
    },
}));
