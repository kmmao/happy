import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import {
    resolveSharedEmptyStateVariantMeta,
    type SharedEmptyStateVariant,
} from "./sharedEmptyStatePresentation";

interface SharedEmptyStateProps {
    title: string;
    description?: string;
    icon?: React.ReactNode;
    children?: React.ReactNode;
    variant?: SharedEmptyStateVariant;
    inline?: boolean;
}

export const SharedEmptyState = React.memo(
    ({
        title,
        description,
        icon,
        children,
        variant = "standard",
        inline = false,
    }: SharedEmptyStateProps) => {
        const meta = resolveSharedEmptyStateVariantMeta(variant);

        return (
            <View style={[styles.container, inline && styles.containerInline]}>
                <View style={[styles.content, { maxWidth: meta.maxWidth }]}>
                    {icon ? <View style={styles.iconSlot}>{icon}</View> : null}
                    <Text
                        style={[
                            meta.titleStyle === "hero"
                                ? styles.titleHero
                                : styles.titleStandard,
                        ]}
                    >
                        {title}
                    </Text>
                    {description ? (
                        <Text style={styles.description}>{description}</Text>
                    ) : null}
                    {children ? (
                        <View style={styles.childrenSlot}>{children}</View>
                    ) : null}
                </View>
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 24,
        paddingVertical: 32,
    },
    containerInline: {
        flex: 0,
        paddingVertical: 48,
    },
    content: {
        width: "100%",
        alignItems: "center",
    },
    iconSlot: {
        marginBottom: 18,
    },
    titleHero: {
        ...Typography.default("semiBold"),
        fontSize: 24,
        lineHeight: 30,
        color: theme.colors.text,
        textAlign: "center",
    },
    titleStandard: {
        ...Typography.default("semiBold"),
        fontSize: 20,
        lineHeight: 26,
        color: theme.colors.text,
        textAlign: "center",
    },
    description: {
        ...Typography.default(),
        marginTop: 8,
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
        textAlign: "center",
    },
    childrenSlot: {
        marginTop: 20,
        width: "100%",
        alignItems: "center",
    },
}));
