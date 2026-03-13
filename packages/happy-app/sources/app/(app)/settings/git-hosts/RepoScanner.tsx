import React, { useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useGitRepoScanner } from "@/hooks/useGitRepoScanner";
import type { GitRepoEntry } from "@/hooks/useGitRepoScanner";

interface Props {
  readonly machineId: string;
  readonly theme: any;
  readonly onSelectRepo: (entry: GitRepoEntry) => void;
}

export const RepoScanner = React.memo(function RepoScanner({
  machineId,
  theme,
  onSelectRepo,
}: Props) {
  const {
    scanning,
    scanError,
    scanResults,
    showResults,
    searchQuery,
    setSearchQuery,
    filteredResults,
    handleScan,
  } = useGitRepoScanner(machineId);

  const handleSelect = useCallback(
    (entry: GitRepoEntry) => {
      onSelectRepo(entry);
    },
    [onSelectRepo],
  );

  return (
    <>
      {/* Scan button */}
      <Pressable
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 8,
          borderRadius: 8,
          backgroundColor: theme.colors.input.background,
          marginBottom: 10,
          opacity: scanning ? 0.6 : 1,
        }}
        onPress={handleScan}
        disabled={scanning}
      >
        {scanning ? (
          <ActivityIndicator
            size="small"
            color={theme.colors.textLink}
            style={{ marginRight: 6 }}
          />
        ) : (
          <Ionicons
            name="search-outline"
            size={16}
            color={theme.colors.textLink}
            style={{ marginRight: 6 }}
          />
        )}
        <Text
          style={{
            fontSize: 13,
            color: theme.colors.textLink,
            ...Typography.default("semiBold"),
          }}
        >
          {scanning ? t("gitHosts.scanning") : t("gitHosts.scanRepos")}
        </Text>
      </Pressable>

      {/* Scan results */}
      {showResults && (
        <View
          style={{
            backgroundColor: theme.colors.input.background,
            borderRadius: 8,
            marginBottom: 10,
            overflow: "hidden",
          }}
        >
          {scanError ? (
            <Text
              style={{
                padding: 12,
                fontSize: 13,
                color: theme.colors.textSecondary,
                textAlign: "center",
                ...Typography.default(),
              }}
            >
              {scanError}
            </Text>
          ) : (
            <>
              {scanResults.length > 0 && (
                <TextInput
                  style={{
                    padding: 10,
                    fontSize: 14,
                    color: theme.colors.text,
                    borderBottomWidth: 0.5,
                    borderBottomColor: theme.colors.border,
                    ...Typography.default(),
                  }}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={t("gitHosts.scanSearchPlaceholder")}
                  placeholderTextColor={theme.colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              )}
              <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                {filteredResults.map((entry) => (
                  <Pressable
                    key={entry.repoPath}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderBottomWidth: 0.5,
                      borderBottomColor: theme.colors.border,
                    }}
                    onPress={() => handleSelect(entry)}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        color: theme.colors.text,
                        ...Typography.default("semiBold"),
                      }}
                      numberOfLines={1}
                    >
                      {entry.name}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: theme.colors.textSecondary,
                        marginTop: 2,
                        ...Typography.mono(),
                      }}
                      numberOfLines={1}
                    >
                      {entry.repoPath}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      )}
    </>
  );
});
