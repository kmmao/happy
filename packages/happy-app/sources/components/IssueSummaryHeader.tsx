/**
 * Fixed Issue Summary Header displayed at the top of issue-linked sessions.
 *
 * Shows issue number, title, processing status, and optional PR link.
 * Supports collapse/expand (default: collapsed).
 * When expanded, shows structured sections matching CLI buildIssuePrompt format:
 *   - Metadata (repository, author, labels, created date, URL)
 *   - Description (issue body)
 *   - Worktree (branch, parent branch) — if available
 */

import * as React from "react";
import { View, Pressable, Linking, Platform, ScrollView } from "react-native";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { screenLayoutMaxWidth } from "@/components/layout";
import {
  ISSUE_STATUS_COLORS,
  ISSUE_STATUS_LABELS,
} from "@/constants/issueStatusColors";
import type { IssueSessionLink } from "@/sync/issueSessionTypes";
import { t } from "@/text";

const MAX_BODY_HEIGHT = 240;

interface WorktreeData {
  readonly branchName: string;
  readonly parentBranch: string;
}

interface IssueSummaryHeaderProps {
  readonly issueLink: IssueSessionLink;
  readonly issueBody?: string | null;
  readonly prUrl?: string | null;
  readonly worktree?: WorktreeData | null;
}

function formatDate(timestamp: number): string {
  if (timestamp === 0) return "—";
  return new Date(timestamp).toISOString().split("T")[0];
}

/**
 * Build task instruction steps matching CLI buildIssuePrompt format.
 */
function buildTaskSteps(
  issueNumber: number,
  worktree: WorktreeData | null | undefined,
): readonly string[] {
  const branch = worktree?.branchName ?? "<branch>";
  const parent = worktree?.parentBranch ?? "main";
  return [
    "1. Read CLAUDE.md and any project configuration files to understand repo conventions",
    "2. Analyze this issue thoroughly — understand the root cause and full scope",
    "3. If the issue or comments contain image URLs (e.g. screenshots, mockups), use WebFetch to view them for visual context",
    "4. Implement the required changes following the project's coding standards",
    "5. Run existing tests to make sure nothing is broken",
    `6. Create a well-formatted commit referencing this issue (e.g. "fix: description - closes #${issueNumber}")`,
    `7. Sync with the latest base branch: git fetch origin ${parent} && git rebase origin/${parent}`,
    `8. Push your branch: git push -u origin ${branch}`,
    `9. Create a pull request: gh pr create --base "${parent}" --head "${branch}"`,
    "10. After completing, provide a concise summary of what you changed and why",
  ];
}

export const IssueSummaryHeader = React.memo<IssueSummaryHeaderProps>(
  function IssueSummaryHeader({ issueLink, issueBody, prUrl, worktree }) {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);

    const statusColor = ISSUE_STATUS_COLORS[issueLink.status].text;
    const statusBg = ISSUE_STATUS_COLORS[issueLink.status].bg;
    const statusLabel = ISSUE_STATUS_LABELS[issueLink.status]();

    const effectivePrUrl = prUrl ?? issueLink.prUrl;

    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.surfaceHigh,
            borderBottomColor: theme.colors.divider,
          },
        ]}
      >
        {/* Title row: status dot + #number + title + chevron */}
        <Pressable
          style={styles.titleRow}
          onPress={() => setExpanded((v) => !v)}
        >
          <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
            <View
              style={[styles.statusDot, { backgroundColor: statusColor }]}
            />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {statusLabel}
            </Text>
          </View>

          <Text style={[styles.issueNumber, { color: theme.colors.textLink }]}>
            #{issueLink.issueNumber}
          </Text>

          <Text
            style={[styles.issueTitle, { color: theme.colors.text }]}
            numberOfLines={1}
          >
            {issueLink.issueTitle}
          </Text>

          {effectivePrUrl ? (
            <Pressable
              onPress={() => Linking.openURL(effectivePrUrl)}
              hitSlop={8}
            >
              <Ionicons
                name="git-pull-request-outline"
                size={14}
                color={theme.colors.textLink}
              />
            </Pressable>
          ) : null}

          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={theme.colors.textSecondary}
          />
        </Pressable>

        {/* Expanded content: structured sections */}
        {expanded && (
          <ScrollView
            style={styles.expandedContent}
            contentContainerStyle={styles.expandedContentInner}
            nestedScrollEnabled
          >
            {/* == Metadata Section == */}
            <SectionHeader
              label={t("issues.sectionMetadata")}
              color={theme.colors.text}
            />
            <View style={styles.metadataSection}>
              <MetadataKV
                label={t("issues.metaRepository")}
                value={issueLink.repoLabel}
                color={theme.colors.textSecondary}
                labelColor={theme.colors.text}
              />
              {issueLink.issueAuthor ? (
                <MetadataKV
                  label={t("issues.metaAuthor")}
                  value={`@${issueLink.issueAuthor}`}
                  color={theme.colors.textSecondary}
                  labelColor={theme.colors.text}
                />
              ) : null}
              {issueLink.issueLabels && issueLink.issueLabels.length > 0 ? (
                <MetadataKV
                  label={t("issues.metaLabels")}
                  value={issueLink.issueLabels.join(", ")}
                  color={theme.colors.textSecondary}
                  labelColor={theme.colors.text}
                />
              ) : null}
              <MetadataKV
                label={t("issues.metaCreated")}
                value={formatDate(issueLink.createdAt)}
                color={theme.colors.textSecondary}
                labelColor={theme.colors.text}
              />
              {issueLink.issueUrl ? (
                <Pressable onPress={() => Linking.openURL(issueLink.issueUrl!)}>
                  <MetadataKV
                    label="URL"
                    value={issueLink.issueUrl}
                    color={theme.colors.textLink}
                    labelColor={theme.colors.text}
                    numberOfLines={1}
                  />
                </Pressable>
              ) : null}
            </View>

            {/* == Description Section == */}
            <SectionHeader
              label={t("issues.sectionDescription")}
              color={theme.colors.text}
            />
            {issueBody?.trim() ? (
              <ScrollView
                style={[
                  styles.bodyScroll,
                  { borderColor: theme.colors.divider },
                ]}
                nestedScrollEnabled
              >
                <Text
                  style={[
                    styles.bodyText,
                    {
                      color: theme.colors.textSecondary,
                    },
                  ]}
                >
                  {issueBody.trim()}
                </Text>
              </ScrollView>
            ) : (
              <Text
                style={[
                  styles.noDescText,
                  { color: theme.colors.textSecondary },
                ]}
              >
                {t("issues.noDescriptionProvided")}
              </Text>
            )}

            {/* == Worktree Section == */}
            {worktree ? (
              <>
                <SectionHeader
                  label={t("issues.sectionWorktree")}
                  color={theme.colors.text}
                />
                <View style={styles.metadataSection}>
                  <MetadataKV
                    label={t("issues.metaBranch")}
                    value={worktree.branchName}
                    color={theme.colors.textSecondary}
                    labelColor={theme.colors.text}
                    mono
                  />
                  <MetadataKV
                    label={t("issues.metaParentBranch")}
                    value={worktree.parentBranch}
                    color={theme.colors.textSecondary}
                    labelColor={theme.colors.text}
                    mono
                  />
                </View>
              </>
            ) : null}

            {/* == Task Instructions Section == */}
            <SectionHeader
              label={t("issues.sectionTask")}
              color={theme.colors.text}
            />
            <View style={styles.taskSection}>
              {buildTaskSteps(issueLink.issueNumber, worktree).map(
                (step, i) => (
                  <Text
                    key={i}
                    style={[
                      styles.taskStepText,
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    {step}
                  </Text>
                ),
              )}
            </View>

            {/* == PR link row == */}
            {effectivePrUrl ? (
              <Pressable
                style={styles.prLink}
                onPress={() => Linking.openURL(effectivePrUrl)}
                hitSlop={8}
              >
                <Ionicons
                  name="git-pull-request-outline"
                  size={13}
                  color={theme.colors.textLink}
                />
                <Text
                  style={[styles.prLinkText, { color: theme.colors.textLink }]}
                  numberOfLines={1}
                >
                  {effectivePrUrl}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        )}
      </View>
    );
  },
);

/**
 * Section header with a line separator feel.
 */
const SectionHeader = React.memo<{
  readonly label: string;
  readonly color: string;
}>(function SectionHeader({ label, color }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionHeaderText, { color }]}>{label}</Text>
    </View>
  );
});

