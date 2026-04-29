import * as React from "react";
import {
  View,
  FlatList,
  Platform,
  KeyboardAvoidingView,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Text } from "@/components/StyledText";
import { Image } from "expo-image";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { Typography } from "@/constants/Typography";
import { Ionicons, Octicons } from "@expo/vector-icons";
import { t } from "@/text";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  OpenClawSocket,
  useOpenClawStatus,
  useOpenClawChatEvents,
  useOpenClawChatReducer,
} from "@/openclaw";
import type { DisplayBlock } from "@/openclaw";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout } from "@/components/layout";
import { MultiTextInput } from "@/components/MultiTextInput";
import { hapticsLight } from "@/components/haptics";
import { pickImagesAsBase64 } from "@/utils/imageUpload";
import { MAX_IMAGES } from "@/utils/imageUpload.shared";
import { OpenClawMessageBubble } from "@/components/openclaw/OpenClawMessageBubble";
import { OpenClawTypingIndicator } from "@/components/openclaw/OpenClawTypingIndicator";

interface PendingImage {
  id: string;
  base64: string;
}

export default React.memo(function OpenClawChatScreen() {
  const { sessionKey } = useLocalSearchParams<{ sessionKey: string }>();
  const navigation = useNavigation();
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const { isConnected } = useOpenClawStatus();
  const { events, currentRunId, clearEvents } = useOpenClawChatEvents(
    sessionKey ?? null,
  );

  const [chatState, dispatch] = useOpenClawChatReducer();
  const [inputText, setInputText] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSending, setIsSending] = React.useState(false);
  const [pendingImages, setPendingImages] = React.useState<PendingImage[]>([]);
  const [isPickingImage, setIsPickingImage] = React.useState(false);
  const flatListRef = React.useRef<FlatList>(null);
  const lastProcessedIndexRef = React.useRef(-1);

  // Set navigation title
  React.useEffect(() => {
    const label = sessionKey?.includes("/")
      ? sessionKey.split("/").pop()
      : sessionKey;
    navigation.setOptions({
      headerTitle: label ?? t("openclaw.chat"),
    });
  }, [navigation, sessionKey]);

  // Load history on mount
  React.useEffect(() => {
    if (!sessionKey || !isConnected) return;

    setIsLoading(true);
    OpenClawSocket.getHistory(sessionKey)
      .then((history) => {
        dispatch({ type: "LOAD_HISTORY", messages: history });
      })
      .catch(() => {
        // Failed to load history
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [sessionKey, isConnected, dispatch]);

  // Handle streaming events — process all unprocessed events to avoid losing deltas
  React.useEffect(() => {
    const newEvents = events.slice(lastProcessedIndexRef.current + 1);
    if (newEvents.length === 0) return;

    for (const event of newEvents) {
      dispatch({ type: "PROCESS_EVENT", event });
    }
    lastProcessedIndexRef.current = events.length - 1;

    const latestEvent = events[events.length - 1];
    if (latestEvent.state === "final" || latestEvent.state === "error") {
      setIsSending(false);
      lastProcessedIndexRef.current = -1;
      clearEvents();
    }
  }, [events, dispatch, clearEvents]);

  // Auto-scroll to bottom
  React.useEffect(() => {
    if (
      flatListRef.current &&
      (chatState.blocks.length > 0 ||
        chatState.streamingContent ||
        chatState.phase !== "idle")
    ) {
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [chatState.blocks, chatState.streamingContent, chatState.phase]);

  const hasText = inputText.trim().length > 0;
  const hasImages = pendingImages.length > 0;
  const canSend = hasText || hasImages;

  // Image picking
  const handlePickImage = React.useCallback(async () => {
    if (isPickingImage || pendingImages.length >= MAX_IMAGES) return;
    setIsPickingImage(true);
    try {
      const result = await pickImagesAsBase64(pendingImages.length);
      if (result) {
        setPendingImages((prev) => [...prev, ...result]);
      }
    } catch {
      // Picker canceled or failed
    } finally {
      setIsPickingImage(false);
    }
  }, [isPickingImage, pendingImages.length]);

  const handleRemoveImage = React.useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  // Send message
  const handleSend = React.useCallback(async () => {
    if (!sessionKey || !canSend || isSending) return;

    const userMessage = inputText.trim();
    const imagesToSend = [...pendingImages];
    setInputText("");
    setPendingImages([]);
    setIsSending(true);
    hapticsLight();

    // Add user message via reducer
    const now = Date.now();
    dispatch({
      type: "ADD_USER_MESSAGE",
      id: `user-${now}`,
      content: userMessage,
      timestamp: now,
      imageCount: imagesToSend.length > 0 ? imagesToSend.length : undefined,
    });

    try {
      const attachments =
        imagesToSend.length > 0
          ? imagesToSend.map((img) => ({
              type: "image",
              data: img.base64,
              mediaType: "image/jpeg",
            }))
          : undefined;

      await OpenClawSocket.sendMessage(
        sessionKey,
        userMessage,
        attachments ? { attachments } : undefined,
      );
    } catch {
      setIsSending(false);
    }
  }, [sessionKey, inputText, pendingImages, canSend, isSending, dispatch]);

  const layout = useLayout();
  const handleAbort = React.useCallback(async () => {
    if (!sessionKey || !currentRunId) return;

    try {
      await OpenClawSocket.abortRun(sessionKey, currentRunId);
    } catch {
      // Failed to abort
    }
  }, [sessionKey, currentRunId]);

  const renderBlock = React.useCallback(
    ({ item }: { item: DisplayBlock }) => (
      <OpenClawMessageBubble block={item} />
    ),
    [],
  );

  if (!isConnected) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.colors.groupped.background },
        ]}
      >
        <Ionicons
          name="cloud-offline-outline"
          size={48}
          color={theme.colors.textSecondary}
        />
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
          {t("openclaw.notConnected")}
        </Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.colors.groupped.background },
        ]}
      >
        <ActivityIndicator
          size="large"
          color={theme.colors.button.primary.background}
        />
      </View>
    );
  }

  // Footer: streaming content + typing indicator (avoids FlatList full-list diff)
  const listFooter =
    chatState.streamingContent || chatState.phase !== "idle" ? (
      <View>
        {chatState.streamingContent.length > 0 && (
          <OpenClawMessageBubble
            block={{
              kind: "assistant",
              id: "streaming",
              content: chatState.streamingContent,
            }}
          />
        )}
        {chatState.phase !== "idle" && (
          <OpenClawTypingIndicator phase={chatState.phase} />
        )}
      </View>
    ) : null;

  return (
    <KeyboardAvoidingView
      style={[
        styles.container,
        { backgroundColor: theme.colors.groupped.background },
      ]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <FlatList
        ref={flatListRef}
        data={chatState.blocks as DisplayBlock[]}
        renderItem={renderBlock}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingBottom: 16,
            maxWidth: layout.maxWidth,
            alignSelf: "center" as const,
            width: "100%",
          },
        ]}
        ListFooterComponent={listFooter}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Image
              source={require("@/assets/images/openclaw-icon-color.png")}
              style={styles.emptyIcon}
              contentFit="contain"
            />
            <Text
              style={[styles.emptyText, { color: theme.colors.textSecondary }]}
            >
              {t("openclaw.startConversation")}
            </Text>
          </View>
        }
      />

      {/* Input Area */}
      <View
        style={[
          styles.inputOuter,
          { paddingBottom: Math.max(insets.bottom, 8) },
        ]}
      >
        <View style={[styles.inputInner, { maxWidth: layout.maxWidth }]}>
          <View
            style={[
              styles.unifiedPanel,
              { backgroundColor: theme.colors.input.background },
            ]}
          >
            {/* Image previews */}
            {pendingImages.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.imagePreviewRow}
                contentContainerStyle={styles.imagePreviewContent}
              >
                {pendingImages.map((img) => (
                  <View key={img.id} style={styles.imageChip}>
                    <Image
                      source={{
                        uri: `data:image/jpeg;base64,${img.base64}`,
                      }}
                      contentFit="cover"
                      style={styles.imageThumb}
                    />
                    <Pressable
                      onPress={() => handleRemoveImage(img.id)}
                      style={styles.imageRemoveButton}
                      hitSlop={4}
                    >
                      <Ionicons name="close-circle" size={18} color="#FFFFFF" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}

            {/* Input field */}
            <View style={styles.inputFieldContainer}>
              <MultiTextInput
                value={inputText}
                onChangeText={setInputText}
                placeholder={t("openclaw.messagePlaceholder")}
                paddingTop={Platform.OS === "web" ? 10 : 8}
                paddingBottom={Platform.OS === "web" ? 10 : 8}
                maxHeight={120}
              />
            </View>

            {/* Action buttons row */}
            <View style={styles.actionRow}>
              <View style={styles.actionLeft}>
                {currentRunId && (
                  <Pressable
                    onPress={handleAbort}
                    style={(p) => [
                      styles.actionButton,
                      p.pressed && styles.buttonPressed,
                    ]}
                  >
                    <Octicons
                      name="stop"
                      size={16}
                      color={theme.colors.button.secondary.tint}
                    />
                  </Pressable>
                )}

                <Pressable
                  onPress={handlePickImage}
                  disabled={
                    isPickingImage || pendingImages.length >= MAX_IMAGES
                  }
                  style={(p) => [
                    styles.actionButton,
                    p.pressed && styles.buttonPressed,
                    (isPickingImage || pendingImages.length >= MAX_IMAGES) &&
                      styles.actionButtonDisabled,
                  ]}
                >
                  {isPickingImage ? (
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.textSecondary}
                    />
                  ) : (
                    <Ionicons
                      name="image-outline"
                      size={20}
                      color={
                        pendingImages.length > 0
                          ? theme.colors.status.connected
                          : theme.colors.textSecondary
                      }
                    />
                  )}
                  {pendingImages.length > 0 && (
                    <View
                      style={[
                        styles.imageBadge,
                        {
                          backgroundColor: theme.colors.status.connected,
                        },
                      ]}
                    >
                      <Text style={styles.imageBadgeText}>
                        {pendingImages.length}
                      </Text>
                    </View>
                  )}
                </Pressable>

              </View>

              <View
                style={[
                  styles.sendButton,
                  canSend || isSending
                    ? {
                        backgroundColor: theme.colors.button.primary.background,
                      }
                    : {
                        backgroundColor: theme.colors.button.primary.disabled,
                      },
                ]}
              >
                <Pressable
                  style={(p) => [
                    styles.sendButtonInner,
                    p.pressed && styles.buttonPressed,
                  ]}
                  hitSlop={{
                    top: 5,
                    bottom: 10,
                    left: 0,
                    right: 0,
                  }}
                  onPress={handleSend}
                  disabled={!canSend || isSending}
                >
                  {isSending ? (
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.button.primary.tint}
                    />
                  ) : (
                    <Octicons
                      name="arrow-up"
                      size={16}
                      color={theme.colors.button.primary.tint}
                      style={{
                        marginTop: Platform.OS === "web" ? 2 : 0,
                      }}
                    />
                  )}
                </Pressable>
              </View>
            </View>

          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
});

const styles = StyleSheet.create((_, rt) => ({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 100,
    gap: 12,
  },
  emptyIcon: {
    width: 64,
    height: 64,
  },
  emptyText: {
    ...Typography.default(),
    fontSize: 14,
    textAlign: "center",
  },
  inputOuter: {
    alignItems: "center",
    paddingBottom: 8,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  inputInner: {
    width: "100%",
    position: "relative",
  },
  unifiedPanel: {
    borderRadius: Platform.select({ default: 16, android: 20 }),
    overflow: "hidden",
    paddingVertical: 2,
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  inputFieldContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 0,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 4,
    minHeight: 40,
  },
  imagePreviewRow: {
    maxHeight: 72,
    marginTop: 8,
    marginHorizontal: 4,
  },
  imagePreviewContent: {
    gap: 8,
    paddingHorizontal: 4,
  },
  imageChip: {
    width: 56,
    height: 56,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
  },
  imageThumb: {
    width: 56,
    height: 56,
  },
  imageRemoveButton: {
    position: "absolute",
    top: 2,
    right: 2,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 0,
  },
  actionLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  imageBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  imageBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
    marginLeft: 8,
    marginRight: 8,
  },
  sendButtonInner: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPressed: {
    opacity: 0.7,
  },
}));
