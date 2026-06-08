import { Ionicons } from "@expo/vector-icons";
import * as React from "react";
import {
    Animated,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "@/constants/Typography";
import { Text } from "./StyledText";
import { t } from "@/text";

export interface QueuedMessageItem {
    localId: string;
    /** Short label shown on the chip. Image-only messages get a fallback string. */
    displayText: string;
    /** Full raw message (including `[image: /path]` tags), used by the preview/edit overlay. */
    fullMessage?: string;
    /** Number of `[image: ...]` segments in fullMessage — drives the camera-badge on the chip. */
    imageCount?: number;
    /** True when displayText is a synthesised "Sent N images" label rather than user text. */
    hasOnlyImages?: boolean;
}

type MessageSegment =
    | { type: "text"; text: string }
    | { type: "image"; uri: string; filename?: string };

/**
 * Parse [image: /path] and [image: /path | filename.ext] tags out of a message string.
 * The filename suffix is preserved so the edit round-trip can re-emit it verbatim — the
 * CLI/agent uses it as a display hint for non-image file attachments (PDFs, etc.).
 */
function parseMessageSegments(message: string): MessageSegment[] {
    const segments: MessageSegment[] = [];
    const imageRegex = /\[image:\s*([^\]]+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = imageRegex.exec(message)) !== null) {
        if (match.index > lastIndex) {
            const text = message.slice(lastIndex, match.index).trim();
            if (text) segments.push({ type: "text", text });
        }
        const raw = match[1]!.trim();
        const pipeIdx = raw.indexOf("|");
        if (pipeIdx >= 0) {
            const uri = raw.slice(0, pipeIdx).trim();
            const filename = raw.slice(pipeIdx + 1).trim();
            segments.push({ type: "image", uri, filename: filename || undefined });
        } else {
            segments.push({ type: "image", uri: raw });
        }
        lastIndex = match.index + match[0].length;
    }

    const remaining = message.slice(lastIndex).trim();
    if (remaining) segments.push({ type: "text", text: remaining });

    return segments;
}

/**
 * Reverse of parseMessageSegments: stitch a sequence of text/image segments back into the
 * canonical `[image: /path]` (or `[image: /path | filename]`) representation the rest of
 * the codebase consumes. Filename suffix is preserved so attachments don't lose their
 * display-name hint across an edit round-trip.
 */
function segmentsToMessage(segments: MessageSegment[]): string {
    const parts: string[] = [];
    for (const seg of segments) {
        if (seg.type === "text") {
            if (seg.text.trim()) parts.push(seg.text);
        } else {
            parts.push(seg.filename ? `[image: ${seg.uri} | ${seg.filename}]` : `[image: ${seg.uri}]`);
        }
    }
    return parts.join("\n");
}

/** Edit-mode image buffer entry — carries the optional filename suffix for round-trip. */
type EditImage = { uri: string; filename?: string };

interface QueuePreviewOverlayProps {
    item: QueuedMessageItem;
    /** Open straight into edit mode (vs. preview). */
    startInEdit?: boolean;
    onClose: () => void;
    onSendNow?: () => void;
    /**
     * Persist the edited content. Returns true on success, false when the item
     * was already shifted out of the queue (race with auto-dispatch).
     */
    onSaveEdit?: (
        localId: string,
        message: string,
        displayText: string | undefined,
    ) => boolean;
    /**
     * Atomically persist the edit and send the message immediately, bypassing
     * the auto-dispatch queue and pause state. Returns true on success, false
     * when the item was already shifted out of the queue.
     */
    onSaveAndSend?: (
        localId: string,
        message: string,
        displayText: string | undefined,
    ) => boolean;
}

/**
 * Bottom-sheet that previews a queued message and (optionally) lets the user
 * edit the text + remove individual images before it is sent. Add-image is
 * intentionally out of scope here — the queue is a transient holding area, not
 * a full composer; if the user needs to add new attachments they can cancel
 * and re-compose in the main input.
 */
