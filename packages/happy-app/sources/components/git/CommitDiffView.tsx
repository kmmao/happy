/**
 * CommitDiffView — show one file's unified-diff at a specific commit, in a
 * self-contained block (no router, no full-screen). Used by SidePanelGitPanel
 * to render a commit-file diff inside the side panel (with a back button) and
 * by app/(app)/session/[id]/file.tsx as the in-page diff body.
 *
 * Styling is shared with the Changes-tab file preview via `UnifiedDiffView`:
 * stats header, collapsible hunks, side-by-side line numbers, and inline
 * syntax + diff-token highlighting.
 */

import * as React from "react";
import { View, ActivityIndicator, Platform, ScrollView } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";
import { FileIcon } from "@/components/FileIcon";
import { t } from "@/text";
import { sessionBash } from "@/sync/ops";
import { log } from "@/log";
import { UnifiedDiffView } from "@/components/diff/UnifiedDiffView";
import { getLanguageForPath } from "@/components/diff/fileLanguage";

interface CommitDiffViewProps {
  readonly sessionId: string;
  readonly sessionPath: string;
  readonly fullPath: string;
  readonly commitHash: string;
  /** Show a header bar with file icon + path. Defaults to true. */
  readonly showHeader?: boolean;
}

/**
 * Strip `cwd` prefix from an absolute path so the diff header shows the
 * repo-relative path that git itself uses.
 */
function toRepoRelative(fullPath: string, sessionPath: string): string {
  if (!sessionPath) return fullPath;
  const normalizedBase = sessionPath.replace(/\/$/, "");
  if (fullPath.startsWith(normalizedBase + "/")) {
    return fullPath.slice(normalizedBase.length + 1);
  }
  return fullPath;
}

export const CommitDiffView = React.memo<CommitDiffViewProps>(
  function CommitDiffView({
    sessionId,
    sessionPath,
    fullPath,
    commitHash,
    showHeader = true,
  }) {
    const { theme } = useUnistyles();
    const [patch, setPatch] = React.useState<string | null>(null);
    const [isBinary, setIsBinary] = React.useState(false);
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    const filePath = React.useMemo(
      () => toRepoRelative(fullPath, sessionPath),
      [fullPath, sessionPath],
    );
    const fileName = filePath.split("/").pop() || filePath;
    const language = React.useMemo(() => getLanguageForPath(filePath), [filePath]);

    React.useEffect(() => {
      let cancelled = false;
      setIsLoading(true);
      setError(null);
      setPatch(null);
      setIsBinary(false);

      (async () => {
        try {
          // Without a repo cwd, `git show` would run in the daemon's default
          // directory (wrong repo or not a repo at all). Bail with an error
          // instead of issuing a command that can't produce the right diff.
          if (!sessionPath) {
            setError("Failed to read file at commit");
            return;
          }
          // `--pretty=format:` strips the commit header so stdout is the raw
          // patch for the requested file. Trailing `--` guards the path.
          // Single-quote both args and escape embedded quotes so unusual
          // commit hashes / file names can't break or inject into the shell
          // (matches SidePanelFilePreview's escaping).
          const escapedCommit = commitHash.replace(/'/g, "'\\''");
          const escapedPath = filePath.replace(/'/g, "'\\''");
          const response = await sessionBash(sessionId, {
            command: `git show --no-color --pretty=format: '${escapedCommit}' -- '${escapedPath}'`,
            cwd: sessionPath,
            timeout: 10000,
          });
          if (cancelled) return;

          if (!response.success) {
            setError(response.stderr || "Failed to read file at commit");
            return;
          }
          const raw = (response.stdout ?? "").replace(/^\n+/, "");
          if (/^Binary files /m.test(raw)) {
            setIsBinary(true);
          } else {
            setPatch(raw);
          }
        } catch (e) {
          log.error("CommitDiffView: failed to load patch", e);
          if (!cancelled) setError("Failed to read file at commit");
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [sessionId, sessionPath, filePath, commitHash]);

    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
        {showHeader && (
          <View
            style={{
              padding: 12,
              borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
              borderBottomColor: theme.colors.divider,
              backgroundColor: theme.colors.surfaceHigh,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <FileIcon fileName={fileName} size={18} />
            <Text
              style={{
                fontSize: 13,
                color: theme.colors.textSecondary,
                marginLeft: 8,
                flex: 1,
                ...Typography.mono(),
              }}
              numberOfLines={1}
            >
              {filePath}
            </Text>
          </View>
        )}

        {isLoading ? (
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
          </View>
        ) : error ? (
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              padding: 20,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                color: theme.colors.textDestructive,
                textAlign: "center",
                ...Typography.default(),
              }}
            >
              {error}
            </Text>
          </View>
        ) : isBinary ? (
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              padding: 20,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                color: theme.colors.textSecondary,
                ...Typography.default(),
              }}
            >
              {t("files.cannotDisplayBinary")}
            </Text>
          </View>
        ) : patch && patch.length > 0 ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12 }}
            showsVerticalScrollIndicator
          >
            <UnifiedDiffView diffContent={patch} language={language} />
          </ScrollView>
        ) : (
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              padding: 20,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                color: theme.colors.textSecondary,
                fontStyle: "italic",
                ...Typography.default(),
              }}
            >
              {t("files.fileEmpty")}
            </Text>
          </View>
        )}
      </View>
    );
  },
);
