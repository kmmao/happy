/**
 * Full-screen image viewer page.
 *
 * Loads an image from the CLI machine via sessionReadFile RPC and displays it
 * full-screen with pinch-to-zoom support via expo-image.
 *
 * Route: /session/{id}/image?path={encodedPath}
 */

import * as React from "react";
import { View, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { sessionReadFile } from "@/sync/ops";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; uri: string }
  | { status: "error" };

export default React.memo(function ImageViewerPage() {
  const { id: sessionId, path: encodedPath } = useLocalSearchParams<{
    id: string;
    path: string;
  }>();
  const imagePath = encodedPath ? decodeURIComponent(encodedPath) : "";
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const { theme } = useUnistyles();

  React.useEffect(() => {
    if (!sessionId || !imagePath) {
      setState({ status: "error" });
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const response = await sessionReadFile(sessionId!, imagePath);
        if (cancelled) return;

        if (response.success && response.content) {
          setState({
            status: "loaded",
            uri: `data:image/jpeg;base64,${response.content}`,
          });
        } else {
          setState({ status: "error" });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, imagePath]);

  if (state.status === "loading") {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.text} />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.container}>
        <Ionicons
          name="image-outline"
          size={48}
          color={theme.colors.textSecondary}
        />
        <Text style={styles.errorText}>{t("session.imageLoadFailed")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Image
        source={{ uri: state.uri }}
        style={{ width: "100%", height: "100%" }}
        contentFit="contain"
        recyclingKey={imagePath}
        transition={200}
      />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    marginTop: 12,
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
}));
