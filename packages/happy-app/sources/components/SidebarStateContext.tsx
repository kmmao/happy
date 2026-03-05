import * as React from "react";

interface SidebarState {
    collapsed: boolean;
    toggleCollapsed: () => void;
}

const SidebarStateContext = React.createContext<SidebarState | undefined>(
    undefined,
);

export const SidebarStateProvider = React.memo(
    ({ children }: { children: React.ReactNode }) => {
        const [collapsed, setCollapsed] = React.useState(false);
        const toggleCollapsed = React.useCallback(
            () => setCollapsed((v) => !v),
            [],
        );
        const value = React.useMemo(
            () => ({ collapsed, toggleCollapsed }),
            [collapsed, toggleCollapsed],
        );
        return (
            <SidebarStateContext.Provider value={value}>
                {children}
            </SidebarStateContext.Provider>
        );
    },
);

export function useSidebarState(): SidebarState {
    const ctx = React.useContext(SidebarStateContext);
    if (!ctx) {
        throw new Error(
            "useSidebarState must be used within SidebarStateProvider",
        );
    }
    return ctx;
}
