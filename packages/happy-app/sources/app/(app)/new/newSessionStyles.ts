import { Platform } from "react-native";
import { Typography } from "@/constants/Typography";
import { StyleSheet } from "react-native-unistyles";

// Configuration constants
export const RECENT_PATHS_DEFAULT_VISIBLE = 5;
export const STATUS_ITEM_GAP = 11; // Spacing between status items (machine, CLI) - ~2 character spaces at 11px font

export const styles = StyleSheet.create((theme, rt) => ({
    container: {
        flex: 1,
        justifyContent: Platform.OS === "web" ? "center" : "flex-end",
        paddingTop: Platform.OS === "web" ? 0 : 40,
    },
    scrollContainer: {
        flex: 1,
    },
    contentContainer: {
        width: "100%",
        alignSelf: "center",
        paddingTop: rt.insets.top,
        paddingBottom: 16,
    },
    wizardContainer: {
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        marginHorizontal: 16,
        padding: 16,
        marginBottom: 16,
    },
    sectionHeader: {
        fontSize: 14,
        fontWeight: "600",
        color: theme.colors.text,
        marginBottom: 8,
        marginTop: 12,
        ...Typography.default("semiBold"),
    },
    sectionDescription: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginBottom: 12,
        lineHeight: 18,
        ...Typography.default(),
    },
    profileListItem: {
        backgroundColor: theme.colors.input.background,
        borderRadius: 12,
        padding: 8,
        marginBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 2,
        borderColor: "transparent",
    },
    profileListItemSelected: {
        borderWidth: 2,
        borderColor: theme.colors.text,
    },
    profileIcon: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: theme.colors.button.primary.background,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 10,
    },
    profileListName: {
        fontSize: 13,
        fontWeight: "600",
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    profileListDetails: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    addProfileButton: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    addProfileButtonText: {
        fontSize: 13,
        fontWeight: "600",
        color: theme.colors.button.secondary.tint,
        marginLeft: 8,
        ...Typography.default("semiBold"),
    },
    selectorButton: {
        backgroundColor: theme.colors.input.background,
        borderRadius: 8,
        padding: 10,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    selectorButtonText: {
        color: theme.colors.text,
        fontSize: 13,
        flex: 1,
        ...Typography.default(),
    },
    advancedHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 12,
    },
    advancedHeaderText: {
        fontSize: 13,
        fontWeight: "500",
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    permissionGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        marginBottom: 16,
    },
    permissionButton: {
        width: "48%",
        backgroundColor: theme.colors.input.background,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        alignItems: "center",
        borderWidth: 2,
        borderColor: "transparent",
    },
    permissionButtonSelected: {
        borderColor: theme.colors.button.primary.background,
        backgroundColor: theme.colors.button.primary.background + "10",
    },
    permissionButtonText: {
        fontSize: 14,
        fontWeight: "600",
        color: theme.colors.text,
        marginTop: 8,
        textAlign: "center",
        ...Typography.default("semiBold"),
    },
    permissionButtonTextSelected: {
        color: theme.colors.button.primary.background,
    },
    permissionButtonDesc: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 4,
        textAlign: "center",
        ...Typography.default(),
    },
}));
