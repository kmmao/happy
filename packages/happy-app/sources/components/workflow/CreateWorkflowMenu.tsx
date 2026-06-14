/**
 * CreateWorkflowMenu — header "+" entry point for the Workflow IA.
 *
 * The Sessions tab header used to be a single + that pushed /new
 * (start an Ad-hoc Workflow). With Scheduled/Event Workflows being
 * first-class IA citizens, that single button hid the ability to create
 * automation from scratch (the only previous path was "open a Session,
 * long-press, Make recurring" — discoverable only by users who already
 * knew). This menu surfaces all three creation paths at the top:
 *
 *   - Start a session     → router.push("/new")
 *   - Create a schedule   → opens MakeRecurringModal in standalone mode
 *   - Create a webhook    → disabled (gated on cli/agent updates)
 *
 * The menu opens via Modal.alert so we don't fight platform-specific
 * popover quirks; native users get a familiar action sheet, web users
 * get a centered modal.
 */

import * as React from "react";
import { Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { Modal } from "@/modal";
import { t } from "@/text";
import { MakeRecurringModal } from "./MakeRecurringModal";

interface CreateWorkflowMenuProps {
    style?: any;
}

export const CreateWorkflowMenu = React.memo(function CreateWorkflowMenu({
    style,
}: CreateWorkflowMenuProps) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const [scheduleModalVisible, setScheduleModalVisible] = React.useState(false);

    const openMenu = React.useCallback(() => {
        Modal.alert(
            t("workflows.createMenuTitle"),
            "",
            [
                { text: t("common.cancel"), style: "cancel" },
                {
                    text: t("workflows.createMenuNewSession"),
                    onPress: () => router.push("/new"),
                },
                {
                    text: t("workflows.createMenuScheduled"),
                    onPress: () => setScheduleModalVisible(true),
                },
                // Webhook intentionally omitted from the action sheet for
                // now — pre-displaying a disabled option in alert() isn't
                // ideal UX. When ADR-0022 phase 3b lands and webhook
                // creation gets wired, add a fourth entry here.
            ],
        );
    }, [router]);

    return (
        <>
            <Pressable
                onPress={openMenu}
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
            <MakeRecurringModal
                visible={scheduleModalVisible}
                onClose={() => setScheduleModalVisible(false)}
            />
        </>
    );
});
