import { Platform } from "react-native";
import { Typography } from "@/constants/Typography";
import { StyleSheet } from "react-native-unistyles";
import {
    getFavoriteSlashChipGlassStyle,
    getFloatingGlassChipStyle,
} from "./agentInputGlassStyles";

export const FAVORITE_CHIP_GRADIENTS: [string, string][] = [
    ["#6366f1", "#8b5cf6"], // indigo -> violet
    ["#3b82f6", "#06b6d4"], // blue -> cyan
    ["#f59e0b", "#f97316"], // amber -> orange
    ["#10b981", "#14b8a6"], // emerald -> teal
    ["#ec4899", "#f43f5e"], // pink -> rose
    ["#8b5cf6", "#a855f7"], // violet -> purple
];

export {
    getFavoriteSlashChipGlassStyle,
    getFloatingGlassChipStyle,
};

export const stylesheet = StyleSheet.create((theme) => ({
    container: {
        alignItems: "center",
        paddingBottom: 8,
        paddingTop: 8,
    },
    innerContainer: {
        width: "100%",
        position: "relative",
    },
    unifiedPanel: {
        backgroundColor: theme.colors.input.background,
        borderRadius: Platform.select({ default: 16, android: 20 }),
        overflow: "hidden",
        paddingVertical: 2,
        paddingBottom: 8,
        paddingHorizontal: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    inputContainer: {
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 0,
        paddingLeft: 8,
        paddingRight: 8,
        paddingVertical: 4,
        minHeight: 40,
    },

    autocompleteOverlay: {
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        marginBottom: 8,
        zIndex: 1000,
    },
    settingsOverlay: {
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        marginBottom: 8,
        zIndex: 1000,
    },
    commandsOverlay: {
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        marginBottom: 8,
        zIndex: 1000,
    },
    fileBrowserOverlay: {
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        marginBottom: 8,
        zIndex: 1000,
    },
    fileBrowserContainer: {
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: theme.colors.surface,
        borderWidth: Platform.OS === "web" ? 0 : 0.5,
        borderColor: theme.colors.modal.border,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 3.84,
        shadowOpacity: theme.colors.shadow.opacity,
        elevation: 5,
    },
    overlayBackdrop: {
        position: "absolute",
        top: -1000,
        left: -1000,
        right: -1000,
        bottom: -1000,
        zIndex: 999,
    },
    overlaySection: {
        paddingVertical: 8,
    },
    overlaySectionTitle: {
        fontSize: 12,
        fontWeight: "600",
        color: theme.colors.textSecondary,
        paddingHorizontal: 16,
        paddingBottom: 4,
        ...Typography.default("semiBold"),
    },
    overlayDivider: {
        height: 1,
        backgroundColor: theme.colors.divider,
        marginHorizontal: 16,
    },

    selectionItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: "transparent",
    },
    selectionItemPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    radioButton: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
        marginRight: 12,
    },
    radioButtonActive: {
        borderColor: theme.colors.radio.active,
    },
    radioButtonInactive: {
        borderColor: theme.colors.radio.inactive,
    },
    radioButtonDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.radio.dot,
    },
    selectionLabel: {
        fontSize: 14,
        ...Typography.default(),
    },
    selectionLabelActive: {
        color: theme.colors.radio.active,
    },
    selectionLabelInactive: {
        color: theme.colors.text,
    },

    statusContainer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingBottom: 4,
    },
    statusRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    statusText: {
        fontSize: 11,
        ...Typography.default(),
    },
    permissionModeContainer: {
        flexDirection: "column",
        alignItems: "flex-end",
    },
    permissionModeText: {
        fontSize: 11,
        ...Typography.default(),
    },
    contextWarningText: {
        fontSize: 11,
        marginLeft: 8,
        ...Typography.default(),
    },

    actionButtonsContainer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 0,
    },
    actionButtonsLeft: {
        flex: 1,
    },
    actionButtonsLeftContent: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    actionButton: {
        flexDirection: "row",
        alignItems: "center",
        borderRadius: Platform.select({ default: 16, android: 20 }),
        paddingHorizontal: 8,
        paddingVertical: 6,
        justifyContent: "center",
        height: 32,
    },
    actionButtonPressed: {
        opacity: 0.7,
    },
    actionButtonIcon: {
        color: theme.colors.button.secondary.tint,
    },
    sendButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
        marginLeft: 8,
    },
    sendButtonActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    sendButtonInactive: {
        backgroundColor: theme.colors.button.primary.disabled,
    },
    sendButtonInner: {
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
    },
    sendButtonInnerPressed: {
        opacity: 0.7,
    },
    sendButtonIcon: {
        color: theme.colors.button.primary.tint,
    },
}));
