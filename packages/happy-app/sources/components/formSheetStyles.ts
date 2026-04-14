/**
 * Shared styles for form sheets (GoalCreateSheet, IssueCreateSheet, IssueEditSheet, etc.).
 *
 * Provides iOS grouped-table-view style form layout:
 * - Section groups with rounded corners
 * - Input fields with floating labels and focus accent bars
 * - Inset dividers between fields
 * - Full-width primary button + text cancel link
 */

import { Platform } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";

export const formSheetStyles = StyleSheet.create((theme) => ({
    /* ── Header ── */
    header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
    },
    headerTitle: {
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

    /* ── Section Groups (iOS grouped table style) ── */
    sectionGroup: {
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 12,
        overflow: "hidden" as const,
    },

    /* ── Input Fields ── */
    fieldContainer: {
        flexDirection: "row" as const,
    },
    accentBar: {
        width: 3,
        backgroundColor: "transparent",
        borderTopLeftRadius: 3,
        borderBottomLeftRadius: 3,
    },
    fieldInner: {
        flex: 1,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    floatingLabel: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.textSecondary,
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
        marginBottom: 4,
    },
    textInput: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
        padding: 0,
        margin: 0,
    },

    /* ── Divider ── */
    insetDivider: {
        height: Platform.select({ ios: 0.33, default: 1 }),
        backgroundColor: theme.colors.divider,
        marginLeft: 17,
    },

    /* ── Option Rows (for switches, selectors, etc.) ── */
    optionRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: 14,
        paddingVertical: 12,
        minHeight: 48,
    },
    optionLabel: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },

    /* ── Section inner padding (for non-Item content like LabelPicker) ── */
    sectionPadded: {
        padding: 14,
    },

    /* ── Actions ── */
    primaryButton: {
        width: "100%" as const,
        paddingVertical: 13,
        borderRadius: 12,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: theme.dark
            ? theme.colors.accentPurple
            : theme.colors.header.tint,
    },
    primaryButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: "#fff",
    },
    cancelLink: {
        paddingVertical: 6,
    },
    cancelLinkText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },

    /* ── Sheet container (for Modal.show-style sheets) ── */
    sheetContainer: {
        flex: 1,
        backgroundColor: theme.colors.surface,
        borderRadius: 14,
        overflow: "hidden" as const,
    },
    sheetScroll: {
        flex: 1,
    },
    sheetScrollContent: {
        padding: 20,
        gap: 20,
    },
    sheetActionsBar: {
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 8,
        borderTopWidth: Platform.select({ ios: 0.33, default: 1 }),
        borderTopColor: theme.colors.divider,
        gap: 10,
        alignItems: "center" as const,
    },
}));
