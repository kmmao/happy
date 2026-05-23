import * as React from "react";
import { View, Text, Pressable, Modal as RNModal, ScrollView } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { PermissionMode, ModelMode } from "./PermissionModeSelector";
import { hapticsLight } from "./haptics";
import { stylesheet } from "./AgentInputStyles";
import { t } from "@/text";
import { Metadata } from "@/sync/storageTypes";
import type { ReasoningProps } from "./AgentInputTypes";
import {
    getVisibleEffortLevels,
    shouldShowEffortSelector,
} from "./reasoningEffort";

export interface AgentInputSettingsOverlayProps {
    visible: boolean;
    onClose: () => void;
    screenWidth: number;
    availableModes: PermissionMode[];
    permissionModeKey: string;
    handleSettingsSelect: (mode: PermissionMode) => void;
    availableModels: ModelMode[];
    modelMode?: ModelMode | null;
    onModelModeChange?: (mode: ModelMode) => void;
    reasoning?: ReasoningProps;
    metadata?: Metadata | null;
    currentModelCode?: string | null;
    isCodex: boolean;
    isGemini: boolean;
    withSandboxSuffix: (label: string, modeKey?: string) => string;
    maxHeight?: number;
}

export const AgentInputSettingsOverlay = React.memo(
    function AgentInputSettingsOverlay(props: AgentInputSettingsOverlayProps) {
        const {
            visible,
            onClose,
            screenWidth,
            availableModes,
            permissionModeKey,
            handleSettingsSelect,
            availableModels,
            modelMode,
            onModelModeChange,
            reasoning,
            metadata,
            currentModelCode,
            isCodex,
            isGemini,
            withSandboxSuffix,
            maxHeight,
        } = props;

        const styles = stylesheet;
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
                        onPress={(e) => e.stopPropagation()}
                        style={{
                            maxHeight: "70%",
                            borderRadius: 16,
                            overflow: "hidden",
                            backgroundColor: theme.colors.surface,
                            borderWidth: 1,
                            borderColor: theme.colors.divider,
                        }}
                    >
                    <ScrollView
                        keyboardShouldPersistTaps="always"
                        showsVerticalScrollIndicator
                    >
                        {/* Permission Mode Section */}
                        <View style={styles.overlaySection}>
                            <Text style={styles.overlaySectionTitle}>
                                {isCodex
                                    ? t("agentInput.codexPermissionMode.title")
                                    : isGemini
                                        ? t("agentInput.geminiPermissionMode.title")
                                        : t("agentInput.permissionMode.title")}
                            </Text>
                            {availableModes.map((mode) => {
                                const isSelected = permissionModeKey === mode.key;

                                return (
                                    <Pressable
                                        key={mode.key}
                                        onPress={() => handleSettingsSelect(mode)}
                                        style={({ pressed }) => ({
                                            flexDirection: "row",
                                            alignItems: "center",
                                            paddingHorizontal: 16,
                                            paddingVertical: 8,
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
                                                {withSandboxSuffix(mode.name, mode.key)}
                                            </Text>
                                            {!!mode.description && (
                                                <Text
                                                    style={{
                                                        fontSize: 11,
                                                        color: theme.colors.textSecondary,
                                                        ...Typography.default(),
                                                    }}
                                                >
                                                    {mode.description}
                                                </Text>
                                            )}
                                        </View>
                                    </Pressable>
                                );
                            })}
                        </View>

                        {/* Divider */}
                        <View
                            style={{
                                height: 1,
                                backgroundColor: theme.colors.divider,
                                marginHorizontal: 16,
                            }}
                        />

                        {/* Model Section */}
                        <View style={{ paddingVertical: 8 }}>
                            <Text
                                style={{
                                    fontSize: 12,
                                    fontWeight: "600",
                                    color: theme.colors.textSecondary,
                                    paddingHorizontal: 16,
                                    paddingBottom: 4,
                                    ...Typography.default("semiBold"),
                                }}
                            >
                                {t("agentInput.model.title")}
                            </Text>
                            {availableModels.length > 0 ? (
                                availableModels.map((model) => {
                                    const isSelected = modelMode?.key === model.key;

                                    return (
                                        <Pressable
                                            key={model.key}
                                            onPress={() => {
                                                hapticsLight();
                                                onModelModeChange?.(model);
                                            }}
                                            style={({ pressed }) => ({
                                                flexDirection: "row",
                                                alignItems: "center",
                                                paddingHorizontal: 16,
                                                paddingVertical: 8,
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
                                            <View>
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
                                })
                            ) : (
                                <Text
                                    style={{
                                        fontSize: 13,
                                        color: theme.colors.textSecondary,
                                        paddingHorizontal: 16,
                                        paddingVertical: 8,
                                        ...Typography.default(),
                                    }}
                                >
                                    {t("agentInput.model.configureInCli")}
                                </Text>
                            )}
                        </View>

                        {/* Effort Level Section */}
                        {shouldShowEffortSelector({
                            isCodex,
                            isGemini,
                            hasEffortHandler: !!reasoning?.onEffortLevelChange,
                            metadata,
                            modelModeKey: modelMode?.key,
                            currentModelCode,
                        }) && (
                                <>
                                    <View
                                        style={{
                                            height: 1,
                                            backgroundColor: theme.colors.divider,
                                            marginHorizontal: 16,
                                        }}
                                    />
                                    <View style={{ paddingVertical: 8 }}>
                                        <Text
                                            style={{
                                                fontSize: 12,
                                                fontWeight: "600",
                                                color: theme.colors.textSecondary,
                                                paddingHorizontal: 16,
                                                paddingBottom: 4,
                                                ...Typography.default("semiBold"),
                                            }}
                                        >
                                            {t("agentInput.effort.title")}
                                        </Text>
                                        {getVisibleEffortLevels({
                                            isCodex,
                                            metadata,
                                            modelModeKey: modelMode?.key,
                                            currentModelCode,
                                        }).map((level) => {
                                            const isSelected =
                                                reasoning?.effortLevel === level ||
                                                (!isCodex &&
                                                    !reasoning?.effortLevel &&
                                                    level === "medium");

                                            return (
                                                <Pressable
                                                    key={level}
                                                    onPress={() => {
                                                        hapticsLight();
                                                        reasoning?.onEffortLevelChange?.(
                                                            isCodex && isSelected
                                                                ? null
                                                                : level,
                                                        );
                                                    }}
                                                    style={({ pressed }) => ({
                                                        flexDirection: "row",
                                                        alignItems: "center",
                                                        paddingHorizontal: 16,
                                                        paddingVertical: 8,
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
                                                            {t(`agentInput.effort.${level}`)}
                                                        </Text>
                                                        <Text
                                                            style={{
                                                                fontSize: 11,
                                                                color: theme.colors.textSecondary,
                                                                ...Typography.default(),
                                                            }}
                                                        >
                                                            {t(`agentInput.effort.${level}Desc`)}
                                                        </Text>
                                                    </View>
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                </>
                        )}

                        {/* Thinking Mode Section (only for Claude) */}
                        {!isCodex && !isGemini && reasoning?.onThinkingModeChange && (
                            <>
                                <View
                                    style={{
                                        height: 1,
                                        backgroundColor: theme.colors.divider,
                                        marginHorizontal: 16,
                                    }}
                                />
                                <View style={{ paddingVertical: 8 }}>
                                    <Text
                                        style={{
                                            fontSize: 12,
                                            fontWeight: "600",
                                            color: theme.colors.textSecondary,
                                            paddingHorizontal: 16,
                                            paddingBottom: 4,
                                            ...Typography.default("semiBold"),
                                        }}
                                    >
                                        {t("agentInput.thinking.title")}
                                    </Text>
                                    {(() => {
                                        const currentModelInfo = metadata?.models?.find(
                                            (m) => m.code === modelMode?.key,
                                        );
                                        const allModes = [
                                            {
                                                key: "adaptive",
                                                name: t("agentInput.thinking.adaptive"),
                                                description: t(
                                                    "agentInput.thinking.adaptiveDesc",
                                                ),
                                            },
                                            {
                                                key: "enabled",
                                                name: t("agentInput.thinking.enabled"),
                                                description: t("agentInput.thinking.enabledDesc"),
                                            },
                                            {
                                                key: "disabled",
                                                name: t("agentInput.thinking.disabled"),
                                                description: t(
                                                    "agentInput.thinking.disabledDesc",
                                                ),
                                            },
                                        ] as const;
                                        // Hide "adaptive" option if model doesn't support it
                                        return currentModelInfo?.supportsAdaptiveThinking ===
                                            false
                                            ? allModes.filter((m) => m.key !== "adaptive")
                                            : allModes;
                                    })().map((mode) => {
                                        const isSelected =
                                            reasoning?.thinkingMode === mode.key ||
                                            (!reasoning?.thinkingMode && mode.key === "adaptive");

                                        return (
                                            <Pressable
                                                key={mode.key}
                                                onPress={() => {
                                                    hapticsLight();
                                                    reasoning?.onThinkingModeChange?.(mode.key);
                                                }}
                                                style={({ pressed }) => ({
                                                    flexDirection: "row",
                                                    alignItems: "center",
                                                    paddingHorizontal: 16,
                                                    paddingVertical: 8,
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
                                                        {mode.name}
                                                    </Text>
                                                    {!!mode.description && (
                                                        <Text
                                                            style={{
                                                                fontSize: 11,
                                                                color: theme.colors.textSecondary,
                                                                ...Typography.default(),
                                                            }}
                                                        >
                                                            {mode.description}
                                                        </Text>
                                                    )}
                                                </View>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            </>
                        )}
                        {/*
                         * Task Token Budget panel was removed: PTY mode has no
                         * --task-budget flag and no settings.json equivalent,
                         * so the alpha SDK-only field was silently dropped.
                         * Session state still carries `taskBudgetTokens` for
                         * back-compat; this section can be reinstated when
                         * Claude TUI exposes the knob.
                         */}
                    </ScrollView>
                    </Pressable>
                </Pressable>
            </RNModal>
        );
    },
);
