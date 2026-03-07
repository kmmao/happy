import * as React from "react";
import {
  View,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "@/text";
import { useHappyAction } from "@/hooks/useHappyAction";
import { issueStore } from "@/sync/issueStore";
import { fetchLabels } from "@/sync/issueFetch";
import type { IssueLabel } from "@/sync/issueTypes";
import { LabelPicker } from "./LabelPicker";

interface IssueEditSheetProps {
  readonly sessionId: string;
  readonly projectKey: string;
  readonly issueNumber: number;
  readonly initialTitle: string;
  readonly initialBody: string;
  readonly initialLabels: readonly string[];
  readonly repoPath?: string;
  readonly onClose: () => void;
  readonly onEdited: (
    title: string,
    body: string,
    labels: readonly string[],
  ) => void;
}

export const IssueEditSheet = React.memo<IssueEditSheetProps>(
  function IssueEditSheet({
    sessionId,
    projectKey,
    issueNumber,
    initialTitle,
    initialBody,
    initialLabels,
    repoPath,
    onClose,
    onEdited,
  }) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();

    const [title, setTitle] = React.useState(initialTitle);
    const [body, setBody] = React.useState(initialBody);
    const [selectedLabels, setSelectedLabels] =
      React.useState<readonly string[]>(initialLabels);
    const [availableLabels, setAvailableLabels] = React.useState<
      readonly IssueLabel[]
    >([]);
    const [loadingLabels, setLoadingLabels] = React.useState(true);

    React.useEffect(() => {
      const repoInfo = issueStore.getState().repoInfoByProject[projectKey];
      if (!repoInfo || repoInfo.provider === "unknown") {
        setLoadingLabels(false);
        return;
      }
      fetchLabels(sessionId, repoInfo, repoPath)
        .then(setAvailableLabels)
        .catch(() => {})
        .finally(() => setLoadingLabels(false));
    }, [sessionId, projectKey, repoPath]);

    const toggleLabel = React.useCallback((name: string) => {
      setSelectedLabels((prev) =>
        prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name],
      );
    }, []);

    const [isSaving, doSave] = useHappyAction(
      React.useCallback(async () => {
        if (!title.trim()) return;
        await issueStore
          .getState()
          .editIssue(
            projectKey,
            issueNumber,
            title.trim(),
            body.trim(),
            sessionId,
            repoPath,
            selectedLabels,
          );
        onEdited(title.trim(), body.trim(), selectedLabels);
        onClose();
      }, [
        title,
        body,
        selectedLabels,
        projectKey,
        issueNumber,
        sessionId,
        repoPath,
        onEdited,
        onClose,
      ]),
    );

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.surface,
          paddingBottom: safeArea.bottom,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontWeight: "bold",
                color: theme.colors.text,
                ...Typography.default("semiBold"),
              }}
            >
              {t("issues.editIssue")}
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text
                style={{
                  fontSize: 14,
                  color: theme.colors.textSecondary,
                  ...Typography.default(),
                }}
              >
                {t("common.cancel")}
              </Text>
            </Pressable>
          </View>

          {/* Title input */}
          <View>
            <TextInput
              style={{
                backgroundColor: theme.colors.input.background,
                borderRadius: 8,
                padding: 12,
                fontSize: 15,
                color: theme.colors.text,
                ...Typography.default(),
              }}
              value={title}
              onChangeText={setTitle}
              placeholder={t("issues.editTitlePlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              autoFocus
              returnKeyType="next"
            />
          </View>

          {/* Body input */}
          <View>
            <Text
              style={{
                fontSize: 13,
                color: theme.colors.textSecondary,
                marginBottom: 6,
                ...Typography.default(),
              }}
            >
              {t("issues.newIssueBody")}
            </Text>
            <TextInput
              style={{
                backgroundColor: theme.colors.input.background,
                borderRadius: 8,
                padding: 12,
                fontSize: 15,
                color: theme.colors.text,
                minHeight: 120,
                textAlignVertical: "top",
                ...Typography.default(),
              }}
              value={body}
              onChangeText={setBody}
              placeholder={t("issues.editBodyPlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              multiline
            />
          </View>

          {/* Labels */}
          <LabelPicker
            availableLabels={availableLabels}
            selectedLabels={selectedLabels}
            loadingLabels={loadingLabels}
            onToggleLabel={toggleLabel}
          />
        </ScrollView>

        {/* Save button */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: theme.colors.textSecondary + "20",
          }}
        >
          <Pressable
            onPress={doSave}
            disabled={!title.trim() || isSaving}
            style={{
              backgroundColor: theme.colors.button.primary.background,
              borderRadius: 10,
              paddingVertical: 12,
              alignItems: "center",
              opacity: !title.trim() || isSaving ? 0.5 : 1,
            }}
          >
            {isSaving ? (
              <ActivityIndicator
                size="small"
                color={theme.colors.button.primary.tint}
              />
            ) : (
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "600",
                  color: theme.colors.button.primary.tint,
                  ...Typography.default("semiBold"),
                }}
              >
                {t("common.save")}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  },
);
