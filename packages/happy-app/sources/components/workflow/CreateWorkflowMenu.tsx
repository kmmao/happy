/**
 * CreateWorkflowMenu — header "+" entry point for the Workflow IA.
 *
 * Reports surfaced that the previous Modal.alert version silently
 * failed to open on PC web. This rewrite uses our PopoverMenu (real
 * popover on desktop, bottom sheet on mobile) which is portal-mounted
 * via RN Modal and has been verified visible on both surfaces.
 *
 * Surfaces three creation paths:
 *   - Start a session     → router.push("/new")
 *   - Create a schedule   → MakeRecurringModal in standalone mode
 *   - Create a webhook    → CreateWebhookModal in standalone mode
 */

import * as React from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import { MakeRecurringModal } from "./MakeRecurringModal";
import { CreateWebhookModal } from "./CreateWebhookModal";
import { PopoverMenu, usePopoverAnchor } from "@/components/PopoverMenu";

interface CreateWorkflowMenuProps {
    style?: any;
}

export const CreateWorkflowMenu = React.memo(function CreateWorkflowMenu({
    style,
}: CreateWorkflowMenuProps) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const { anchor, ref, open, close, isOpen } = usePopoverAnchor();
    const [scheduleModalVisible, setScheduleModalVisible] = React.useState(false);
    const [webhookModalVisible, setWebhookModalVisible] = React.useState(false);

    return (
        <>
            <View ref={ref} collapsable={false}>
                <Pressable
                    onPress={open}
                    hitSlop={15}
                    style={style}
                    accessibilityLabel={t("workflows.createMenuTitle")}
                >
                    <Ionicons
                        name="add-outline"
                        size={28}
                        color={theme.colors.header.tint}
                    />
                </Pressable>
            </View>

            <PopoverMenu
                visible={isOpen}
                onClose={close}
                anchor={anchor}
                title={t("workflows.createMenuTitle")}
                options={[
                    {
                        key: "session",
                        label: t("workflows.createMenuNewSession"),
                        hint: t("workflows.createMenuNewSessionHint"),
                        icon: "chatbubble-ellipses-outline",
                        iconColor: "#8E8E93",
                        onPress: () => router.push("/new"),
                    },
                    {
                        key: "schedule",
                        label: t("workflows.createMenuScheduled"),
                        hint: t("workflows.createMenuScheduledHint"),
                        icon: "timer-outline",
                        iconColor: "#34C759",
                        onPress: () => setScheduleModalVisible(true),
                    },
                    {
                        key: "webhook",
                        label: t("workflows.createMenuWebhook"),
                        hint: t("workflows.createMenuWebhookHint"),
                        icon: "flash-outline",
                        iconColor: "#0A84FF",
                        onPress: () => setWebhookModalVisible(true),
                    },
                ]}
            />

            <MakeRecurringModal
                visible={scheduleModalVisible}
                onClose={() => setScheduleModalVisible(false)}
            />
            <CreateWebhookModal
                visible={webhookModalVisible}
                onClose={() => setWebhookModalVisible(false)}
            />
        </>
    );
});
