import React from "react";
import {
    Modal,
    View,
    Text,
    SafeAreaView,
    Pressable,
    ScrollView,
} from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { PermissionFooter } from "./PermissionFooter";
import { formatPermissionParams } from "@/utils/formatPermissionParams";
import { t } from "@/text";
import { getToolViewComponent } from "./views/_all";
import { TOOLS_WITH_BUILTIN_SUBMIT_UI } from "./toolsWithBuiltinSubmitUI";
import type { ToolCall } from "@/sync/typesMessage";
import type { Metadata } from "@/sync/storageTypes";
import { Typography } from "@/constants/Typography";

type Props = {
    visible: boolean;
    sessionId: string;
    toolName: string;
    toolInput: any;
    permission: NonNullable<ToolCall["permission"]>;
    metadata: Metadata | null;
    onClose: () => void;
};

export const PermissionSheet = React.memo(
    ({ visible, sessionId, toolName, toolInput, permission, metadata, onClose }: Props) => {
        const { theme } = useUnistyles();
        const SpecificToolView = getToolViewComponent(toolName);
        const tool: ToolCall = React.useMemo(() => ({
            name: toolName,
            state: "running",
            input: toolInput,
            createdAt: Date.now(),
            startedAt: null,
            completedAt: null,
            description: null,
            permission,
        }), [permission, toolInput, toolName]);
        // Picker tools (AskUserQuestion + mcp__happy__ask_user) render their
        // own submit UI; the generic PermissionFooter would call the wrong RPC
        // and drop the user's answers — see TOOLS_WITH_BUILTIN_SUBMIT_UI for
        // the rationale.
        const useSpecificToolView =
            TOOLS_WITH_BUILTIN_SUBMIT_UI.has(toolName) && SpecificToolView != null;

        // Auto-close once the permission is no longer pending
        React.useEffect(() => {
            if (visible && permission.status !== "pending") {
                const timer = setTimeout(onClose, 500);
                return () => clearTimeout(timer);
            }
        }, [visible, permission.status, onClose]);

        const params = formatPermissionParams(toolInput, 4, 80);

        return (
            <Modal
                visible={visible}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={onClose}
            >
                <SafeAreaView
                    style={{
                        flex: 1,
                        backgroundColor: theme.colors.surface,
                    }}
                >
                    {/* Header */}
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            paddingHorizontal: 16,
                            paddingVertical: 14,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.divider,
                        }}
                    >
                        <View
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 8,
                            }}
                        >
                            <View
                                style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 4,
                                    backgroundColor: theme.colors.accentOrange,
                                }}
                            />
                            <Text
                                style={{
                                    fontSize: 17,
                                    fontWeight: "600",
                                    color: theme.colors.text,
                                    ...Typography.default(),
                                }}
                            >
                                {t("permissions.sheetTitle")}
                            </Text>
                        </View>
                        <Pressable
                            onPress={onClose}
                            hitSlop={12}
                            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                        >
                            <Ionicons
                                name="close"
                                size={22}
                                color={theme.colors.textSecondary}
                            />
                        </Pressable>
                    </View>

                    <ScrollView
                        style={{ flex: 1 }}
                        contentContainerStyle={{ paddingBottom: 32 }}
                        keyboardShouldPersistTaps="handled"
                    >
                        {/* Tool name + params */}
                        <View
                            style={{
                                paddingHorizontal: 16,
                                paddingTop: 16,
                                paddingBottom: 12,
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: 15,
                                    fontWeight: "600",
                                    color: theme.colors.text,
                                    marginBottom: params ? 8 : 0,
                                    ...Typography.default(),
                                }}
                            >
                                {toolName}
                            </Text>
                            {!!params && (
                                <View
                                    style={{
                                        backgroundColor: theme.colors.surfacePressed,
                                        borderRadius: 8,
                                        padding: 10,
                                    }}
                                >
                                    <Text
                                        style={{
                                            fontSize: 13,
                                            color: theme.colors.textSecondary,
                                            fontFamily: "Courier",
                                            lineHeight: 18,
                                        }}
                                    >
                                        {params}
                                    </Text>
                                </View>
                            )}
                        </View>

                        <View
                            style={{
                                height: 1,
                                backgroundColor: theme.colors.divider,
                                marginHorizontal: 16,
                            }}
                        />

                        {useSpecificToolView && SpecificToolView ? (
                            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                                <SpecificToolView
                                    tool={tool}
                                    metadata={metadata}
                                    messages={[]}
                                    sessionId={sessionId}
                                />
                            </View>
                        ) : (
                            <PermissionFooter
                                permission={permission}
                                sessionId={sessionId}
                                toolName={toolName}
                                toolInput={toolInput}
                                metadata={metadata}
                            />
                        )}
                    </ScrollView>
                </SafeAreaView>
            </Modal>
        );
    },
);
