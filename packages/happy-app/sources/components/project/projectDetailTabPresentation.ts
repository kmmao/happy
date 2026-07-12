import { Ionicons } from "@expo/vector-icons";
import { ProjectDetailTabKey } from "./projectDetailTabs";
import { UiTabTone } from "@/components/tabTone";

export interface ProjectDetailTabPresentation {
    icon: keyof typeof Ionicons.glyphMap;
    tone: UiTabTone;
}

const PRESENTATIONS: Record<ProjectDetailTabKey, ProjectDetailTabPresentation> = {
    sessions: {
        icon: "chatbubble-ellipses-outline",
        tone: "neutral",
    },
    workflows: {
        icon: "git-network-outline",
        tone: "purple",
    },
    git: {
        icon: "git-branch-outline",
        tone: "orange",
    },
    supervisor: {
        icon: "scan-outline",
        tone: "blue",
    },
    health: {
        icon: "pulse-outline",
        tone: "green",
    },
    events: {
        icon: "flash-outline",
        tone: "orange",
    },
    research: {
        icon: "search-outline",
        tone: "blue",
    },
    knowledge: {
        icon: "library-outline",
        tone: "purple",
    },
    traces: {
        icon: "pulse-outline",
        tone: "green",
    },
    config: {
        icon: "settings-outline",
        tone: "teal",
    },
};

export function resolveProjectDetailTabPresentation(
    key: ProjectDetailTabKey,
): ProjectDetailTabPresentation {
    return PRESENTATIONS[key];
}
