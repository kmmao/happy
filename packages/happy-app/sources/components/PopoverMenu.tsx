/**
 * PopoverMenu — Reusable "click anchor → show menu" popover that adapts
 * its presentation by viewport: desktop anchors to the trigger position
 * (popover card below/above it); mobile docks as a bottom sheet for
 * thumb reach.
 *
 * Replaces ad-hoc Modal.alert lists where we actually want a real menu
 * with hints, icons, and disabled rows — Modal.alert flattens those to
 * plain buttons and was reported as silently not opening on PC web.
 *
 * Usage:
 *   const [anchor, setAnchor] = useState<AnchorRect | null>(null);
 *   const buttonRef = useRef<View>(null);
 *   const open = () => buttonRef.current?.measureInWindow((x, y, w, h) =>
 *     setAnchor({ x, y, width: w, height: h }));
 *   <Pressable ref={buttonRef} onPress={open}>...</Pressable>
 *   <PopoverMenu visible={!!anchor} anchor={anchor} onClose={() => setAnchor(null)} options={...} />
 */

import * as React from "react";
import {
    View,
    Pressable,
    Modal as RNModal,
    useWindowDimensions,
    Platform,
} from "react-native";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
    useWebHoverProps,
    webInteractive,
} from "@/utils/interactiveSurface";

export interface PopoverAnchorRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PopoverMenuOption {
    key: string;
    label: string;
    hint?: string;
    icon?: React.ComponentProps<typeof Ionicons>["name"];
    iconColor?: string;
    onPress: () => void;
    disabled?: boolean;
    destructive?: boolean;
}

interface PopoverMenuProps {
    visible: boolean;
    onClose: () => void;
    /** Where the trigger button sits in window coordinates. Desktop uses
     *  this to position the popover card. Mobile ignores it. */
    anchor: PopoverAnchorRect | null;
    title?: string;
    options: PopoverMenuOption[];
}

const MOBILE_BREAKPOINT = 540;
const POPOVER_MIN_WIDTH = 240;
const POPOVER_MAX_WIDTH = 320;
const POPOVER_GAP = 6;
const VIEWPORT_EDGE_PADDING = 8;

const styles = StyleSheet.create((theme) => ({
    backdrop: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    mobileBackdropDim: {
        backgroundColor: "rgba(0,0,0,0.35)",
    },
    desktopPopover: {
        position: "absolute",
        minWidth: POPOVER_MIN_WIDTH,
        maxWidth: POPOVER_MAX_WIDTH,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        paddingVertical: 6,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 16,
        elevation: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    mobileSheet: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingVertical: 6,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.18,
        shadowRadius: 16,
        elevation: 12,
    },
    grabHandleWrap: {
        alignItems: "center",
        paddingTop: 6,
        paddingBottom: 4,
    },
    grabHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.divider,
    },
    title: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.1,
        ...Typography.default("semiBold"),
        paddingHorizontal: 14,
        paddingTop: 8,
        paddingBottom: 4,
    },
    optionRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        ...webInteractive,
    },
    optionRowHovered: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    optionRowPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    optionRowDisabled: {
        opacity: 0.45,
    },
    optionIcon: {
        width: 22,
        alignItems: "center",
    },
    optionTextColumn: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    optionLabel: {
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    optionLabelDestructive: {
        color: theme.colors.status.error,
    },
    optionHint: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));

