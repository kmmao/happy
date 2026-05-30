/**
 * Context that lets deeply-nested message blocks raise a "duplicate from this
 * message" intent up to SessionView, without prop-drilling through MessageView
 * → UserTextBlock → action rows.
 *
 * SessionView wraps the chat in <SessionForkProvider value={…}> and supplies
 * a `requestDuplicate(message)` callback. UserTextBlock then calls
 * `useSessionFork().requestDuplicate(...)` from its long-press handler.
 *
 * The Provider is mounted unconditionally; the *capability* of duplicating
 * lives in the callback. When the experiment toggle is off, SessionView
 * passes `undefined` and consumers no-op (gating in one place).
 */

import * as React from "react";
import type { UserTextMessage } from "@/sync/typesMessage";

interface SessionForkContextValue {
  /** When defined, deep chat children may invoke this to open DuplicateSheet
   *  anchored at the given message. Undefined disables the affordance. */
  requestDuplicate?: (message: UserTextMessage) => void;
}

const SessionForkContext = React.createContext<SessionForkContextValue>({});

export function SessionForkProvider({
  requestDuplicate,
  children,
}: {
  requestDuplicate?: (message: UserTextMessage) => void;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ requestDuplicate }),
    [requestDuplicate],
  );
  return (
    <SessionForkContext.Provider value={value}>
      {children}
    </SessionForkContext.Provider>
  );
}

export function useSessionFork(): SessionForkContextValue {
  return React.useContext(SessionForkContext);
}
