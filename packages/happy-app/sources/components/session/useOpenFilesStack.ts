/**
 * useOpenFilesStack — shared multi-file preview state used by SessionSidePanel,
 * MobileSessionPanelSheet and the /git page.
 *
 * Each host keeps an array of currently opened files plus the active index and
 * a "preview overlay visible" flag. The hook exposes:
 *
 *   - `openFiles`  — ordered list of {filePath, repoPath?}
 *   - `activeIndex`— index of the currently visible tab
 *   - `previewVisible` — whether the overlay is shown (independent of length so
 *     the user can minimize back to the browser while keeping tabs alive)
 *
 *   - `openFile(path, repo)`  — open or focus a file; reopens the overlay
 *   - `pressTab(index)`       — switch active tab
 *   - `closeTab(index)`       — close one tab; closes the overlay if empty
 *   - `minimize()`            — hide the overlay but keep tabs
 *
 * `openFile` de-dupes by `filePath`: tapping an already-open file simply
 * switches to its tab instead of pushing a duplicate.
 */

import * as React from "react";

import type { OpenFile } from "./OpenFilesTabBar";

export interface OpenFilesStack {
    readonly openFiles: ReadonlyArray<OpenFile>;
    readonly activeIndex: number;
    readonly previewVisible: boolean;
    readonly openFile: (filePath: string, repoPath?: string) => void;
    readonly pressTab: (index: number) => void;
    readonly closeTab: (index: number) => void;
    readonly minimize: () => void;
}

export function useOpenFilesStack(): OpenFilesStack {
    const [openFiles, setOpenFiles] = React.useState<ReadonlyArray<OpenFile>>([]);
    const [activeIndex, setActiveIndex] = React.useState(0);
    const [previewVisible, setPreviewVisible] = React.useState(false);

    const openFile = React.useCallback(
        (filePath: string, repoPath?: string) => {
            setOpenFiles((prev) => {
                const existing = prev.findIndex((f) => f.filePath === filePath);
                if (existing >= 0) {
                    setActiveIndex(existing);
                    return prev;
                }
                setActiveIndex(prev.length);
                return [...prev, { filePath, repoPath }];
            });
            setPreviewVisible(true);
        },
        [],
    );

    const pressTab = React.useCallback((index: number) => {
        setActiveIndex(index);
    }, []);

    const closeTab = React.useCallback((index: number) => {
        // Compute the next state from prev so two state setters don't race.
        setOpenFiles((prev) => {
            const next = prev.filter((_, i) => i !== index);
            // Update activeIndex synchronously based on the post-close list so
            // the active tab does not jump to a stale index after the filter.
            setActiveIndex((curr) => {
                if (next.length === 0) return 0;
                if (index < curr) return curr - 1;
                if (index === curr) return Math.max(0, Math.min(curr, next.length - 1));
                return curr;
            });
            if (next.length === 0) setPreviewVisible(false);
            return next;
        });
    }, []);

    const minimize = React.useCallback(() => {
        setPreviewVisible(false);
    }, []);

    return {
        openFiles,
        activeIndex,
        previewVisible,
        openFile,
        pressTab,
        closeTab,
        minimize,
    };
}
