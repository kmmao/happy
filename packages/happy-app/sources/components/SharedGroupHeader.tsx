import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import {
    resolveSharedGroupHeaderVariantMeta,
    type SharedGroupHeaderVariant,
} from "./sharedGroupHeaderPresentation";
export type SharedGroupHeaderActionTone =
    | "accent"
    | "danger"
    | "purple"
    | "neutral";

interface SharedGroupHeaderProps {
    title: string;
    subtitle?: string;
    leading?: React.ReactNode;
    trailing?: React.ReactNode;
    variant?: SharedGroupHeaderVariant;
}

interface SharedGroupHeaderActionProps {
    icon: keyof typeof Ionicons.glyphMap;
    label?: string;
    onPress: () => void;
    tone?: SharedGroupHeaderActionTone;
    disabled?: boolean;
}

export const SharedGroupHeader = React.memo(
    ({
        title,
        subtitle,
        leading,
        trailing,
        variant = "section",
    }: SharedGroupHeaderProps) => {
        const meta = resolveSharedGroupHeaderVariantMeta(variant);

        return (
            <View style={styles.container}>
                <View style={styles.leadingSide}>
                    {leading ? (
                        <View style={styles.leadingSlot}>{leading}</View>
                    ) : null}
                    <View style={styles.textBlock}>
                        <Text
                            style={[
                                meta.titleStyle === "section"
                                    ? styles.titleSection
                                    : styles.titleContext,
                            ]}
                            numberOfLines={1}
                        >
                            {title}
                        </Text>
                        {meta.supportsSubtitle && subtitle ? (
                            <Text
                                style={styles.subtitle}
                                numberOfLines={1}
                            >
                                {subtitle}
                            </Text>
                        ) : null}
                    </View>
                </View>
                {trailing ? (
                    <View style={styles.trailingSide}>{trailing}</View>
                ) : null}
            </View>
        );
    },
);

export const SharedGroupHeaderAction = React.memo(
    ({
        icon,
        label,
        onPress,
        tone = "accent",
        disabled = false,
    }: SharedGroupHeaderActionProps) => {
        return (
            <Pressable
                onPress={onPress}
                disabled={disabled}
                hitSlop={8}
                style={({ pressed }) => [
                    styles.actionButton,
                    tone === "accent" && styles.actionButtonAccent,
                    tone === "danger" && styles.actionButtonDanger,
                    tone === "purple" && styles.actionButtonPurple,
                    tone === "neutral" && styles.actionButtonNeutral,
                    pressed && !disabled && styles.actionButtonPressed,
                    disabled && styles.actionButtonDisabled,
                ]}
            >
                <Ionicons
                    name={icon}
                    size={14}
                    color={
                        tone === "danger"
                            ? styles.actionTextDanger.color
                            : tone === "purple"
                              ? styles.actionTextPurple.color
                              : tone === "neutral"
                                ? styles.actionTextNeutral.color
                                : styles.actionTextAccent.color
                    }
                />
                {label ? (
                    <Text
                        style={[
                            styles.actionText,
                            tone === "danger" && styles.actionTextDanger,
                            tone === "purple" && styles.actionTextPurple,
                            tone === "neutral" && styles.actionTextNeutral,
                            tone === "accent" && styles.actionTextAccent,
                        ]}
                        numberOfLines={1}
                    >
                        {label}
                    </Text>
                ) : null}
            </Pressable>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        minWidth: 0,
    },
    leadingSide: {
        flexDirection: "row",
        alignItems: "center",
        flex: 1,
        minWidth: 0,
        gap: 8,
    },
    leadingSlot: {
        alignItems: "center",
        justifyContent: "center",
    },
    textBlock: {
        flex: 1,
        minWidth: 0,
    },
    trailingSide: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        flexWrap: "wrap",
        gap: 8,
        flexShrink: 1,
    },
    titleSection: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.groupped.sectionTitle,
        letterSpacing: 0.2,
    },
    titleContext: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        lineHeight: 18,
        color: theme.colors.groupped.sectionTitle,
        letterSpacing: 0.1,
    },
    subtitle: {
        ...Typography.default(),
        marginTop: 2,
        fontSize: 11,
        lineHeight: 14,
        color: theme.colors.textSecondary,
    },
    actionButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
    },
    actionButtonAccent: {
        backgroundColor: `${theme.colors.header.tint}12`,
        borderColor: `${theme.colors.header.tint}24`,
    },
    actionButtonDanger: {
        backgroundColor: `${theme.colors.deleteAction}12`,
        borderColor: `${theme.colors.deleteAction}24`,
    },
    actionButtonPurple: {
        backgroundColor: `${theme.colors.accentPurple}12`,
        borderColor: `${theme.colors.accentPurple}24`,
    },
    actionButtonNeutral: {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.divider,
    },
    actionButtonPressed: {
        opacity: 0.72,
    },
    actionButtonDisabled: {
        opacity: 0.45,
    },
    actionText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        lineHeight: 14,
    },
    actionTextAccent: {
        color: theme.colors.header.tint,
    },
    actionTextDanger: {
        color: theme.colors.deleteAction,
    },
    actionTextPurple: {
        color: theme.colors.accentPurple,
    },
    actionTextNeutral: {
        color: theme.colors.textSecondary,
    },
}));
