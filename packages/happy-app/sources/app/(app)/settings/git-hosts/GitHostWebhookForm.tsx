import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { generateWebhookSecret } from "@/sync/webhookRouteSync";
import type { WebhookRepoConfig } from "@/sync/issueTypes";
import type { Provider } from "./types";
import { WebhookRepoItem } from "./WebhookRepoItem";

interface Props {
    readonly theme: any;
    readonly provider: Provider;
    readonly machines: readonly { id: string; metadata?: any }[];
    readonly formWebhookRepos: WebhookRepoConfig[];
    readonly onAddRepo: () => void;
    readonly onUpdateRepo: (
        index: number,
        updates: Partial<WebhookRepoConfig>,
    ) => void;
    readonly onRemoveRepo: (index: number) => void;
}

export const GitHostWebhookForm = React.memo(function GitHostWebhookForm({
    theme,
    provider,
    machines,
    formWebhookRepos,
    onAddRepo,
    onUpdateRepo,
    onRemoveRepo,
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

            {formWebhookRepos.map((repo, idx) => (
                <WebhookRepoItem
                    key={idx}
                    repo={repo}
                    index={idx}
                    provider={provider}
                    machines={machines}
                    theme={theme}
                    onUpdate={onUpdateRepo}
                    onRemove={onRemoveRepo}
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
