import React from "react";
import { Text } from "react-native";
import { Typography } from "@/constants/Typography";

export const FieldLabel = React.memo<{
    theme: any;
    children: string;
}>(function FieldLabel({ theme, children }) {
    return (
        <Text
            style={{
                fontSize: 13,
                color: theme.colors.textSecondary,
                marginBottom: 6,
                ...Typography.default(),
            }}
        >
            {children}
        </Text>
    );
});
