import * as React from "react";
import { View, Text, TouchableWithoutFeedback, Pressable } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { PermissionMode, ModelMode } from "./PermissionModeSelector";
import { hapticsLight } from "./haptics";
import { FloatingOverlay } from "./FloatingOverlay";
import { stylesheet } from "./AgentInputStyles";
import { t } from "@/text";
import { Metadata } from "@/sync/storageTypes";
import type { ReasoningProps } from "./AgentInputTypes";

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
            isCodex,
            isGemini,
            withSandboxSuffix,
            maxHeight,
        } = props;

        const styles = stylesheet;
        const { theme } = useUnistyles();

        if (!visible) {
            return null;
        }

        return (
            <>
                <TouchableWithoutFeedback onPress={onClose}>
                    <View style={styles.overlayBackdrop} />
                </TouchableWithoutFeedback>
                <View
                    style={[
                        styles.settingsOverlay,
                        { paddingHorizontal: screenWidth > 700 ? 0 : 8 },
                    ]}
                >
                    <FloatingOverlay
                        maxHeight={maxHeight ?? 400}
                        keyboardShouldPersistTaps="always"
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

                        {/* Effort Level Section (only for Claude) */}
                        {!isCodex &&
                            !isGemini &&
                            reasoning?.onEffortLevelChange &&
                            (() => {
                                const currentModelInfo = metadata?.models?.find(
                                    (m) => m.code === modelMode?.key,
                                );
                                // Hide entire section if model explicitly doesn't support effort
                                if (currentModelInfo?.supportsEffort === false)
                                    return null;
                                return true;
                            })() && (
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
                                        {(() => {
                                            const currentModelInfo =
                                                metadata?.models?.find(
                                                    (m) => m.code === modelMode?.key,
                                                );
                                            const allLevels = [
                                                {
                                                    key: "high",
                                                    name: t("agentInput.effort.high"),
                                                    description: t("agentInput.effort.highDesc"),
                                                },
                                                {
                                                    key: "max",
                                                    name: t("agentInput.effort.max"),
                                                    description: t("agentInput.effort.maxDesc"),
                                                },
                                                {
                                                    key: "medium",
                                                    name: t("agentInput.effort.medium"),
                                                    description: t("agentInput.effort.mediumDesc"),
                                                },
                                                {
                                                    key: "low",
                                                    name: t("agentInput.effort.low"),
                                                    description: t("agentInput.effort.lowDesc"),
                                                },
                                            ] as const;
                                            const supported =
                                                currentModelInfo?.supportedEffortLevels;
                                            const levels = supported
                                                ? allLevels.filter((l) =>
                                                    supported.includes(l.key),
                                                )
                                                : allLevels;
                                            return levels;
                                        })().map((level) => {
                                            const isSelected =
                                                reasoning?.effortLevel === level.key ||
                                                (!reasoning?.effortLevel && level.key === "medium");

                                            return (
                                                <Pressable
                                                    key={level.key}
                                                    onPress={() => {
                                                        hapticsLight();
                                                        reasoning?.onEffortLevelChange?.(level.key);
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
                                                            {level.name}
                                                        </Text>
                                                        {!!level.description && (
                                                            <Text
                                                                style={{
                                                                    fontSize: 11,
                                                                    color: theme.colors.textSecondary,
                                                                    ...Typography.default(),
                                                                }}
                                                            >
                                                                {level.description}
                                                            </Text>
                                                        )}
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
                        {/* Task Token Budget Section (only for Claude, alpha) */}
                        {!isCodex && !isGemini && reasoning?.onTaskBudgetTokensChange && (
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
                                        {t("agentInput.taskBudget.title")}
                                    </Text>
                                    {[
                                        { key: null, name: t("agentInput.taskBudget.off"), description: t("agentInput.taskBudget.offDesc") },
                                        { key: 50000, name: "50K", description: t("agentInput.taskBudget.quickDesc") },
                                        { key: 100000, name: "100K", description: t("agentInput.taskBudget.standardDesc") },
                                        { key: 200000, name: "200K", description: t("agentInput.taskBudget.largeDesc") },
                                        { key: 500000, name: "500K", description: t("agentInput.taskBudget.unlimitedDesc") },
                                    ].map((preset) => {
                                        const isSelected = reasoning?.taskBudgetTokens == null
                                            ? preset.key === null
                                            : reasoning?.taskBudgetTokens === preset.key;

                                        return (
                                            <Pressable
                                                key={String(preset.key)}
                                                onPress={() => {
                                                    hapticsLight();
                                                    reasoning?.onTaskBudgetTokensChange?.(preset.key);
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
                                                        {preset.name}
                                                    </Text>
                                                    {!!preset.description && (
                                                        <Text
                                                            style={{
                                                                fontSize: 11,
                                                                color: theme.colors.textSecondary,
                                                                ...Typography.default(),
                                                            }}
                                                        >
                                                            {preset.description}
                                                        </Text>
                                                    )}
                                                </View>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            </>
                        )}
                    </FloatingOverlay>
                </View>
            </>
        );
    },
);
