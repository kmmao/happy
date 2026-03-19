import type { MoscowPriority, FeatureComplexity } from "./roadmapTypes";
import type { Ionicons } from "@expo/vector-icons";

export const MOSCOW_ICONS: Record<MoscowPriority, keyof typeof Ionicons.glyphMap> = {
    must_have: "alert-circle-outline",
    should_have: "arrow-up-circle-outline",
    could_have: "remove-circle-outline",
    wont_have: "close-circle-outline",
};

export const MOSCOW_COLORS: Record<MoscowPriority, string> = {
    must_have: "#FF3B30",
    should_have: "#FF9500",
    could_have: "#007AFF",
    wont_have: "#8E8E93",
};

export const COMPLEXITY_ICONS: Record<FeatureComplexity, keyof typeof Ionicons.glyphMap> = {
    trivial: "flash-outline",
    simple: "leaf-outline",
    moderate: "layers-outline",
    complex: "git-branch-outline",
    very_complex: "nuclear-outline",
};

export const COMPLEXITY_COLORS: Record<FeatureComplexity, string> = {
    trivial: "#34C759",
    simple: "#30D158",
    moderate: "#FF9500",
    complex: "#FF6B35",
    very_complex: "#FF3B30",
};
