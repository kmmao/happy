/**
 * Push suppression helper — answers "is the user actively looking at any
 * Happy client right now?".
 *
 * "Active" means a non-machine socket is connected to the event router
 * (session-scoped or user-scoped — any mobile/web/desktop client). A CLI
 * daemon machine-scoped socket does NOT count: those receive only machine
 * updates and cannot display chat notifications to a human, so a push to
 * the mobile device is still warranted when only machines are connected.
 *
 * No external state (Redis, Maps) needed — socket presence lives on the
 * in-process `eventRouter.userConnections` map; when a socket disconnects
 * its entry disappears automatically, so this check is always current.
 *
 * Future extension: when clients start sending `app-state: background`
 * over socket, treat backgrounded sockets as inactive even when connected.
 */

import { eventRouter } from "@/app/events/eventRouter";

export function isUserActive(userId: string): boolean {
    return eventRouter.hasActiveNonMachineSocket(userId);
}
