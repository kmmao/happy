import React from "react";
import { View, Text, Pressable, StyleSheet as RNStyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { generateWebhookSecret } from "@/sync/webhookRouteSync";
import type { WebhookRepoConfig } from "@/sync/issueTypes";
import type { Theme } from "@/theme";
import type { Provider } from "./types";
import { WebhookRepoItem } from "./WebhookRepoItem";
import type { SupervisorProfileOption } from "@/components/project/supervisorProfileSelection";

interface Props {
    readonly theme: Theme;
    readonly provider: Provider;
    readonly machines: readonly { id: string; metadata?: any }[];
    readonly profiles: ReadonlyArray<SupervisorProfileOption>;
    readonly formWebhookRepos: WebhookRepoConfig[];
    readonly onAddRepo: () => void;
    readonly onUpdateRepo: (
        index: number,
        updates: Partial<WebhookRepoConfig>,
    ) => void;
    readonly onRemoveRepo: (index: number) => void;
    readonly host: string;
    readonly apiToken?: string;
    readonly autoIssueLabel?: string;
    readonly autoIssueAllowedAuthors?: readonly string[];
    readonly onSaveComplete: (index: number, updatedRepo: WebhookRepoConfig) => void;
    readonly onDeleteComplete: (index: number) => void;
    readonly isNewHost: boolean;
}

export const GitHostWebhookForm = React.memo(function GitHostWebhookForm({
    theme,
    provider,
    machines,
    profiles,
    formWebhookRepos,
    onAddRepo,
    onUpdateRepo,
    onRemoveRepo,
    host,
    apiToken,
    autoIssueLabel,
    autoIssueAllowedAuthors,
    onSaveComplete,
    onDeleteComplete,
    isNewHost,
}: Props) {
    return (
        <View>
            <Text
                style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color: theme.colors.text,
                    marginTop: 4,
                    marginBottom: 8,
                    ...Typography.default("semiBold"),
                }}
            >
                {t("gitHosts.webhookSectionTitle")}
            </Text>
            <Text
                style={{
                    fontSize: 12,
                    color: theme.colors.textSecondary,
                    marginBottom: 12,
                    lineHeight: 16,
                    ...Typography.default(),
                }}
            >
                {t("gitHosts.webhookDescription")}
            </Text>

            {/* Cross-pointer to WebhookTrigger ("Webhook URL" in the
                Workflow list). Surfaces here so a user looking for
                a generic callback URL doesn't waste time configuring a
                repo-bound webhook by mistake. */}
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: 10,
                    marginBottom: 12,
                    borderRadius: 8,
                    backgroundColor: `${theme.colors.textLink}14`,
                    borderWidth: RNStyleSheet.hairlineWidth,
                    borderColor: `${theme.colors.textLink}33`,
                }}
            >
                <Ionicons
                    name="link-outline"
                    size={14}
                    color={theme.colors.textLink}
                />
                <Text
                    style={{
                        flex: 1,
                        fontSize: 12,
                        color: theme.colors.text,
                        lineHeight: 16,
                        ...Typography.default(),
                    }}
                >
                    {t("gitHosts.webhookCrossPointer")}
                </Text>
            </View>

            {formWebhookRepos.map((repo, idx) => (
                <WebhookRepoItem
                    key={repo.secret || idx}
                    repo={repo}
                    index={idx}
                    provider={provider}
                    machines={machines}
                    profiles={profiles}
                    theme={theme}
                    onUpdate={onUpdateRepo}
                    onRemove={onRemoveRepo}
                    host={host}
                    apiToken={apiToken}
                    autoIssueLabel={autoIssueLabel}
                    autoIssueAllowedAuthors={autoIssueAllowedAuthors}
                    onSaveComplete={onSaveComplete}
                    onDeleteComplete={onDeleteComplete}
                    isNewHost={isNewHost}
                />
            ))}

            {/* Add webhook repo button */}
            <Pressable
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingVertical: 10,
                    borderRadius: 8,
                    backgroundColor: theme.colors.surface,
                    marginBottom: 8,
                }}
                onPress={onAddRepo}
            >
                <Ionicons
                    name="add-circle-outline"
                    size={18}
                    color={theme.colors.textLink}
                    style={{ marginRight: 6 }}
                />
                <Text
                    style={{
                        fontSize: 14,
                        color: theme.colors.textLink,
                        fontWeight: "600",
                        ...Typography.default("semiBold"),
                    }}
                >
                    {t("gitHosts.webhookAddRepo")}
                </Text>
            </Pressable>
        </View>
    );
});
