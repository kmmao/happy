import * as React from "react";
import { View, Text, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Session } from "@/sync/storageTypes";
import {
    getSessionProviderDisplayLabel,
    getSessionProviderKey,
    getSessionProviderLabel,
} from "@/utils/sessionUtils";
import {
    resolveSessionProviderTone,
    type SessionProviderTone,
} from "@/utils/sessionProviderTone";

function getToneColors(
    tone: SessionProviderTone,
    theme: ReturnType<typeof useUnistyles>["theme"],
): { backgroundColor: string; textColor: string } {
    switch (tone) {
        case "purple":
            return {
                backgroundColor: `${theme.colors.accentPurple}1F`,
                textColor: theme.colors.accentPurple,
            };
        case "blue":
            return {
                backgroundColor: `${theme.colors.accentBlue}1F`,
                textColor: theme.colors.accentBlue,
            };
        case "orange":
            return {
                backgroundColor: `${theme.colors.accentOrange}1F`,
                textColor: theme.colors.accentOrange,
            };
        case "teal":
            return {
                backgroundColor: `${theme.colors.accentTeal}1F`,
                textColor: theme.colors.accentTeal,
            };
        case "magenta":
            return {
                backgroundColor: `${theme.colors.accentMagenta}1F`,
                textColor: theme.colors.accentMagenta,
            };
        case "green":
            return {
                backgroundColor: `${theme.colors.success}1F`,
                textColor: theme.colors.success,
            };
        default:
            return {
                backgroundColor: theme.colors.groupped.background,
                textColor: theme.colors.textSecondary,
            };
    }
}

interface SessionProviderTagProps {
    session: Session;
    includeModel?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}

export const SessionProviderTag = React.memo(
    ({
        session,
        includeModel = false,
        style,
        textStyle,
    }: SessionProviderTagProps) => {
        const { theme } = useUnistyles();
        const providerKey = getSessionProviderKey(session);
        const label = includeModel
            ? getSessionProviderDisplayLabel(session)
            : getSessionProviderLabel(session);

        if (!label.trim()) {
            return null;
        }

        const tone = resolveSessionProviderTone(providerKey);
        const colors = getToneColors(tone, theme);

        return (
            <View
                style={[
                    styles.container,
                    { backgroundColor: colors.backgroundColor },
                    style,
                ]}
            >
                <Text
                    style={[
                        styles.text,
                        tone === "neutral" ? styles.textNeutral : styles.textEmphasis,
                        { color: colors.textColor },
                        textStyle,
                    ]}
                    numberOfLines={1}
                >
                    {label}
                </Text>
            </View>
        );
    },
);

const styles = StyleSheet.create({
    container: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
        flexShrink: 1,
        minWidth: 0,
    },
    text: {
        fontSize: 10,
        minWidth: 0,
        ...Typography.default(),
    },
    textEmphasis: {
        ...Typography.default("semiBold"),
    },
    textNeutral: {
        ...Typography.default(),
    },
});
