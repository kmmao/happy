import * as React from "react";
import { View, Text, Pressable, Modal as RNModal, ScrollView } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { ModelMode } from "./PermissionModeSelector";
import { hapticsLight } from "./haptics";
import { t } from "@/text";

export interface AgentInputModelSelectorModalProps {
    visible: boolean;
    onClose: () => void;
    availableModels: ModelMode[];
    /** Key of the currently selected model (`modelMode?.key`). */
    selectedKey?: string;
    onSelectModel?: (model: ModelMode) => void;
}

/**
 * The quick model-selector modal surfaced from the model summary chip in
 * AgentInput. Extracted from AgentInput's body (mirroring
 * AgentInputSettingsOverlay) so the ~110-line radio-list modal lives behind a
 * narrow interface — visibility, the model list, the selected key, and a single
 * select callback — instead of being inlined in the 2400-line composer.
 */
export const AgentInputModelSelectorModal = React.memo(
    function AgentInputModelSelectorModal(props: AgentInputModelSelectorModalProps) {
        const { visible, onClose, availableModels, selectedKey, onSelectModel } = props;
        const { theme } = useUnistyles();

        return (
            <RNModal
                visible={visible}
                transparent
                animationType="fade"
                onRequestClose={onClose}
            >
                <Pressable
                    style={{
                        flex: 1,
                        backgroundColor: "rgba(0,0,0,0.45)",
                        justifyContent: "center",
                        paddingHorizontal: 16,
                        paddingVertical: 24,
                    }}
                    onPress={onClose}
                >
                    <Pressable
                        onPress={(event) => event.stopPropagation()}
                        style={{
                            maxHeight: "70%",
                            borderRadius: 16,
                            overflow: "hidden",
                            backgroundColor: theme.colors.surface,
                            borderWidth: 1,
                            borderColor: theme.colors.divider,
                        }}
                    >
                        <View
                            style={{
                                paddingHorizontal: 16,
                                paddingTop: 16,
                                paddingBottom: 12,
                                borderBottomWidth: 1,
                                borderBottomColor: theme.colors.divider,
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: 16,
                                    color: theme.colors.text,
                                    ...Typography.default("semiBold"),
                                }}
                            >
                                {t("agentInput.model.title")}
                            </Text>
                        </View>

                        <ScrollView>
                            {availableModels.map((model) => {
                                const isSelected = selectedKey === model.key;
                                return (
                                    <Pressable
                                        key={model.key}
                                        onPress={() => {
                                            hapticsLight();
                                            onSelectModel?.(model);
                                            onClose();
                                        }}
                                        style={({ pressed }) => ({
                                            flexDirection: "row",
                                            alignItems: "center",
                                            paddingHorizontal: 16,
                                            paddingVertical: 12,
                                            backgroundColor: pressed
                                                ? theme.colors.surfacePressed
                                                : "transparent",
                                        })}
                                    >
                                        <View
                                            style={{
                                                width: 16,
                                                height: 16,
                                                borderRadius: 8,
                                                borderWidth: 2,
                                                borderColor: isSelected
                                                    ? theme.colors.radio.active
                                                    : theme.colors.radio.inactive,
                                                alignItems: "center",
                                                justifyContent: "center",
                                                marginRight: 12,
                                            }}
                                        >
                                            {isSelected && (
                                                <View
                                                    style={{
                                                        width: 6,
                                                        height: 6,
                                                        borderRadius: 3,
                                                        backgroundColor: theme.colors.radio.dot,
                                                    }}
                                                />
                                            )}
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text
                                                style={{
                                                    fontSize: 14,
                                                    color: isSelected
                                                        ? theme.colors.radio.active
                                                        : theme.colors.text,
                                                    ...Typography.default(),
                                                }}
                                            >
                                                {model.name}
                                            </Text>
                                            {!!model.description && (
                                                <Text
                                                    style={{
                                                        fontSize: 11,
                                                        color: theme.colors.textSecondary,
                                                        ...Typography.default(),
                                                    }}
                                                >
                                                    {model.description}
                                                </Text>
                                            )}
                                        </View>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    </Pressable>
                </Pressable>
            </RNModal>
        );
    },
);
