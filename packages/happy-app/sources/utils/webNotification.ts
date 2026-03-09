import { Platform } from "react-native";

/**
 * Web Notification API wrapper for happy-app.
 * Only active on web platform; all functions are no-ops on native.
 */

// Track notified permission request IDs to avoid duplicate notifications
const notifiedRequestIds = new Set<string>();

export function isNotificationSupported(): boolean {
  return Platform.OS === "web" && typeof Notification !== "undefined";
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (!isNotificationSupported()) {
    return "unsupported";
  }
  return Notification.requestPermission();
}

export function getNotificationPermission():
  | NotificationPermission
  | "unsupported" {
  if (!isNotificationSupported()) {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Send a web notification if the tab is not visible.
 * Uses `tag` to deduplicate across multiple tabs.
 */
export function sendWebNotification(
  title: string,
  options?: { body?: string; tag?: string },
): void {
  if (!isNotificationSupported()) {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }
  if (!document.hidden) {
    return;
  }

  const notification = new Notification(title, {
    body: options?.body,
    tag: options?.tag,
    icon: "/icon-notification.png",
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  // Auto-close after 5 seconds
  setTimeout(() => notification.close(), 5000);
}

/**
 * Send a notification for task completion.
 */
export function notifyTaskComplete(
  sessionName: string,
  sessionId: string,
  title: string,
): void {
  sendWebNotification(title, {
    body: sessionName,
    tag: `task-complete-${sessionId}`,
  });
}

/**
 * Send a notification for permission request.
 * Dedup strategy: `notifiedRequestIds` prevents the same requestId from
 * firing multiple times (agentState can be pushed repeatedly).
 * `tag: permission-${sessionId}` ensures only the latest permission
 * notification per session is shown (browser replaces same-tag notifications).
 */
export function notifyPermissionRequest(
  sessionName: string,
  sessionId: string,
  requestId: string,
  toolName: string | undefined,
  title: string,
): void {
  if (notifiedRequestIds.has(requestId)) {
    return;
  }
  notifiedRequestIds.add(requestId);

  const body = toolName ? `${sessionName}: ${toolName}` : sessionName;

  sendWebNotification(title, {
    body,
    tag: `permission-${sessionId}`,
  });
}

/**
 * Clear notified request IDs for a session when permissions are resolved.
 */
export function clearNotifiedRequests(requestIds: string[]): void {
  for (const id of requestIds) {
    notifiedRequestIds.delete(id);
  }
}
