/**
 * FilePreviewContext — optional handle to a SessionView-level multi-file
 * preview stack. When a host (currently SessionView's chat column) provides
 * an `OpenFilesStack`, descendants (AgentInput's `@` picker, inline file
 * links, future inline file pills) can route a file tap into the shared
 * multi-tab overlay instead of falling through to the legacy `/file`
 * deep-link route.
 *
 * The context value is intentionally nullable: not every screen wires up a
 * provider (e.g. the standalone `/git` page hosts its own stack, the new-
 * session screen has no chat column), and a missing provider should mean
 * "let the consumer fall back to its old behavior", never a runtime crash.
 *
 * Consumers should read via `useOptionalFilePreview()` and pass an
 * `onFilePress` only when the hook returned a non-null value.
 */

import * as React from "react";

import type { OpenFilesStack } from "./useOpenFilesStack";

export const FilePreviewContext = React.createContext<OpenFilesStack | null>(null);

export function useOptionalFilePreview(): OpenFilesStack | null {
    return React.useContext(FilePreviewContext);
}
