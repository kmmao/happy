import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { Image } from "expo-image";
import { t } from "@/text";

export const IdeationEmptyState = React.memo(
  ({ onAdd }: { onAdd?: () => void }) => {
    const { theme } = useUnistyles();
    return (
      <View style={styles.container}>
        <Image
          source={require("@/assets/images/brutalist/Brutalism 22.png")}
          contentFit="contain"
          style={styles.icon}
          tintColor="#888"
        />
        <Text style={styles.title}>{t("ideation.emptyTitle")}</Text>
        <Text style={styles.subtitle}>{t("ideation.emptySubtitle")}</Text>
        {onAdd && (
          <Pressable
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: theme.colors.button.primary.background,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
            onPress={onAdd}
          >
            <Ionicons
              name="add"
              size={20}
              color={theme.colors.button.primary.tint}
            />
            <Text
              style={[
                styles.buttonText,
                {
                  color: theme.colors.button.primary.tint,
                },
              ]}
            >
              {t("ideation.newIdea")}
            </Text>
          </Pressable>
        )}
      </View>
    );
  },
);

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
    marginBottom: 24,
    ...Typography.default(),
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  buttonText: {
    fontSize: 15,
    ...Typography.default("semiBold"),
  },
}));
