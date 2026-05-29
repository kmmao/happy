import { RecipientFilter } from "./eventRouter";

/**
 * The connection facts the scope-routing rule actually needs. The real
 * ClientConnection also carries a live socket and userId; the routing decision
 * depends on none of that, so this narrow shape is the matcher's true interface
 * — and lets tests pin every rule without fabricating a socket.
 */
export type ConnectionScope =
  | { connectionType: "session-scoped"; sessionId: string }
  | { connectionType: "user-scoped" }
  | { connectionType: "machine-scoped"; machineId: string };

/**
 * Decide whether a single connection should receive a message under a given
 * recipient filter. This is the single source of truth for the scope-routing
 * rules — extracted from EventRouter.shouldSendToConnection so the rules are
 * testable in isolation and cannot silently drift as scopes are added. Behavior
 * is identical to the former private method.
 */
export function recipientMatches(
  connection: ConnectionScope,
  filter: RecipientFilter,
): boolean {
  switch (filter.type) {
    case "all-interested-in-session":
      // session-scoped only if the session matches; machines never; user-scoped always.
      if (connection.connectionType === "session-scoped") {
        return connection.sessionId === filter.sessionId;
      }
      if (connection.connectionType === "machine-scoped") {
        return false;
      }
      return true; // user-scoped always gets it

    case "user-scoped-only":
      return connection.connectionType === "user-scoped";

    case "machine-scoped-only":
      // user-scoped (mobile/web needs all machine updates) + only the named machine.
      if (connection.connectionType === "user-scoped") {
        return true;
      }
      if (connection.connectionType === "machine-scoped") {
        return connection.machineId === filter.machineId;
      }
      return false; // session-scoped doesn't need machine updates

    case "all-user-authenticated-connections":
      return true;

    default:
      return false;
  }
}
