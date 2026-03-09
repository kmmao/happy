import React, { useState, useCallback } from "react";
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
import { machineListGitRepos } from "@/sync/ops";
import type { GitRepoEntry } from "@/sync/ops";

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
    const [scanning, setScanning] = useState(false);
    const [scanResults, setScanResults] = useState<readonly GitRepoEntry[]>([]);
    const [showResults, setShowResults] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const handleScan = useCallback(async () => {
        if (!machineId || scanning) return;
        setScanning(true);
        setScanError(null);
        setScanResults([]);
        setSearchQuery("");
        setShowResults(true);
        try {
            const repos = await machineListGitRepos(machineId);
            setScanResults(repos);
            if (repos.length === 0) {
                setScanError(t("gitHosts.scanEmpty"));
            }
        } catch {
            setScanError(t("gitHosts.scanError"));
        } finally {
            setScanning(false);
        }
    }, [machineId, scanning]);

    const handleSelect = useCallback(
        (entry: GitRepoEntry) => {
            onSelectRepo(entry);
            setShowResults(false);
        },
        [onSelectRepo],
    );

    const filteredResults = showResults
        ? scanResults.filter((entry) => {
              if (!searchQuery) return true;
              const q = searchQuery.toLowerCase();
              return (
                  entry.name.toLowerCase().includes(q) ||
                  entry.repoPath.toLowerCase().includes(q) ||
                  entry.remoteUrl.toLowerCase().includes(q)
              );
          })
        : [];

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
                    {scanning
                        ? t("gitHosts.scanning")
                        : t("gitHosts.scanRepos")}
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
                                        borderBottomColor:
                                            theme.colors.border,
                                        ...Typography.default(),
                                    }}
                                    value={searchQuery}
                                    onChangeText={setSearchQuery}
                                    placeholder={t(
                                        "gitHosts.scanSearchPlaceholder",
                                    )}
                                    placeholderTextColor={
                                        theme.colors.textSecondary
                                    }
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            )}
                            <ScrollView
                                style={{ maxHeight: 240 }}
                                nestedScrollEnabled
                            >
                                {filteredResults.map((entry) => (
                                    <Pressable
                                        key={entry.repoPath}
                                        style={{
                                            paddingHorizontal: 12,
                                            paddingVertical: 10,
                                            borderBottomWidth: 0.5,
                                            borderBottomColor:
                                                theme.colors.border,
                                        }}
                                        onPress={() => handleSelect(entry)}
                                    >
                                        <Text
                                            style={{
                                                fontSize: 14,
                                                color: theme.colors.text,
                                                ...Typography.default(
                                                    "semiBold",
                                                ),
                                            }}
                                            numberOfLines={1}
                                        >
                                            {entry.name}
                                        </Text>
                                        <Text
                                            style={{
                                                fontSize: 11,
                                                color: theme.colors
                                                    .textSecondary,
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
