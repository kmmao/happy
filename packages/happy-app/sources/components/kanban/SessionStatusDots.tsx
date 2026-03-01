import * as React from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { StatusDot } from "@/components/StatusDot";
import { useSession } from "@/sync/storage";
import { useSessionStatus } from "@/utils/sessionUtils";
import type { Session } from "@/sync/storageTypes";

interface SessionStatusDotsProps {
    sessionIds: readonly string[];
}

/**
 * Renders a row of StatusDot indicators for linked sessions.
 * Each dot reflects the real-time state (online, thinking, needs attention, etc.).
 */
export const SessionStatusDots = React.memo(
    ({ sessionIds }: SessionStatusDotsProps) => {
        if (sessionIds.length === 0) return null;

        return (
            <View style={styles.container}>
                {sessionIds.map((id) => (
                    <SingleSessionDot key={id} sessionId={id} />
                ))}
            </View>
        );
    },
);

/**
 * Individual session dot — each is its own component so hooks are called safely.
 */
const SingleSessionDot = React.memo(
    ({ sessionId }: { sessionId: string }) => {
        const session = useSession(sessionId);
        if (!session) return null;

        return <SessionDotInner session={session} />;
    },
);

/**
 * Inner component that consumes session status.
 * Separated to avoid conditional hook call when session is null.
 */
const SessionDotInner = React.memo(
    ({ session }: { session: Session }) => {
        const status = useSessionStatus(session);

        return (
            <StatusDot
                color={status.statusDotColor}
                isPulsing={status.isPulsing}
                size={6}
            />
        );
    },
);

const styles = StyleSheet.create(() => ({
    container: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
    },
}));