export const PopoverMenu = React.memo(function PopoverMenu({
    visible,
    onClose,
    anchor,
    title,
    options,
}: PopoverMenuProps) {
    const insets = useSafeAreaInsets();
    const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
    const isMobile = viewportWidth < MOBILE_BREAKPOINT;

    if (!visible) return null;

    // Desktop popover positioning: prefer aligning the right edge of the
    // popover to the right edge of the anchor (the anchor is usually a
    // header-right button, so this matches the user's mental "menu drops
    // from the button I just clicked"). Flip above the anchor if there's
    // not enough room below. Cap to viewport edges.
    let popoverStyle: any = null;
    if (!isMobile && anchor) {
        // Estimate popover height by options count (each row ~46px + title).
        const estHeight = (title ? 30 : 8) + options.length * 50 + 8;
        const fitsBelow = anchor.y + anchor.height + POPOVER_GAP + estHeight < viewportHeight - VIEWPORT_EDGE_PADDING;
        const top = fitsBelow
            ? anchor.y + anchor.height + POPOVER_GAP
            : Math.max(VIEWPORT_EDGE_PADDING, anchor.y - estHeight - POPOVER_GAP);
        // Right-align: x_right_of_anchor = anchor.x + anchor.width.
        // Convert to left so width auto-adjusts within min/max.
        const rightAlignedX = anchor.x + anchor.width - POPOVER_MIN_WIDTH;
        const left = Math.max(VIEWPORT_EDGE_PADDING, Math.min(rightAlignedX, viewportWidth - POPOVER_MIN_WIDTH - VIEWPORT_EDGE_PADDING));
        popoverStyle = { top, left };
    }

    return (
        <RNModal
            visible={visible}
            transparent
            animationType={isMobile ? "slide" : "fade"}
            onRequestClose={onClose}
            statusBarTranslucent
        >
            {/* Tap anywhere outside the menu to dismiss. */}
            <Pressable
                style={[styles.backdrop, isMobile && styles.mobileBackdropDim]}
                onPress={onClose}
            />

            <View
                style={[
                    isMobile ? styles.mobileSheet : styles.desktopPopover,
                    !isMobile && popoverStyle,
                    isMobile && { paddingBottom: Math.max(8, insets.bottom) },
                ]}
            >
                {isMobile ? (
                    <View style={styles.grabHandleWrap}>
                        <View style={styles.grabHandle} />
                    </View>
                ) : null}
                {title ? <Text style={styles.title}>{title}</Text> : null}
                {options.map((option) => (
                    <OptionRow
                        key={option.key}
                        option={option}
                        onPress={() => {
                            if (option.disabled) return;
                            onClose();
                            option.onPress();
                        }}
                    />
                ))}
            </View>
        </RNModal>
    );
});

const OptionRow = React.memo(function OptionRow({
    option,
    onPress,
}: {
    option: PopoverMenuOption;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    const { isHovered, hoverProps } = useWebHoverProps();

    return (
        <Pressable
            {...hoverProps}
            onPress={onPress}
            disabled={option.disabled}
            style={({ pressed }) => [
                styles.optionRow,
                option.disabled && styles.optionRowDisabled,
                !option.disabled && isHovered && styles.optionRowHovered,
                !option.disabled && pressed && styles.optionRowPressed,
            ]}
        >
            {option.icon ? (
                <View style={styles.optionIcon}>
                    <Ionicons
                        name={option.icon}
                        size={18}
                        color={
                            option.destructive
                                ? theme.colors.status.error
                                : option.iconColor ?? theme.colors.textLink
                        }
                    />
                </View>
            ) : null}
            <View style={styles.optionTextColumn}>
                <Text
                    style={[
                        styles.optionLabel,
                        option.destructive && styles.optionLabelDestructive,
                    ]}
                    numberOfLines={1}
                >
                    {option.label}
                </Text>
                {option.hint ? (
                    <Text style={styles.optionHint} numberOfLines={2}>
                        {option.hint}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );
});

/**
 * Helper hook: returns a ref to attach to the trigger button and an
 * anchor state to pass into PopoverMenu. Measures the trigger's window
 * position on demand so the popover lines up regardless of which
 * scroll containers it's nested in.
 */
export function usePopoverAnchor() {
    const [anchor, setAnchor] = React.useState<PopoverAnchorRect | null>(null);
    const ref = React.useRef<View>(null);

    const open = React.useCallback(() => {
        if (!ref.current) return;
        // measureInWindow is async on iOS; the value flows in via callback.
        ref.current.measureInWindow((x, y, width, height) => {
            setAnchor({ x, y, width, height });
        });
    }, []);

    const close = React.useCallback(() => setAnchor(null), []);

    return { anchor, ref, open, close, isOpen: anchor !== null };
}
