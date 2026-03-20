import * as React from "react";
import {
    View,
    ScrollView,
    Pressable,
    ActivityIndicator,
    Platform,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons, Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal } from "@/modal";
import { checkoutBranch, type GitBranch } from "@/sync/gitBranches";
import { gitStatusSync } from "@/sync/gitStatusSync";

interface BranchPickerModalProps {
    readonly sessionId: string;
    readonly localBranches: readonly GitBranch[];
    readonly remoteBranches: readonly GitBranch[];
    readonly currentBranch: string | null;
    readonly onClose: () => void;
}

const BranchRow = React.memo(function BranchRow({
    branch,
    isCurrent,
    isOperating,
    disabled,
    isRemote,
    onPress,
}: {
    readonly branch: GitBranch;
    readonly isCurrent: boolean;
    readonly isOperating: boolean;
    readonly disabled: boolean;
    readonly isRemote: boolean;
    readonly onPress: () => void;
}) {
    const { theme } = useUnistyles();

    return (
        <Pressable
            onPress={isCurrent ? undefined : onPress}
            disabled={isCurrent || disabled}
            style={(p) => ({
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 12,
                gap: 10,
                backgroundColor: p.pressed
                    ? theme.colors.surfaceHigh
                    : "transparent",
                opacity: isCurrent || (disabled && !isOperating) ? 0.5 : 1,
            })}
        >
            {isCurrent ? (
                <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={theme.colors.success}
                />
            ) : isRemote ? (
                <Octicons
                    name="globe"
                    size={18}
                    color={theme.colors.textSecondary}
                />
            ) : (
                <Octicons
                    name="git-branch"
                    size={18}
                    color={theme.colors.textSecondary}
                />
            )}
            <Text
                style={{
                    flex: 1,
                    fontSize: 15,
                    color: isCurrent
                        ? theme.colors.success
                        : theme.colors.text,
                    ...Typography.mono(),
                }}
                numberOfLines={1}
            >
                {branch.name}
            </Text>
            {branch.shortHash && !isOperating && (
                <Text
                    style={{
                        fontSize: 12,
                        color: theme.colors.textSecondary,
                        ...Typography.mono(),
                    }}
                >
                    {branch.shortHash}
                </Text>
            )}
            {isOperating && (
                <ActivityIndicator
                    size="small"
                    color={theme.colors.textLink}
                />
            )}
            {isCurrent && (
                <View
                    style={{
                        backgroundColor: theme.colors.success + "20",
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 4,
                    }}
                >
                    <Text
                        style={{
                            fontSize: 11,
                            fontWeight: "600",
                            color: theme.colors.success,
                            ...Typography.default(),
                        }}
                    >
                        {t("git.currentBranch")}
                    </Text>
                </View>
            )}
        </Pressable>
    );
});