export const QueuePreviewOverlay = React.memo(({
    item,
    startInEdit,
    onClose,
    onSendNow,
    onSaveEdit,
    onSaveAndSend,
}: QueuePreviewOverlayProps) => {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();

    const initialSegments = React.useMemo(
        () => parseMessageSegments(item.fullMessage ?? item.displayText),
        [item.fullMessage, item.displayText],
    );

    // Initial buffers derived from initialSegments. Wrapped in a single helper
    // so we can recompute on cancel/reset (V9: cancel reverts to the current
    // saved state — which `initialSegments` now reflects because the parent
    // refreshes `item.fullMessage` after a successful save).
    const deriveInitialText = React.useCallback(
        () =>
            initialSegments
                .filter((s): s is { type: "text"; text: string } => s.type === "text")
                .map((s) => s.text)
                .join("\n"),
        [initialSegments],
    );
    const deriveInitialImages = React.useCallback(
        (): EditImage[] =>
            initialSegments
                .filter((s): s is { type: "image"; uri: string; filename?: string } => s.type === "image")
                .map((s) => ({ uri: s.uri, filename: s.filename })),
        [initialSegments],
    );

    const [isEditing, setIsEditing] = React.useState(!!startInEdit);
    const [editText, setEditText] = React.useState<string>(deriveInitialText);
    const [editImages, setEditImages] = React.useState<EditImage[]>(deriveInitialImages);
    // Track stale-overlay races: if onSaveEdit / onSaveAndSend reports the item
    // is gone, surface it instead of silently dismissing.
    const [staleError, setStaleError] = React.useState(false);

    // V7/V9: when the parent refreshes the item (post-save) we want the
    // editing buffers to reflect the saved content if the user later re-enters
    // edit mode. We do that lazily: once isEditing flips back to false (save
    // succeeded), refresh buffers from initialSegments on the NEXT entry into
    // edit. Until then we leave them alone so the user's just-typed text is
    // preserved between Edit→Save→Edit without a remount.
    const lastSavedFullMessageRef = React.useRef<string | undefined>(item.fullMessage);
    React.useEffect(() => {
        if (!isEditing && lastSavedFullMessageRef.current !== item.fullMessage) {
            lastSavedFullMessageRef.current = item.fullMessage;
            setEditText(deriveInitialText());
            setEditImages(deriveInitialImages());
            setStaleError(false);
        }
    }, [isEditing, item.fullMessage, deriveInitialText, deriveInitialImages]);

    // V10: an empty edit (no text AND no images) should disable Save buttons so
    // the user understands why the action is unavailable, instead of getting a
    // silent no-op.
    const isEmpty = editText.trim().length === 0 && editImages.length === 0;

    const translateY = React.useRef(new Animated.Value(320)).current;
    const backdropOpacity = React.useRef(new Animated.Value(0)).current;
    const isClosingRef = React.useRef(false);

    React.useEffect(() => {
        Animated.parallel([
            Animated.timing(translateY, { toValue: 0, duration: 280, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 240, useNativeDriver: true }),
        ]).start();
    }, [translateY, backdropOpacity]);

    const animateClose = React.useCallback((callback: () => void) => {
        if (isClosingRef.current) return;
        isClosingRef.current = true;
        Keyboard.dismiss();
        Animated.parallel([
            Animated.timing(translateY, { toValue: 320, duration: 220, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        ]).start(() => callback());
    }, [translateY, backdropOpacity]);

    const handleClose = React.useCallback(() => {
        animateClose(onClose);
    }, [animateClose, onClose]);

    const handleSendNow = React.useCallback(() => {
        if (onSendNow) animateClose(onSendNow);
    }, [animateClose, onSendNow]);

    const buildEditedMessage = React.useCallback(() => {
        const trimmedText = editText.trim();
        const segments: MessageSegment[] = [];
        if (trimmedText) segments.push({ type: "text", text: trimmedText });
        for (const img of editImages) {
            segments.push({ type: "image", uri: img.uri, filename: img.filename });
        }
        return segments;
    }, [editText, editImages]);

    const computeDisplayText = React.useCallback(
        (segs: MessageSegment[]) => {
            const text = segs.find((s) => s.type === "text") as
                | { type: "text"; text: string }
                | undefined;
            if (text?.text.trim()) return text.text.trim();
            const imgCount = segs.filter((s) => s.type === "image").length;
            if (imgCount === 0) return undefined;
            return imgCount === 1 ? t("session.sentImage") : t("session.sentImages", { count: imgCount });
        },
        [],
    );

    const handleSave = React.useCallback(() => {
        if (!onSaveEdit) return;
        // isEmpty already disables the button, but the guard stays as a safety
        // net for keyboard-driven activation.
        if (isEmpty) return;
        const segs = buildEditedMessage();
        const ok = onSaveEdit(item.localId, segmentsToMessage(segs), computeDisplayText(segs));
        if (!ok) {
            setStaleError(true);
            return;
        }
        // Drop back to preview mode. The parent will refresh `item` so preview
        // renders the saved content (V7) — initialSegments + the post-save
        // buffer-refresh effect above keep cancel/re-edit in sync (V9).
        setStaleError(false);
        setIsEditing(false);
    }, [onSaveEdit, isEmpty, buildEditedMessage, item.localId, computeDisplayText]);

    const handleSaveAndSend = React.useCallback(() => {
        if (!onSaveAndSend) return;
        if (isEmpty) return;
        const segs = buildEditedMessage();
        // V3: do the save+send synchronously BEFORE animating close. If the
        // item was already shifted out by auto-dispatch, surface a stale error
        // and keep the overlay open — never close on a silently-swallowed race.
        const ok = onSaveAndSend(
            item.localId,
            segmentsToMessage(segs),
            computeDisplayText(segs),
        );
        if (!ok) {
            setStaleError(true);
            return;
        }
        // Success: trigger the slide-out, parent will null out previewQueueItem
        // when the animation completes (via the onClose path).
        animateClose(onClose);
    }, [onSaveAndSend, isEmpty, buildEditedMessage, item.localId, computeDisplayText, animateClose, onClose]);

    const removeEditImage = React.useCallback((idx: number) => {
        setEditImages((prev) => prev.filter((_, i) => i !== idx));
    }, []);

    const previewSegments = initialSegments;
    const previewImages = previewSegments.filter((s): s is { type: "image"; uri: string } => s.type === "image");
    const previewTexts = previewSegments.filter((s): s is { type: "text"; text: string } => s.type === "text");
    // Use a 2-column grid when there are multiple images so the sheet doesn't scroll forever.
    const useGrid = previewImages.length > 1;

    return (
        <View style={modalStyles.overlay} pointerEvents="box-none">
            <Animated.View
                style={[modalStyles.backdrop, { opacity: backdropOpacity }]}
                pointerEvents="auto"
            >
                <Pressable style={modalStyles.backdropPress} onPress={handleClose} />
            </Animated.View>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={modalStyles.kavWrapper}
                pointerEvents="box-none"
            >
                <Animated.View style={[modalStyles.sheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY }] }]}>
                    {/* Handle bar */}
                    <View style={modalStyles.handle} />

                    {/* Header — title + meta + close */}
                    <View style={[modalStyles.modalHeader, { borderBottomColor: theme.colors.divider }]}>
                        <View style={modalStyles.headerTextCol}>
                            <Text style={[modalStyles.modalTitle, { color: theme.colors.text }]}>
                                {isEditing
                                    ? t("session.editQueuedMessage")
                                    : t("session.queuedMessagePreview")}
                            </Text>
                            <View style={modalStyles.metaRow}>
                                {previewImages.length > 0 && (
                                    <View style={modalStyles.metaChip}>
                                        <Ionicons name="image-outline" size={11} color={theme.colors.textSecondary} />
                                        <Text style={[modalStyles.metaChipText, { color: theme.colors.textSecondary }]}>
                                            {t("session.imagesCount", { n: previewImages.length })}
                                        </Text>
                                    </View>
                                )}
                                {previewTexts.length > 0 && (
                                    <Text style={[modalStyles.metaCount, { color: theme.colors.textSecondary }]}>
                                        {t("session.charsCount", {
                                            n: previewTexts.reduce((sum, s) => sum + s.text.length, 0),
                                        })}
                                    </Text>
                                )}
                            </View>
                        </View>
                        {onSaveEdit && !isEditing && (
                            <TouchableOpacity
                                onPress={() => setIsEditing(true)}
                                hitSlop={10}
                                style={modalStyles.editHeaderBtn}
                            >
                                <Ionicons name="pencil" size={16} color={theme.colors.button.primary.background} />
                                <Text style={[modalStyles.editHeaderBtnText, { color: theme.colors.button.primary.background }]}>
                                    {t("session.editMode")}
                                </Text>
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={handleClose} hitSlop={10} style={modalStyles.closeBtn}>
                            <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    {/* Content */}
                    <ScrollView
                        style={modalStyles.scrollView}
                        contentContainerStyle={modalStyles.scrollContent}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        {isEditing ? (
                            <>
                                <View
                                    style={[
                                        modalStyles.editorWrapper,
                                        {
                                            backgroundColor: theme.colors.surfaceHigh,
                                            borderColor: theme.colors.divider,
                                        },
                                    ]}
                                >
                                    <TextInput
                                        value={editText}
                                        onChangeText={setEditText}
                                        multiline
                                        autoFocus={startInEdit}
                                        placeholder={t("session.inputPlaceholder")}
                                        placeholderTextColor={theme.colors.textSecondary}
                                        style={[modalStyles.editor, { color: theme.colors.text }]}
                                    />
                                </View>
                                {editImages.length > 0 && (
                                    <View style={modalStyles.thumbGrid}>
                                        {editImages.map((img, idx) => (
                                            <View key={`${img.uri}-${idx}`} style={[modalStyles.thumbCell, { backgroundColor: theme.colors.surfaceHigh }]}>
                                                <Image
                                                    source={{ uri: img.uri.startsWith("/") ? `file://${img.uri}` : img.uri }}
                                                    style={modalStyles.thumb}
                                                    resizeMode="cover"
                                                />
                                                <TouchableOpacity
                                                    onPress={() => removeEditImage(idx)}
                                                    hitSlop={6}
                                                    style={modalStyles.thumbRemove}
                                                >
                                                    <Ionicons name="close" size={14} color="#fff" />
                                                </TouchableOpacity>
                                            </View>
                                        ))}
                                    </View>
                                )}
                                {staleError && (
                                    <Text style={[modalStyles.staleText, { color: theme.colors.text }]}>
                                        {t("session.queueItemNotFound")}
                                    </Text>
                                )}
                            </>
                        ) : previewSegments.length > 0 ? (
                            <>
                                {previewTexts.map((seg, idx) => (
                                    <View
                                        key={`txt-${idx}`}
                                        style={[
                                            modalStyles.textBlock,
                                            { borderLeftColor: theme.colors.button.primary.background },
                                        ]}
                                    >
                                        <Text style={[modalStyles.fullText, { color: theme.colors.text }]}>
                                            {seg.text}
                                        </Text>
                                    </View>
                                ))}
                                {previewImages.length > 0 && (
                                    <View style={useGrid ? modalStyles.imageGrid : undefined}>
                                        {previewImages.map((seg, idx) => (
                                            <View
                                                key={`img-${idx}`}
                                                style={[
                                                    useGrid ? modalStyles.gridImageWrapper : modalStyles.imageWrapper,
                                                    { backgroundColor: theme.colors.surfaceHigh },
                                                ]}
                                            >
                                                <Image
                                                    source={{ uri: seg.uri.startsWith("/") ? `file://${seg.uri}` : seg.uri }}
                                                    style={useGrid ? modalStyles.gridImage : modalStyles.previewImage}
                                                    resizeMode={useGrid ? "cover" : "contain"}
                                                />
                                            </View>
                                        ))}
                                    </View>
                                )}
                            </>
                        ) : (
                            <Text style={[modalStyles.fullText, { color: theme.colors.textSecondary }]}>
                                {item.displayText}
                            </Text>
                        )}
                    </ScrollView>

                    {/* Footer — context-dependent actions */}
                    {isEditing ? (
                        <View style={[modalStyles.footer, { borderTopColor: theme.colors.divider }]}>
                            <View style={modalStyles.footerRow}>
                                <TouchableOpacity
                                    style={[modalStyles.footerBtn, modalStyles.footerBtnGhost, { borderColor: theme.colors.divider }]}
                                    onPress={() => {
                                        setIsEditing(false);
                                        setStaleError(false);
                                        // V9 fix: reset to initialSegments — which now reflects the
                                        // latest SAVED state because the parent refreshes `item`
                                        // after a successful save (V7), so we no longer revert past
                                        // user-confirmed saves.
                                        setEditText(deriveInitialText());
                                        setEditImages(deriveInitialImages());
                                    }}
                                    activeOpacity={0.8}
                                >
                                    <Text style={[modalStyles.footerBtnGhostText, { color: theme.colors.text }]}>
                                        {t("session.cancelEdit")}
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        modalStyles.footerBtn,
                                        modalStyles.footerBtnGhost,
                                        { borderColor: theme.colors.divider, opacity: isEmpty ? 0.4 : 1 },
                                    ]}
                                    onPress={handleSave}
                                    activeOpacity={0.8}
                                    disabled={isEmpty}
                                >
                                    <Ionicons name="checkmark" size={14} color={theme.colors.text} />
                                    <Text style={[modalStyles.footerBtnGhostText, { color: theme.colors.text }]}>
                                        {t("session.saveChanges")}
                                    </Text>
                                </TouchableOpacity>
                                {onSaveAndSend && (
                                    <TouchableOpacity
                                        style={[
                                            modalStyles.footerBtn,
                                            modalStyles.footerBtnPrimary,
                                            { backgroundColor: theme.colors.button.primary.background, opacity: isEmpty ? 0.4 : 1 },
                                        ]}
                                        onPress={handleSaveAndSend}
                                        activeOpacity={0.8}
                                        disabled={isEmpty}
                                    >
                                        <Ionicons name="play" size={14} color={theme.colors.button.primary.tint} />
                                        <Text style={[modalStyles.footerBtnPrimaryText, { color: theme.colors.button.primary.tint }]}>
                                            {t("session.saveAndSendNow")}
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    ) : onSendNow ? (
                        <View style={[modalStyles.footer, { borderTopColor: theme.colors.divider }]}>
                            <TouchableOpacity
                                style={[modalStyles.sendNowBtn, { backgroundColor: theme.colors.button.primary.background }]}
                                onPress={handleSendNow}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="play" size={14} color={theme.colors.button.primary.tint} />
                                <Text style={[modalStyles.sendNowBtnText, { color: theme.colors.button.primary.tint }]}>
                                    {t("session.sendNow")}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    ) : null}
                </Animated.View>
            </KeyboardAvoidingView>
        </View>
    );
});

QueuePreviewOverlay.displayName = "QueuePreviewOverlay";

interface QueueBannerProps {
    queuedMessages: QueuedMessageItem[];
    onSendNow: () => void;
    onSendItemNow?: (localId: string) => void;
    onCancelItem: (localId: string) => void;
    onOpenPreview?: (item: QueuedMessageItem) => void;
    /** Open the overlay straight into edit mode for this item. */
    onEditItem?: (item: QueuedMessageItem) => void;
    /** Whether the AI is currently processing — controls which actions show. */
    isRunning?: boolean;
    /** True when auto-dispatch is paused; chip ▶ becomes the only way to send. */
    paused?: boolean;
    /** Toggle the paused flag. Undefined hides the pill (e.g. when AI is idle). */
    onTogglePaused?: () => void;
}

export const QueueBanner = React.memo(({
    queuedMessages,
    onSendNow,
    onSendItemNow,
    onCancelItem,
    onOpenPreview,
    onEditItem,
    isRunning,
    paused,
    onTogglePaused,
}: QueueBannerProps) => {
    const { theme } = useUnistyles();
    const count = queuedMessages.length;

    if (count === 0) return null;

    return (
        <View style={styles.container}>
            {/* Header row */}
            <View style={styles.header}>
                <Ionicons
                    name="time-outline"
                    size={12}
                    color={theme.colors.textSecondary}
                    style={{ marginRight: 5 }}
                />
                <Text style={[styles.headerLabel, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                    {paused
                        ? t("session.queuePausedWithCount", { n: count })
                        : t("session.messagesQueued", { n: count })}
                </Text>
                {onTogglePaused && (
                    <Pressable
                        onPress={onTogglePaused}
                        hitSlop={8}
                        style={({ pressed }) => [
                            styles.headerPill,
                            {
                                backgroundColor: paused
                                    ? `${theme.colors.button.primary.background}24`
                                    : `${theme.colors.textSecondary}18`,
                            },
                            pressed && { opacity: 0.7 },
                        ]}
                    >
                        <Ionicons
                            name={paused ? "play" : "pause"}
                            size={9}
                            color={paused ? theme.colors.button.primary.background : theme.colors.textSecondary}
                        />
                        <Text
                            style={[
                                styles.headerPillText,
                                { color: paused ? theme.colors.button.primary.background : theme.colors.textSecondary },
                            ]}
                        >
                            {paused ? t("session.resumeQueue") : t("session.pauseQueue")}
                        </Text>
                    </Pressable>
                )}
                {isRunning && (
                    <Pressable
                        onPress={onSendNow}
                        hitSlop={8}
                        style={({ pressed }) => [
                            styles.headerPill,
                            { backgroundColor: `${theme.colors.button.primary.background}18` },
                            pressed && { opacity: 0.7 },
                        ]}
                    >
                        <Ionicons
                            name="play"
                            size={9}
                            color={theme.colors.button.primary.background}
                        />
                        <Text style={[styles.headerPillText, { color: theme.colors.button.primary.background }]}>
                            {t("session.sendNow")}
                        </Text>
                    </Pressable>
                )}
            </View>

            {/* Message chips — horizontal scroll */}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.list}
            >
                {queuedMessages.map((msg) => {
                    const imageCount = msg.imageCount ?? 0;
                    return (
                        <Pressable
                            key={msg.localId}
                            style={({ pressed }) => [
                                styles.chip,
                                { backgroundColor: `${theme.colors.textSecondary}12` },
                                pressed && { opacity: 0.7 },
                            ]}
                            onPress={() => onOpenPreview?.(msg)}
                        >
                            {imageCount > 0 && (
                                <View style={[styles.chipImageBadge, { backgroundColor: `${theme.colors.button.primary.background}22` }]}>
                                    <Ionicons
                                        name="image"
                                        size={10}
                                        color={theme.colors.button.primary.background}
                                    />
                                    {imageCount > 1 && (
                                        <Text style={[styles.chipImageBadgeText, { color: theme.colors.button.primary.background }]}>
                                            {imageCount}
                                        </Text>
                                    )}
                                </View>
                            )}
                            <Text
                                style={[
                                    styles.chipText,
                                    {
                                        color: msg.hasOnlyImages
                                            ? theme.colors.button.primary.background
                                            : theme.colors.textSecondary,
                                        fontStyle: msg.hasOnlyImages ? "italic" : "normal",
                                    },
                                ]}
                                numberOfLines={1}
                            >
                                {msg.displayText}
                            </Text>
                            <View style={styles.chipActions}>
                                {onEditItem && (
                                    <Pressable
                                        onPress={(e) => {
                                            // Stop bubbling so the outer chip's onPress
                                            // (which opens preview) doesn't ALSO fire on
                                            // web. On native the responder system already
                                            // suppresses bubbling, so this is a no-op.
                                            e.stopPropagation?.();
                                            onEditItem(msg);
                                        }}
                                        hitSlop={8}
                                        style={({ pressed }) => ({ opacity: pressed ? 0.4 : 0.7 })}
                                    >
                                        <Ionicons name="pencil" size={13} color={theme.colors.textSecondary} />
                                    </Pressable>
                                )}
                                {isRunning && onSendItemNow && (
                                    <Pressable
                                        onPress={(e) => {
                                            e.stopPropagation?.();
                                            onSendItemNow(msg.localId);
                                        }}
                                        hitSlop={8}
                                        style={({ pressed }) => ({ opacity: pressed ? 0.4 : 0.8 })}
                                    >
                                        <Ionicons
                                            name="play-circle-outline"
                                            size={15}
                                            color={theme.colors.button.primary.background}
                                        />
                                    </Pressable>
                                )}
                                <Pressable
                                    onPress={(e) => {
                                        e.stopPropagation?.();
                                        onCancelItem(msg.localId);
                                    }}
                                    hitSlop={8}
                                    style={({ pressed }) => ({ opacity: pressed ? 0.4 : 0.6 })}
                                >
                                    <Ionicons name="close-circle" size={15} color={theme.colors.textSecondary} />
                                </Pressable>
                            </View>
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    );
});

QueueBanner.displayName = "QueueBanner";

const styles = StyleSheet.create(() => ({
    container: {
        paddingHorizontal: 12,
        paddingTop: 6,
        paddingBottom: 6,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 5,
        gap: 6,
    },
    headerLabel: {
        ...Typography.default(),
        fontSize: 11,
        flex: 1,
    },
    headerPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
    },
    headerPillText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    list: {
        flexDirection: "row",
        gap: 6,
        paddingBottom: 2,
    },
    chip: {
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 8,
        paddingRight: 10,
        paddingVertical: 5,
        borderRadius: 8,
        gap: 6,
        maxWidth: 280,
    },
    chipImageBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingHorizontal: 5,
        paddingVertical: 2,
        borderRadius: 6,
    },
    chipImageBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
    },
    chipText: {
        ...Typography.default(),
        fontSize: 12,
        flexShrink: 1,
    },
    chipActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
}));

const modalStyles = StyleSheet.create((theme) => ({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 999,
        justifyContent: "flex-end",
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.5)",
    },
    backdropPress: {
        flex: 1,
    },
    kavWrapper: {
        // KeyboardAvoidingView needs to be positioned so it can lift the sheet.
        // We use `justifyContent: flex-end` on the outer overlay; here we just
        // let the KAV occupy the same flex slot.
        justifyContent: "flex-end",
    },
    sheet: {
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingTop: 10,
        maxHeight: "90%",
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.textSecondary + "40",
        alignSelf: "center",
        marginBottom: 10,
    },
    modalHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
        gap: 8,
    },
    headerTextCol: {
        flex: 1,
        gap: 4,
    },
    modalTitle: {
        ...Typography.default("semiBold"),
        fontSize: 15,
    },
    metaRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    metaChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
    },
    metaChipText: {
        ...Typography.default(),
        fontSize: 11,
    },
    metaCount: {
        ...Typography.default(),
        fontSize: 11,
    },
    editHeaderBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    editHeaderBtnText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
    },
    closeBtn: {
        padding: 4,
    },
    scrollView: {
        maxHeight: 520,
    },
    scrollContent: {
        padding: 16,
        gap: 12,
    },
    fullText: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 22,
    },
    textBlock: {
        borderLeftWidth: 3,
        paddingLeft: 10,
        paddingVertical: 2,
    },
    imageWrapper: {
        borderRadius: 10,
        overflow: "hidden",
        alignItems: "center",
    },
    previewImage: {
        width: "100%",
        height: 260,
    },
    imageGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    gridImageWrapper: {
        // 50% width minus the 8px gap; use percentages so it stays responsive
        // to the sheet width on tablets.
        width: "48%",
        borderRadius: 10,
        overflow: "hidden",
        aspectRatio: 1,
    },
    gridImage: {
        width: "100%",
        height: "100%",
    },
    editorWrapper: {
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 8,
        minHeight: 120,
    },
    editor: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 22,
        minHeight: 100,
        textAlignVertical: "top",
    },
    thumbGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    thumbCell: {
        width: 80,
        height: 80,
        borderRadius: 8,
        overflow: "hidden",
        position: "relative",
    },
    thumb: {
        width: "100%",
        height: "100%",
    },
    thumbRemove: {
        position: "absolute",
        top: 4,
        right: 4,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: "rgba(0,0,0,0.6)",
        alignItems: "center",
        justifyContent: "center",
    },
    staleText: {
        ...Typography.default(),
        fontSize: 13,
    },
    footer: {
        borderTopWidth: 1,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
    },
    footerRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    footerBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 11,
        borderRadius: 10,
        flex: 1,
    },
    footerBtnGhost: {
        borderWidth: 1,
    },
    footerBtnGhostText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
    footerBtnPrimary: {
        // primary action; rendered last so it gets the wider flex weight visually
    },
    footerBtnPrimaryText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
    sendNowBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        paddingVertical: 12,
        borderRadius: 12,
    },
    sendNowBtnText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
    },
}));
