import * as React from "react";
import { View, Animated } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import type { WorldDefinition } from "./worldTypes";

interface WorldDefinitionPanelProps {
    definition: WorldDefinition;
    visible: boolean;
}

export const WorldDefinitionPanel = React.memo(function WorldDefinitionPanel({
    definition,
    visible,
}: WorldDefinitionPanelProps) {
    const { styles } = useStyles();
    const anim = React.useRef(new Animated.Value(visible ? 1 : 0)).current;

    React.useEffect(() => {
        Animated.timing(anim, {
            toValue: visible ? 1 : 0,
            duration: 200,
            useNativeDriver: false,
        }).start();
    }, [visible, anim]);

    return (
        <Animated.View
            style={[
                styles.panel,
                {
                    maxHeight: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 300],
                    }),
                    opacity: anim,
                    overflow: "hidden",
                },
            ]}
        >
            <View style={styles.inner}>
                <Row label={t("world.narrative")} value={definition.narrative ?? t("world.notSet")} />
                <Row label={t("world.laws")} value={definition.laws ?? t("world.notSet")} />
                <Row label={t("world.policy")} value={definition.policy ?? "suggest"} />
            </View>
        </Animated.View>
    );
});

interface RowProps {
    label: string;
    value: string;
}

function Row({ label, value }: RowProps) {
    const { styles } = useStyles();
    return (
        <View style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
        </View>
    );
}

const useStyles = () => {
    const { theme } = useUnistyles();
    const styles = StyleSheet.create({
        panel: {
            backgroundColor: theme.colors.surfaceHighest,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.divider,
        },
        inner: {
            paddingHorizontal: 16,
            paddingVertical: 12,
            gap: 10,
        },
        row: {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 8,
        },
        rowLabel: {
            fontSize: 12,
            color: theme.colors.textSecondary,
            width: 72,
            paddingTop: 1,
        },
        rowValue: {
            flex: 1,
            fontSize: 13,
            color: theme.colors.text,
            lineHeight: 18,
        },
    });
    return { styles };
};
