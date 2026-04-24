import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { resolveActiveTint } from "@/constants/activeTint";

export const projectFormSheetStyles = StyleSheet.create((theme) => ({
    modalOverlay: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: "flex-start" as const,
        alignItems: "center" as const,
        zIndex: 100,
    },
    modalBackdrop: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.4)",
    },
    modalScroll: {
        width: "90%" as const,
        maxWidth: 440,
        maxHeight: "100%" as const,
    },
    modalScrollContent: {
        flexGrow: 1,
        justifyContent: "flex-start" as const,
        paddingTop: 16,
        paddingBottom: 16,
    },
    modalContent: {
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 20,
    },
    modalHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
    },
    modalTitle: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
    },
    closeButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: theme.colors.groupped.background,
    },
    fieldLabel: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 6,
        marginTop: 12,
    },
    textInput: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 8,
        padding: 12,
    },
    chipRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
    },
    chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: theme.colors.groupped.background,
    },
    chipText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    sectionDivider: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        marginTop: 16,
        marginBottom: 4,
    },
    sectionDividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    sectionDividerLabel: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.textSecondary,
        letterSpacing: 0.5,
        textTransform: "uppercase" as const,
    },
    modalActions: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        marginTop: 20,
        gap: 10,
    },
    deleteButton: {
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    deleteButtonText: {
        ...Typography.default(),
        fontSize: 14,
        color: "#DC2626",
    },
    cancelButton: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: theme.colors.groupped.background,
    },
    cancelButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
    },
    confirmButton: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: resolveActiveTint(theme),
    },
    confirmButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: "#fff",
    },
}));
