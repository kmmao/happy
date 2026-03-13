/**
 * Fixed Issue Summary Header displayed at the top of issue-linked sessions.
 *
 * Shows issue number, title, processing status, and optional PR link.
 * Supports collapse/expand (default: collapsed).
 * When expanded, body content is scrollable within a max height.
 */

import * as React from "react";
import { View, Pressable, Linking, Platform, ScrollView } from "react-native";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  ISSUE_STATUS_COLORS,
  ISSUE_STATUS_LABELS,
} from "@/constants/issueStatusColors";
import type { IssueSessionLink } from "@/sync/issueSessionTypes";

const MAX_BODY_HEIGHT = 200;

interface IssueSummaryHeaderProps {
  readonly issueLink: IssueSessionLink;
  readonly issueBody?: string | null;
  readonly prUrl?: string | null;
}

export const IssueSummaryHeader = React.memo<IssueSummaryHeaderProps>(
  function IssueSummaryHeader({ issueLink, issueBody, prUrl }) {
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

        {/* Expanded content: body preview + PR link */}
        {expanded && (
          <View style={styles.expandedContent}>
            {issueBody ? (
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
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  {issueBody}
                </Text>
              </ScrollView>
            ) : null}

            {/* Repo label + PR link row */}
            <View style={styles.metaRow}>
              <Ionicons
                name="git-branch-outline"
                size={12}
                color={theme.colors.textSecondary}
              />
              <Text
                style={[
                  styles.repoLabel,
                  { color: theme.colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {issueLink.repoLabel}
              </Text>

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
                    style={[
                      styles.prLinkText,
                      { color: theme.colors.textLink },
                    ]}
                  >
                    PR
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
    gap: 8,
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
    gap: 8,
    paddingLeft: 4,
  },
  bodyScroll: {
    maxHeight: MAX_BODY_HEIGHT,
    borderWidth: Platform.select({ ios: 0.33, default: 1 }),
    borderRadius: 8,
    padding: 10,
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 18,
    ...Typography.default(),
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  repoLabel: {
    fontSize: 12,
    flex: 1,
    ...Typography.mono(),
  },
  prLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  prLinkText: {
    fontSize: 12,
    ...Typography.default("semiBold"),
  },
}));
