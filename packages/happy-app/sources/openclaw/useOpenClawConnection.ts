import * as React from "react";
import {
  OpenClawSocket,
  type OpenClawConnectionStatus,
} from "./OpenClawSocket";
import { loadOpenClawConfig } from "./openclawStorage";
import type { OpenClawChatEvent, OpenClawSession } from "./openclawTypes";

// Track if we've already attempted auto-connect this session
let autoConnectAttempted = false;

/**
 * Hook to track OpenClaw gateway connection status.
 * Automatically attempts to connect if there's a saved config and no active connection.
 */
export function useOpenClawStatus() {
  const [status, setStatus] = React.useState<OpenClawConnectionStatus>(
    OpenClawSocket.getStatus(),
  );
  const [error, setError] = React.useState<string | undefined>();
  const [pairingRequestId, setPairingRequestId] = React.useState<
    string | undefined
  >();

  React.useEffect(() => {
    return OpenClawSocket.onStatusChange((newStatus, err, details) => {
      setStatus(newStatus);
      setError(err);
      setPairingRequestId(details?.pairingRequestId);
    });
  }, []);

  // Auto-connect on mount if saved config exists and not already connected/connecting
  React.useEffect(() => {
    if (autoConnectAttempted) return;
    autoConnectAttempted = true;

    const currentStatus = OpenClawSocket.getStatus();
    if (currentStatus === "connected" || currentStatus === "connecting") {
      return;
    }

    const savedConfig = loadOpenClawConfig();
    if (savedConfig) {
      OpenClawSocket.connect(savedConfig);
    }
  }, []);

  return {
    status,
    error,
    isConnected: status === "connected",
    isConnecting: status === "connecting",
    isPairingRequired: status === "pairing_required",
    pairingRequestId,
    deviceId: OpenClawSocket.getDeviceId(),
    serverHost: OpenClawSocket.getServerHost(),
    mainSessionKey: OpenClawSocket.getMainSessionKey(),
    retryConnect: () => OpenClawSocket.retryConnect(),
  };
}

/**
 * Hook to load and manage OpenClaw sessions list
 */
export function useOpenClawSessions() {
  const { isConnected } = useOpenClawStatus();
  const [sessions, setSessions] = React.useState<OpenClawSession[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadSessions = React.useCallback(async () => {
    if (!OpenClawSocket.isConnected()) {
      setError("Not connected");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const list = await OpenClawSocket.listSessions(100);
      setSessions(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (isConnected) {
      loadSessions();
    } else {
      setSessions([]);
    }
  }, [isConnected, loadSessions]);

  return {
    sessions,
    loading,
    error,
    refresh: loadSessions,
  };
}

/**
 * Hook to subscribe to chat events for a specific session
 */
export function useOpenClawChatEvents(sessionKey: string | null) {
  const [events, setEvents] = React.useState<OpenClawChatEvent[]>([]);
  const [currentRunId, setCurrentRunId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!sessionKey) return;

    // Listen for chat events
    return OpenClawSocket.onEvent((event, payload) => {
      if (event === "chat" && payload) {
        const chatEvent = payload as OpenClawChatEvent;
        if (chatEvent.sessionKey === sessionKey) {
          setEvents((prev) => [...prev, chatEvent]);
          if (chatEvent.state === "started") {
            setCurrentRunId(chatEvent.runId);
          } else if (
            chatEvent.state === "final" ||
            chatEvent.state === "error"
          ) {
            setCurrentRunId(null);
          }
        }
      }
    });
  }, [sessionKey]);

  const clearEvents = React.useCallback(() => {
    setEvents([]);
    setCurrentRunId(null);
  }, []);

  return { events, currentRunId, clearEvents };
}
