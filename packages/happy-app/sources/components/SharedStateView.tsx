import * as React from "react";
import { ActivityIndicator, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { RoundButton, type RoundButtonDisplay, type RoundButtonSize } from "@/components/RoundButton";
import { t } from "@/text";
import { SharedEmptyState } from "./SharedEmptyState";
import type { SharedEmptyStateVariant } from "./sharedEmptyStatePresentation";
import {
    resolveSharedStateKindMeta,
    type SharedStateKind,
} from "./sharedStatePresentation";

interface SharedStateViewProps {
    kind: SharedStateKind;
    title: string;
    description?: string;
    icon?: React.ReactNode;
    children?: React.ReactNode;
    variant?: SharedEmptyStateVariant;
    inline?: boolean;
    actionLabel?: string;
    onAction?: () => void;
    actionDisplay?: RoundButtonDisplay;
    actionSize?: RoundButtonSize;
}

export const SharedStateView = React.memo(
    ({
        kind,
        title,
        description,
        icon,
        children,
        variant = "standard",
        inline = false,
        actionLabel,
        onAction,
        actionDisplay = "default",
        actionSize,
    }: SharedStateViewProps) => {
        const { theme } = useUnistyles();
        const meta = resolveSharedStateKindMeta(kind);
        const resolvedActionLabel =
            actionLabel ?? (onAction && kind === "error" ? t("common.retry") : undefined);

        const backgroundColor =
            meta.accent === "error"
                ? theme.colors.box.error.background
                : theme.colors.surfaceHighest;
        const borderColor =
            meta.accent === "error"
                ? theme.colors.box.error.border + "33"
                : theme.colors.divider;
        const foregroundColor =
            meta.accent === "error"
                ? theme.colors.box.error.text
                : theme.colors.textSecondary;

        const resolvedIcon = icon ?? (
            <View
                style={[
                    styles.iconContainer,
                    { backgroundColor, borderColor },
                ]}
            >
                {kind === "loading" ? (
                    <ActivityIndicator
                        size="small"
                        color={theme.colors.textLink}
                    />
                ) : (
                    <Ionicons
                        name={meta.iconName ?? "sparkles-outline"}
                        size={28}
                        color={foregroundColor}
                    />
                )}
            </View>
        );

        return (
            <SharedEmptyState
                title={title}
                description={description}
                icon={resolvedIcon}
                variant={variant}
                inline={inline}
            >
                {resolvedActionLabel || children ? (
                    <View style={styles.contentSlot}>
                        {resolvedActionLabel && onAction ? (
                            <RoundButton
                                title={resolvedActionLabel}
                                onPress={onAction}
                                size={actionSize ?? (inline ? "normal" : "large")}
                                display={actionDisplay}
                                style={styles.actionButton}
                            />
                        ) : null}
                        {children ? (
                            <View
                                style={[
                                    styles.childrenSlot,
                                    resolvedActionLabel && styles.childrenSlotWithAction,
                                ]}
                            >
                                {children}
                            </View>
                        ) : null}
                    </View>
                ) : null}
            </SharedEmptyState>
        );
    },
);

const styles = StyleSheet.create({
    iconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    contentSlot: {
        width: "100%",
        alignItems: "center",
    },
    actionButton: {
        width: "100%",
        maxWidth: 240,
    },
    childrenSlot: {
        width: "100%",
        alignItems: "center",
    },
    childrenSlotWithAction: {
        marginTop: 12,
    },
});
