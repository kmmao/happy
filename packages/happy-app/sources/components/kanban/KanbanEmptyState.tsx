import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Image } from "expo-image";
import { t } from "@/text";

export const KanbanEmptyState = React.memo(() => {
  return (
    <View style={styles.container}>
      <Image
        source={require("@/assets/images/brutalist/Brutalism 22.png")}
        contentFit="contain"
        style={styles.icon}
        tintColor="#888"
      />
      <Text style={styles.title}>{t("kanban.emptyTitle")}</Text>
      <Text style={styles.subtitle}>{t("kanban.emptySubtitle")}</Text>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingBottom: 64,
  },
  icon: {
    width: 48,
    height: 48,
    marginBottom: 16,
    opacity: 0.5,
  },
  title: {
    fontSize: 17,
    color: theme.colors.text,
    marginBottom: 8,
    textAlign: "center",
    ...Typography.default("semiBold"),
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    ...Typography.default(),
  },
}));
