import { Ionicons } from "@expo/vector-icons";
import { UiTabTone } from "./tabTone";

export type AppTabKey =
    | "inbox"
    | "sessions"
    | "project"
    | "openclaw"
    | "settings";

export interface AppTabPresentation {
    icon: keyof typeof Ionicons.glyphMap;
    tone: UiTabTone;
}

const PRESENTATIONS: Record<AppTabKey, AppTabPresentation> = {
    inbox: {
        icon: "mail-outline",
        tone: "blue",
    },
    sessions: {
        icon: "chatbubble-ellipses-outline",
        tone: "neutral",
    },
    project: {
        icon: "folder-open-outline",
        tone: "purple",
    },
    openclaw: {
        icon: "sparkles-outline",
        tone: "orange",
    },
    settings: {
        icon: "settings-outline",
        tone: "teal",
    },
};

export function resolveAppTabPresentation(key: AppTabKey): AppTabPresentation {
    return PRESENTATIONS[key];
}