/**
 * A key-value metadata row: "Label: value"
 */
const MetadataKV = React.memo<{
  readonly label: string;
  readonly value: string;
  readonly color: string;
  readonly labelColor: string;
  readonly numberOfLines?: number;
  readonly mono?: boolean;
}>(function MetadataKV({
  label,
  value,
  color,
  labelColor,
  numberOfLines,
  mono,
}) {
  return (
    <View style={styles.metadataRow}>
      <Text style={[styles.metadataLabel, { color: labelColor }]}>
        {label}:
      </Text>
      <Text
        style={[
          mono ? styles.metadataValueMono : styles.metadataValue,
          { color },
        ]}
        numberOfLines={numberOfLines}
      >
        {value}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
    gap: 8,
    maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
    alignSelf: "center",
    width: "100%",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    flexShrink: 0,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    ...Typography.default("semiBold"),
  },
  issueNumber: {
    fontSize: 14,
    flexShrink: 0,
    ...Typography.mono(),
  },
  issueTitle: {
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
    ...Typography.default("semiBold"),
  },
  expandedContent: {
    maxHeight: 400,
  },
  expandedContentInner: {
    gap: 6,
    paddingLeft: 4,
    paddingBottom: 4,
  },
  sectionHeader: {
    marginTop: 4,
    paddingBottom: 2,
  },
  sectionHeaderText: {
    fontSize: 13,
    ...Typography.default("semiBold"),
  },
  metadataSection: {
    gap: 3,
    paddingLeft: 8,
  },
  metadataRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
  },
  metadataLabel: {
    fontSize: 12,
    flexShrink: 0,
    ...Typography.default("semiBold"),
  },
  metadataValue: {
    fontSize: 12,
    flex: 1,
    ...Typography.default(),
  },
  metadataValueMono: {
    fontSize: 12,
    flex: 1,
    ...Typography.mono(),
  },
  bodyScroll: {
    maxHeight: MAX_BODY_HEIGHT,
    borderWidth: Platform.select({ ios: 0.33, default: 1 }),
    borderRadius: 8,
    padding: 10,
    marginLeft: 8,
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 18,
    ...Typography.default(),
  },
  noDescText: {
    fontSize: 12,
    paddingLeft: 8,
    fontStyle: "italic",
    ...Typography.default(),
  },
  taskSection: {
    gap: 4,
    paddingLeft: 8,
  },
  taskStepText: {
    fontSize: 12,
    lineHeight: 17,
    ...Typography.mono(),
  },
  prLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 8,
    marginTop: 2,
  },
  prLinkText: {
    fontSize: 12,
    flex: 1,
    ...Typography.default("semiBold"),
  },
}));
