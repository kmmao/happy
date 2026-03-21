import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";

export const wizardStylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: "600",
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    stepIndicator: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    stepDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginHorizontal: 4,
    },
    stepDotActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    stepDotInactive: {
        backgroundColor: theme.colors.divider,
    },
    stepContent: {
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: 24,
        paddingBottom: 0, // No bottom padding since footer is separate
    },
    stepTitle: {
        fontSize: 20,
        fontWeight: "600",
        color: theme.colors.text,
        marginBottom: 8,
        ...Typography.default("semiBold"),
    },
    stepDescription: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        marginBottom: 24,
        ...Typography.default(),
    },
    footer: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface, // Ensure footer has solid background
    },
    button: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 8,
        minWidth: 100,
        alignItems: "center",
        justifyContent: "center",
    },
    buttonPrimary: {
        backgroundColor: theme.colors.button.primary.background,
    },
    buttonSecondary: {
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    buttonText: {
        fontSize: 16,
        fontWeight: "600",
        ...Typography.default("semiBold"),
    },
    buttonTextPrimary: {
        color: "#FFFFFF",
    },
    buttonTextSecondary: {
        color: theme.colors.text,
    },
    textInput: {
        backgroundColor: theme.colors.input.background,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 16,
        color: theme.colors.text,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        ...Typography.default(),
    },
    agentOption: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderRadius: 12,
        borderWidth: 2,
        marginBottom: 12,
    },
    agentOptionSelected: {
        borderColor: theme.colors.button.primary.background,
        backgroundColor: theme.colors.input.background,
    },
    agentOptionUnselected: {
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
    },
    agentIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: theme.colors.button.primary.background,
        alignItems: "center",
        justifyContent: "center",
        marginRight: 16,
    },
    agentInfo: {
        flex: 1,
    },
    agentName: {
        fontSize: 16,
        fontWeight: "600",
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    agentDescription: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        marginTop: 4,
        ...Typography.default(),
    },
}));