export const BranchPickerModal = React.memo(function BranchPickerModal({
    sessionId,
    localBranches,
    remoteBranches,
    currentBranch,
    onClose,
}: BranchPickerModalProps) {
    const { theme } = useUnistyles();
    const [operatingBranch, setOperatingBranch] = React.useState<string | null>(
        null,
    );
    const [remoteCollapsed, setRemoteCollapsed] = React.useState(true);

    const sortedLocal = React.useMemo(() => {
        const current: GitBranch[] = [];
        const others: GitBranch[] = [];
        for (const b of localBranches) {
            if (b.name === currentBranch) {
                current.push(b);
            } else {
                others.push(b);
            }
        }
        return [...current, ...others];
    }, [localBranches, currentBranch]);

    const handleSelect = React.useCallback(
        async (branch: GitBranch) => {
            if (operatingBranch !== null) return;

            setOperatingBranch(branch.name);
            try {
                const result = await checkoutBranch(
                    sessionId,
                    branch.name,
                    branch.type,
                );
                if (!result.success) {
                    const errorMessage =
                        result.error === "dirty_working_tree"
                            ? t("git.dirtyWorkingTree")
                            : t("git.branchSwitchFailed");
                    Modal.alert(t("common.error"), errorMessage);
                    return;
                }
                onClose();
                Modal.toast(
                    t("git.switchBranchSuccess", { name: branch.name }),
                );
                await gitStatusSync.invalidateAndAwait(sessionId);
            } catch {
                Modal.alert(
                    t("common.error"),
                    t("git.branchSwitchFailed"),
                );
            } finally {
                setOperatingBranch(null);
            }
        },
        [sessionId, operatingBranch, onClose],
    );

    const isDisabled = operatingBranch !== null;

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: theme.colors.surface },
            ]}
        >
            {/* Header */}
            <View
                style={[
                    styles.header,
                    { borderBottomColor: theme.colors.divider },
                ]}
            >
                <View style={styles.headerLeft}>
                    <Octicons
                        name="git-branch"
                        size={18}
                        color={theme.colors.text}
                    />
                    <Text
                        style={{
                            fontSize: 16,
                            fontWeight: "600",
                            color: theme.colors.text,
                            ...Typography.default(),
                        }}
                    >
                        {t("projects.switchBranch")}
                    </Text>
                </View>
                <Pressable
                    onPress={onClose}
                    hitSlop={8}
                    disabled={isDisabled}
                >
                    <Ionicons
                        name="close"
                        size={22}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>
            </View>

            <ScrollView style={styles.list}>
                {/* Local branches */}
                {sortedLocal.length > 0 && (
                    <>
                        <View
                            style={[
                                styles.sectionHeader,
                                {
                                    backgroundColor: theme.colors.surfaceHigh,
                                    borderBottomColor: theme.colors.divider,
                                },
                            ]}
                        >
                            <Text
                                style={{
                                    fontSize: 13,
                                    fontWeight: "600",
                                    color: theme.colors.text,
                                    ...Typography.default(),
                                }}
                            >
                                {`${t("git.localBranches")} (${sortedLocal.length})`}
                            </Text>
                        </View>
                        {sortedLocal.map((branch) => (
                            <BranchRow
                                key={`local-${branch.name}`}
                                branch={branch}
                                isCurrent={branch.name === currentBranch}
                                isOperating={operatingBranch === branch.name}
                                disabled={isDisabled}
                                isRemote={false}
                                onPress={() => handleSelect(branch)}
                            />
                        ))}
                    </>
                )}

                {/* Remote branches (collapsible) */}
                {remoteBranches.length > 0 && (
                    <>
                        <Pressable
                            onPress={() => setRemoteCollapsed((v) => !v)}
                            style={[
                                styles.sectionHeader,
                                {
                                    backgroundColor: theme.colors.surfaceHigh,
                                    borderBottomColor: theme.colors.divider,
                                },
                            ]}
                        >
                            <Text
                                style={{
                                    fontSize: 13,
                                    fontWeight: "600",
                                    color: theme.colors.text,
                                    ...Typography.default(),
                                }}
                            >
                                {`${t("git.remoteBranches")} (${remoteBranches.length})`}
                            </Text>
                            <Ionicons
                                name={
                                    remoteCollapsed
                                        ? "chevron-forward"
                                        : "chevron-down"
                                }
                                size={16}
                                color={theme.colors.textSecondary}
                            />
                        </Pressable>
                        {!remoteCollapsed &&
                            remoteBranches.map((branch) => (
                                <BranchRow
                                    key={`remote-${branch.name}`}
                                    branch={branch}
                                    isCurrent={false}
                                    isOperating={
                                        operatingBranch === branch.name
                                    }
                                    disabled={isDisabled}
                                    isRemote={true}
                                    onPress={() => handleSelect(branch)}
                                />
                            ))}
                    </>
                )}
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        width: 340,
        maxHeight: 480,
        borderRadius: 14,
        overflow: "hidden",
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    list: {
        flexGrow: 0,
    },
    sectionHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
    },
}));
