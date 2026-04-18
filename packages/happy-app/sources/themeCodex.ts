export interface CodexShapeTokens {
    radius: {
        panel: number;
        section: number;
        card: number;
        chip: number;
        diff: number;
    };
    spacing: {
        sectionGap: number;
        cardGap: number;
        cardPadding: number;
        panelPadding: number;
        chipX: number;
        chipY: number;
        diffPadding: number;
    };
    borderWidth: {
        soft: number;
        strong: number;
        focus: number;
    };
}

export interface CodexDiffColorTokens {
    headerBg: string;
    gutterBg: string;
    gutterText: string;
    contextBg: string;
    contextText: string;
    addedBg: string;
    addedBorder: string;
    addedText: string;
    removedBg: string;
    removedBorder: string;
    removedText: string;
    inlineAddedBg: string;
    inlineRemovedBg: string;
    hunkBg: string;
    hunkText: string;
}

export interface CodexColorTokens {
    accent: string;
    accentSoft: string;
    accentActive: string;
    panelBg: string;
    sectionBg: string;
    sectionBgElevated: string;
    cardBg: string;
    cardBgHover: string;
    borderSoft: string;
    borderStrong: string;
    borderActive: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    chipBg: string;
    chipBorder: string;
    chipText: string;
    summaryBg: string;
    summaryBorder: string;
    planBg: string;
    planBorder: string;
    codeBg: string;
    codeBorder: string;
    changeKind: {
        add: string;
        update: string;
        delete: string;
    };
    status: {
        pending: string;
        inProgress: string;
        completed: string;
        blocked: string;
    };
    diff: CodexDiffColorTokens;
}

export const sharedCodexTokens: CodexShapeTokens = {
    radius: {
        panel: 14,
        section: 12,
        card: 12,
        chip: 999,
        diff: 10,
    },
    spacing: {
        sectionGap: 12,
        cardGap: 10,
        cardPadding: 12,
        panelPadding: 12,
        chipX: 8,
        chipY: 4,
        diffPadding: 10,
    },
    borderWidth: {
        soft: 1,
        strong: 1.5,
        focus: 2,
    },
};

export const codexLightColors: CodexColorTokens = {
    accent: "#3B5BDB",
    accentSoft: "#E9EEFF",
    accentActive: "#274BDB",
    panelBg: "#F5F7FB",
    sectionBg: "#FFFFFF",
    sectionBgElevated: "#F9FAFC",
    cardBg: "#FFFFFF",
    cardBgHover: "#F4F7FF",
    borderSoft: "#E4E8F1",
    borderStrong: "#CBD5E1",
    borderActive: "#3B5BDB",
    textPrimary: "#111827",
    textSecondary: "#4B5563",
    textMuted: "#6B7280",
    chipBg: "#EEF2FF",
    chipBorder: "#D8E0FF",
    chipText: "#3146A6",
    summaryBg: "#F7F9FF",
    summaryBorder: "#DCE5FF",
    planBg: "#FAFBFD",
    planBorder: "#E5EAF3",
    codeBg: "#F8FAFC",
    codeBorder: "#D9E2EC",
    changeKind: {
        add: "#16A34A",
        update: "#2563EB",
        delete: "#DC2626",
    },
    status: {
        pending: "#6B7280",
        inProgress: "#2563EB",
        completed: "#16A34A",
        blocked: "#DC2626",
    },
    diff: {
        headerBg: "#EEF3FF",
        gutterBg: "#F8FAFC",
        gutterText: "#94A3B8",
        contextBg: "#F8FAFC",
        contextText: "#64748B",
        addedBg: "#E8FAEF",
        addedBorder: "#7FD8A4",
        addedText: "#14532D",
        removedBg: "#FDECEC",
        removedBorder: "#F1A7A7",
        removedText: "#7F1D1D",
        inlineAddedBg: "#B7F0C9",
        inlineRemovedBg: "#F7C1C1",
        hunkBg: "#EEF4FF",
        hunkText: "#3556B8",
    },
};

export const codexDarkColors: CodexColorTokens = {
    accent: "#7C9BFF",
    accentSoft: "#1D2747",
    accentActive: "#9EB3FF",
    panelBg: "#0F1218",
    sectionBg: "#151A22",
    sectionBgElevated: "#1A202A",
    cardBg: "#181E27",
    cardBgHover: "#1D2430",
    borderSoft: "#283244",
    borderStrong: "#3A465C",
    borderActive: "#7C9BFF",
    textPrimary: "#E8ECF3",
    textSecondary: "#B4BFCE",
    textMuted: "#8B97A8",
    chipBg: "#1C2740",
    chipBorder: "#31405F",
    chipText: "#B9C8FF",
    summaryBg: "#141C2E",
    summaryBorder: "#2C3C61",
    planBg: "#141922",
    planBorder: "#283244",
    codeBg: "#11161D",
    codeBorder: "#2D3748",
    changeKind: {
        add: "#4ADE80",
        update: "#7DA8FF",
        delete: "#FF7B72",
    },
    status: {
        pending: "#98A2B3",
        inProgress: "#7DA8FF",
        completed: "#4ADE80",
        blocked: "#FF7B72",
    },
    diff: {
        headerBg: "#1A2340",
        gutterBg: "#121821",
        gutterText: "#64748B",
        contextBg: "#11161D",
        contextText: "#94A3B8",
        addedBg: "#10261A",
        addedBorder: "#245C3A",
        addedText: "#86E6AE",
        removedBg: "#2A1618",
        removedBorder: "#6B2B30",
        removedText: "#FFB3B3",
        inlineAddedBg: "#1C4D2D",
        inlineRemovedBg: "#6B2B30",
        hunkBg: "#1A2340",
        hunkText: "#AFC4FF",
    },
};
