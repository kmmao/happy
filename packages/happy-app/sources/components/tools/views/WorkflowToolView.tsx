import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ToolViewProps } from "./_all";
import { ToolSectionView } from "../ToolSectionView";
import { CodeView } from "@/components/CodeView";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { parseWorkflowScriptMeta } from "./workflowToolData";

/**
 * Renders Workflow tool invocations. Instead of dumping the raw
 * `{ script: "export const meta = {…}\n…" }` (a multi-KB string with literal
 * \n escapes — unreadable), we parse the script's `meta` block and show the
 * workflow name, description, and declared phases. The full script is still
 * available, collapsed, for anyone who wants it.
 */
export const WorkflowToolView = React.memo<ToolViewProps>(({ tool }) => {
    const { theme } = useUnistyles();
    const meta = React.useMemo(
        () => parseWorkflowScriptMeta(tool.input),
        [tool.input],
    );

    const script =
        tool.input && typeof tool.input === "object"
            ? (tool.input as Record<string, unknown>).script
            : undefined;
    const scriptText = typeof script === "string" ? script : "";

    const hasMeta = !!(meta.name || meta.description || meta.phases.length);

    // Nothing parseable — fall back to whatever input exists as JSON.
    if (!hasMeta && !scriptText) {
        return null;
    }

    return (
        <>
            {!!meta.description && (
                <ToolSectionView title={meta.name || "Workflow"}>
                    <Text
                        style={[styles.description, { color: theme.colors.text }]}
                    >
                        {meta.description}
                    </Text>
                </ToolSectionView>
            )}

            {meta.phases.length > 0 && (
                <ToolSectionView title={t("toolView.workflowPhases")}>
                    <View style={styles.phaseList}>
                        {meta.phases.map((p, i) => (
                            <View key={`${i}-${p.title}`} style={styles.phaseRow}>
                                <View
                                    style={[
                                        styles.phaseDot,
                                        { backgroundColor: theme.colors.textSecondary },
                                    ]}
                                />
                                <View style={styles.phaseTextBlock}>
                                    <Text
                                        style={[
                                            styles.phaseTitle,
                                            { color: theme.colors.text },
                                        ]}
                                    >
                                        {p.title}
                                    </Text>
                                    {!!p.detail && (
                                        <Text
                                            style={[
                                                styles.phaseDetail,
                                                { color: theme.colors.textSecondary },
                                            ]}
                                        >
                                            {p.detail}
                                        </Text>
                                    )}
                                </View>
                            </View>
                        ))}
                    </View>
                </ToolSectionView>
            )}

            {!!scriptText && (
                <ToolSectionView title={t("toolView.input")}>
                    <CodeView code={scriptText} language="javascript" />
                </ToolSectionView>
            )}
        </>
    );
});

const styles = StyleSheet.create(() => ({
    description: {
        ...Typography.default("regular"),
        fontSize: 13,
        lineHeight: 18,
    },
    phaseList: {
        gap: 8,
    },
    phaseRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    phaseDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginTop: 6,
    },
    phaseTextBlock: {
        flex: 1,
        gap: 2,
    },
    phaseTitle: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
    phaseDetail: {
        ...Typography.default("regular"),
        fontSize: 12,
        lineHeight: 16,
    },
}));
