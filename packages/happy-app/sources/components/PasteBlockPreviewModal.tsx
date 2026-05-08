import { Ionicons } from "@expo/vector-icons";
import * as React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { MultiTextInput } from "./MultiTextInput";
import type { PasteBlock } from "./pasteBlock";

interface PasteBlockPreviewModalProps {
  visible: boolean;
  block: PasteBlock | null;
  onClose: () => void;
  onSave: (id: string, text: string) => void;
  onRemove?: (id: string) => void;
}

export const PasteBlockPreviewModal = React.memo(
  ({ visible, block, onClose, onSave, onRemove }: PasteBlockPreviewModalProps) => {
    const { theme } = useUnistyles();
    const [draftText, setDraftText] = React.useState(block?.text ?? "");

    React.useEffect(() => {
      setDraftText(block?.text ?? "");
    }, [block?.id, block?.text]);

    const handleSave = React.useCallback(() => {
      if (!block) return;
      onClose();
      onSave(block.id, draftText);
    }, [block, onClose, onSave, draftText]);

    const handleRemove = React.useCallback(() => {
      if (!block) return;
      onClose();
      onRemove?.(block.id);
    }, [block, onClose, onRemove]);

    return (
      <Modal
        visible={visible && block !== null}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            paddingHorizontal: 16,
            paddingVertical: 24,
            justifyContent: "center",
          }}
          onPress={onClose}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              maxHeight: "78%",
              borderRadius: 18,
              overflow: "hidden",
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.divider,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 16,
                paddingTop: 14,
                paddingBottom: 10,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.divider,
              }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 16,
                    color: theme.colors.text,
                    ...Typography.default("semiBold"),
                  }}
                >
                  {t("session.pastedContent")}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    marginTop: 2,
                    fontSize: 12,
                    color: theme.colors.textSecondary,
                    ...Typography.default(),
                  }}
                >
                  {block?.summary}
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("common.cancel")}
                hitSlop={10}
                onPress={onClose}
                style={({ pressed }) => ({
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.75 : 1,
                  backgroundColor: theme.colors.surfacePressed,
                })}
              >
                <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
              <View
                style={{
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.colors.divider,
                  backgroundColor: theme.colors.surfacePressed,
                  padding: 14,
                }}
              >
                <Text
                  style={{
                    marginBottom: 8,
                    fontSize: 12,
                    color: theme.colors.textSecondary,
                    ...Typography.default("semiBold"),
                  }}
                >
                  {t("session.pastedContent")}
                </Text>
                <MultiTextInput
                  value={draftText}
                  onChangeText={setDraftText}
                  placeholder={t("session.pastedContent")}
                  maxHeight={240}
                  paddingTop={0}
                  paddingBottom={0}
                  paddingLeft={0}
                  paddingRight={0}
                  editable
                />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: theme.colors.textSecondary,
                    ...Typography.default(),
                  }}
                >
                  {block
                    ? `${block.lineCount} ${block.lineCount === 1 ? "line" : "lines"} · ${block.charCount} chars`
                    : ""}
                </Text>

                <View style={{ flexDirection: "row", gap: 8 }}>
                  {onRemove && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("common.remove")}
                      onPress={handleRemove}
                      style={({ pressed }) => ({
                        minHeight: 34,
                        paddingHorizontal: 12,
                        borderRadius: 999,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: theme.colors.surfacePressed,
                        opacity: pressed ? 0.8 : 1,
                      })}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          color: theme.colors.textSecondary,
                          ...Typography.default("semiBold"),
                        }}
                      >
                        {t("common.remove")}
                      </Text>
                    </Pressable>
                  )}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.save")}
                    onPress={handleSave}
                    style={({ pressed }) => ({
                      minHeight: 34,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: theme.colors.button.primary.background,
                      opacity: pressed ? 0.88 : 1,
                    })}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        color: theme.colors.button.primary.tint,
                        ...Typography.default("semiBold"),
                      }}
                    >
                      {t("common.save")}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  },
);

PasteBlockPreviewModal.displayName = "PasteBlockPreviewModal";
