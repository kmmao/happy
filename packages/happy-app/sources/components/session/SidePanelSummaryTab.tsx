import * as React from "react";
import { View, Platform } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { Octicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import {
    useSession,
    useSessionGitStatus,
    useSessionProjectGitStatus,
    useProjectForSession,
} from "@/sync/storage";
import {
    formatPathRelativeToHome,
    getSessionName,
} from "@/utils/sessionUtils";
import { ItemList } from "@/components/ItemList";

interface SidePanelSummaryTabProps {
    sessionId: string;
}

export const SidePanelSummaryTab = React.memo<SidePanelSummaryTabProps>(
    function SidePanelSummaryTab({ sessionId }) {
        const { theme } = useUnistyles();
        const session = useSession(sessionId);
        const projectGitStatus = useSessionProjectGitStatus(sessionId);
        const sessionGitStatus = useSessionGitStatus(sessionId);
        const gitStatus = projectGitStatus || sessionGitStatus;
        const project = useProjectForSession(sessionId);

        if (!session) return null;

        const isConnected = session.presence === "online";
        const path = session.metadata?.path;
        const homeDir = session.metadata?.homeDir;
        const displayPath = path
            ? formatPathRelativeToHome(path, homeDir)
            : undefined;
        const cliVersion = session.metadata?.version;

        const rows: Array<{ icon: string; label: string; value: string }> = [];

        if (displayPath) {
            rows.push({
                icon: "file-directory",
                label: t("sidePanel.workingDir"),
                value: displayPath,
            });
        }

        if (gitStatus?.branch) {
            rows.push({
                icon: "git-branch",
                label: t("sidePanel.branch"),
                value: gitStatus.branch,
            });
        }

        if (gitStatus && gitStatus.lastUpdatedAt > 0) {
            const staged = gitStatus.stagedCount;
            const modified = gitStatus.modifiedCount;
            const untracked = gitStatus.untrackedCount;
            const parts: string[] = [];
            if (staged > 0) parts.push(`${staged} ${t("sidePanel.staged")}`);
            if (modified > 0) parts.push(`${modified} ${t("sidePanel.modified")}`);
            if (untracked > 0) parts.push(`${untracked} ${t("sidePanel.untracked")}`);
            if (parts.length > 0) {
                rows.push({
                    icon: "diff",
                    label: t("sidePanel.status"),
                    value: parts.join(", "),
                });
            }

            const added = gitStatus.linesAdded;
            const removed = gitStatus.linesRemoved;
            if (added > 0 || removed > 0) {
                rows.push({
                    icon: "diff-added",
                    label: t("sidePanel.lines"),
                    value: `+${added} / -${removed}`,
                });
            }
        }

        if (project?.key.path) {
            const projectName = project.key.path.split("/").pop() || project.key.path;
            rows.push({
                icon: "project",
                label: t("sidePanel.project"),
                value: projectName,
            });
        }

        if (cliVersion) {
            rows.push({
                icon: "terminal",
                label: t("sidePanel.cliVersion"),
                value: `v${cliVersion}`,
            });
        }

        return (
            <ItemList style={{ flex: 1 }}>
                {/* Connection status */}
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                        borderBottomColor: theme.colors.divider,
                        backgroundColor: theme.colors.surfaceHigh,
                        gap: 8,
                    }}
                >
                    <View
                        style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: isConnected
                                ? theme.colors.success
                                : theme.colors.textSecondary,
                        }}
                    />
                    <Text
                        style={{
                            fontSize: 14,
                            fontWeight: "600",
                            color: theme.colors.text,
                            ...Typography.default(),
                        }}
                    >
                        {getSessionName(session)}
                    </Text>
                </View>

                {!isConnected && (
                    <View
                        style={{
                            paddingHorizontal: 16,
                            paddingVertical: 20,
                            alignItems: "center",
                        }}
                    >
                        <Text
                            style={{
                                fontSize: 14,
                                color: theme.colors.textSecondary,
                                ...Typography.default(),
                            }}
                        >
                            {t("sidePanel.sessionOffline")}
                        </Text>
                    </View>
                )}

                {/* Info rows */}
                {rows.map((row, i) => (
                    <View
                        key={row.label}
                        style={{
                            flexDirection: "row",
                            alignItems: "flex-start",
                            paddingHorizontal: 16,
                            paddingVertical: 10,
                            borderBottomWidth:
                                i < rows.length - 1
                                    ? Platform.select({ ios: 0.33, default: 1 })
                                    : 0,
                            borderBottomColor: theme.colors.divider,
                            gap: 10,
                        }}
                    >
                        <Octicons
                            name={row.icon as any}
                            size={15}
                            color={theme.colors.textSecondary}
                            style={{ marginTop: 2 }}
                        />
                        <View style={{ flex: 1 }}>
                            <Text
                                style={{
                                    fontSize: 11,
                                    color: theme.colors.textSecondary,
                                    marginBottom: 2,
                                    ...Typography.default(),
                                }}
                            >
                                {row.label}
                            </Text>
                            <Text
                                style={{
                                    fontSize: 13,
                                    color: theme.colors.text,
                                    ...Typography.mono(),
                                }}
                                numberOfLines={2}
                            >
                                {row.value}
                            </Text>
                        </View>
                    </View>
                ))}
            </ItemList>
        );
    },
);
