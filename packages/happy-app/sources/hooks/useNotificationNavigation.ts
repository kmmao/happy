/**
 * Handles push notification taps and navigates to the relevant screen.
 *
 * Supervisor notifications carry { type: "supervisor", projectId, runId }
 * and navigate to the project's Health tab.
 */

import * as React from "react";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { projectManager } from "@/sync/projectManager";

export function useNotificationNavigation() {
    const router = useRouter();

    const navigateToSupervisorProject = React.useCallback((serverProjectId: string) => {
        const localProjectId = projectManager.getProjectByServerId(serverProjectId)?.id;
        if (!localProjectId) return;
        router.push({
            pathname: "/project/[id]",
            params: {
                id: localProjectId,
                tab: "health",
            },
        });
    }, [router]);

    React.useEffect(() => {
        // Handle notification taps while app is running
        const subscription =
            Notifications.addNotificationResponseReceivedListener(
                (response) => {
                    const data = response.notification.request.content.data;
                    if (data?.type === "supervisor" && data.projectId) {
                        navigateToSupervisorProject(data.projectId as string);
                    }
                },
            );

        // Handle cold-start notification (app was killed)
        // This API is not available on web
        if (Platform.OS !== "web") {
            Notifications.getLastNotificationResponseAsync().then(
                (response) => {
                    if (!response) return;
                    const data =
                        response.notification.request.content.data;
                    if (data?.type === "supervisor" && data.projectId) {
                        // Small delay to let the navigation tree mount
                        setTimeout(() => {
                            navigateToSupervisorProject(data.projectId as string);
                        }, 500);
                    }
                },
            );
        }

        return () => subscription.remove();
    }, [navigateToSupervisorProject]);
}
