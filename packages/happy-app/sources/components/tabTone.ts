export type UiTabTone =
    | "neutral"
    | "blue"
    | "purple"
    | "green"
    | "orange"
    | "teal"
    | "magenta";

interface TabToneTheme {
    colors: {
        accentBlue: string;
        accentPurple: string;
        success: string;
        accentOrange: string;
        accentTeal: string;
        accentMagenta: string;
        textSecondary: string;
        groupped: {
            background: string;
        };
    };
}

export function resolveUiTabToneColors(
    tone: UiTabTone,
    theme: TabToneTheme,
): { backgroundColor: string; textColor: string } {
    switch (tone) {
        case "blue":
            return {
                backgroundColor: `${theme.colors.accentBlue}1A`,
                textColor: theme.colors.accentBlue,
            };
        case "purple":
            return {
                backgroundColor: `${theme.colors.accentPurple}1A`,
                textColor: theme.colors.accentPurple,
            };
        case "green":
            return {
                backgroundColor: `${theme.colors.success}1A`,
                textColor: theme.colors.success,
            };
        case "orange":
            return {
                backgroundColor: `${theme.colors.accentOrange}1A`,
                textColor: theme.colors.accentOrange,
            };
        case "teal":
            return {
                backgroundColor: `${theme.colors.accentTeal}1A`,
                textColor: theme.colors.accentTeal,
            };
        case "magenta":
            return {
                backgroundColor: `${theme.colors.accentMagenta}1A`,
                textColor: theme.colors.accentMagenta,
            };
        default:
            return {
                backgroundColor: theme.colors.groupped.background,
                textColor: theme.colors.textSecondary,
            };
    }
}
