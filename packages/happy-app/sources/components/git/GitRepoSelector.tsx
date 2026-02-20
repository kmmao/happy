import * as React from "react";
import { View, Pressable, Platform, ScrollView } from "react-native";
import { Ionicons, Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import type { SubmoduleInfo } from "@/sync/projectManager";

interface GitRepoSelectorProps {
  readonly sessionPath: string;
  readonly submodules: readonly SubmoduleInfo[];
  readonly selectedRepoPath: string | null;
  readonly onSelect: (repoPath: string | null) => void;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}

export const GitRepoSelector = React.memo<GitRepoSelectorProps>(
  function GitRepoSelector({
    sessionPath,
    submodules,
    selectedRepoPath,
    onSelect,
    isExpanded,
    onToggle,
  }) {
    const { theme } = useUnistyles();

    const rootName = sessionPath.split("/").pop() || sessionPath;

    const selectedLabel =
      selectedRepoPath === null
        ? `${rootName} (${t("git.rootRepo")})`
        : selectedRepoPath;

    return (
      <View>
        {/* Collapsed: single row showing selected repo */}
        <Pressable
          onPress={onToggle}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderBottomWidth: Platform.select({
              ios: 0.33,
              default: 1,
            }),
            borderBottomColor: theme.colors.divider,
            backgroundColor: theme.colors.surfaceHigh,
          }}
        >
          <Octicons
            name="repo"
            size={16}
            color={theme.colors.textSecondary}
            style={{ marginRight: 8 }}
          />
          <Text
            style={{
              flex: 1,
              fontSize: 14,
              fontWeight: "500",
              color: theme.colors.text,
              ...Typography.default(),
            }}
            numberOfLines={1}
          >
            {selectedLabel}
          </Text>
          <Ionicons
            name={isExpanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={theme.colors.textSecondary}
          />
        </Pressable>

        {/* Expanded: full repo list in normal layout flow */}
        {isExpanded && (
          <ScrollView
            style={{
              maxHeight: 320,
              borderBottomWidth: Platform.select({
                ios: 0.33,
                default: 1,
              }),
              borderBottomColor: theme.colors.divider,
              backgroundColor: theme.colors.surface,
            }}
          >
            {/* Root repo */}
            <Pressable
              onPress={() => onSelect(null)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 10,
                backgroundColor: pressed
                  ? theme.colors.surfacePressedOverlay
                  : "transparent",
              })}
            >
              <View style={{ width: 24, alignItems: "center" }}>
                {selectedRepoPath === null && (
                  <Ionicons
                    name="checkmark"
                    size={16}
                    color={theme.colors.textLink}
                  />
                )}
              </View>
              <Octicons
                name="repo"
                size={14}
                color={theme.colors.textSecondary}
                style={{ marginRight: 8 }}
              />
              <Text
                style={{
                  fontSize: 14,
                  color: theme.colors.text,
                  ...Typography.default(),
                }}
              >
                {rootName} ({t("git.rootRepo")})
              </Text>
            </Pressable>

            {/* Submodules */}
            {submodules.map((sub) => {
              const gs = sub.gitStatus;
              const changeCount = gs
                ? gs.stagedCount + gs.modifiedCount + gs.untrackedCount
                : 0;

              return (
                <Pressable
                  key={sub.path}
                  onPress={() => onSelect(sub.path)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    backgroundColor: pressed
                      ? theme.colors.surfacePressedOverlay
                      : "transparent",
                  })}
                >
                  <View style={{ width: 24, alignItems: "center" }}>
                    {selectedRepoPath === sub.path && (
                      <Ionicons
                        name="checkmark"
                        size={16}
                        color={theme.colors.textLink}
                      />
                    )}
                  </View>
                  <Octicons
                    name={"repo-forked" as any}
                    size={14}
                    color={theme.colors.textSecondary}
                    style={{ marginRight: 8 }}
                  />
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text
                      style={{
                        fontSize: 14,
                        color: theme.colors.text,
                        ...Typography.default(),
                      }}
                      numberOfLines={1}
                    >
                      {sub.path}
                    </Text>
                    {gs && gs.branch && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          marginTop: 2,
                        }}
                      >
                        <Octicons
                          name="git-branch"
                          size={11}
                          color={theme.colors.textSecondary}
                          style={{ marginRight: 4 }}
                        />
                        <Text
                          style={{
                            fontSize: 11,
                            color: theme.colors.textSecondary,
                            ...Typography.default(),
                          }}
                          numberOfLines={1}
                        >
                          {gs.branch}
                        </Text>
                      </View>
                    )}
                  </View>
                  {gs && changeCount > 0 && (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {gs.stagedCount > 0 && (
                        <View
                          style={{
                            backgroundColor: theme.colors.success,
                            borderRadius: 8,
                            minWidth: 18,
                            height: 18,
                            paddingHorizontal: 4,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: "700",
                              color: "#FFFFFF",
                              ...Typography.default(),
                            }}
                          >
                            {gs.stagedCount}
                          </Text>
                        </View>
                      )}
                      {gs.modifiedCount + gs.untrackedCount > 0 && (
                        <View
                          style={{
                            backgroundColor: theme.colors.warning,
                            borderRadius: 8,
                            minWidth: 18,
                            height: 18,
                            paddingHorizontal: 4,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: "700",
                              color: "#FFFFFF",
                              ...Typography.default(),
                            }}
                          >
                            {gs.modifiedCount + gs.untrackedCount}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                  {gs && changeCount === 0 && (
                    <Octicons
                      name="check"
                      size={14}
                      color={theme.colors.success}
                    />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  },
);
