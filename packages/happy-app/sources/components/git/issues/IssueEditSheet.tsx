import * as React from "react";
import {
    View,
    Pressable,
    TextInput,
    ScrollView,
    ActivityIndicator,
} from "react-native";
import { Text } from "@/components/StyledText";
import { useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "@/text";
import { useHappyAction } from "@/hooks/useHappyAction";
import { issueStore } from "@/sync/issueStore";
import { fetchLabels } from "@/sync/issueFetch";
import type { IssueLabel } from "@/sync/issueTypes";
import { LabelPicker } from "./LabelPicker";
import { formSheetStyles as fs } from "@/components/formSheetStyles";

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
        const [titleFocused, setTitleFocused] = React.useState(false);
        const [bodyFocused, setBodyFocused] = React.useState(false);
        const [selectedLabels, setSelectedLabels] =
            React.useState<readonly string[]>(initialLabels);
        const [availableLabels, setAvailableLabels] = React.useState<
            readonly IssueLabel[]
        >([]);
        const [loadingLabels, setLoadingLabels] = React.useState(true);

        React.useEffect(() => {
            const repoInfo =
                issueStore.getState().repoInfoByProject[projectKey];
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
                prev.includes(name)
                    ? prev.filter((l) => l !== name)
                    : [...prev, name],
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

        const canSave = title.trim().length > 0 && !isSaving;

        return (
            <View
                style={[
                    fs.sheetContainer,
                    { paddingBottom: safeArea.bottom },
                ]}
            >
                <ScrollView
                    style={fs.sheetScroll}
                    contentContainerStyle={fs.sheetScrollContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {/* ── Header ── */}
                    <View style={fs.header}>
                        <Text style={fs.headerTitle}>
                            {t("issues.editIssue")}
                        </Text>
                        <Pressable onPress={onClose} hitSlop={12}>
                            <Ionicons
                                name="close"
                                size={16}
                                color={theme.colors.textSecondary}
                            />
                        </Pressable>
                    </View>

                    {/* ── Section 1: Title + Body ── */}
                    <View style={fs.sectionGroup}>
                        <View style={fs.fieldContainer}>
                            <View
                                style={[
                                    fs.accentBar,
                                    titleFocused && {
                                        backgroundColor:
                                            theme.colors.accentPurple,
                                    },
                                ]}
                            />
                            <View style={fs.fieldInner}>
                                <Text
                                    style={[
                                        fs.floatingLabel,
                                        titleFocused && {
                                            color: theme.colors.accentPurple,
                                        },
                                    ]}
                                >
                                    {t("issues.editTitlePlaceholder")}
                                </Text>
                                <TextInput
                                    style={fs.textInput}
                                    value={title}
                                    onChangeText={setTitle}
                                    placeholder={t(
                                        "issues.editTitlePlaceholder",
                                    )}
                                    placeholderTextColor={
                                        theme.colors.input.placeholder
                                    }
                                    autoFocus
                                    returnKeyType="next"
                                    onFocus={() => setTitleFocused(true)}
                                    onBlur={() => setTitleFocused(false)}
                                />
                            </View>
                        </View>

                        <View style={fs.insetDivider} />

                        <View style={fs.fieldContainer}>
                            <View
                                style={[
                                    fs.accentBar,
                                    bodyFocused && {
                                        backgroundColor:
                                            theme.colors.accentPurple,
                                    },
                                ]}
                            />
                            <View style={fs.fieldInner}>
                                <Text
                                    style={[
                                        fs.floatingLabel,
                                        bodyFocused && {
                                            color: theme.colors.accentPurple,
                                        },
                                    ]}
                                >
                                    {t("issues.newIssueBody")}
                                </Text>
                                <TextInput
                                    style={[
                                        fs.textInput,
                                        { minHeight: 100 },
                                    ]}
                                    value={body}
                                    onChangeText={setBody}
                                    placeholder={t(
                                        "issues.editBodyPlaceholder",
                                    )}
                                    placeholderTextColor={
                                        theme.colors.input.placeholder
                                    }
                                    multiline
                                    textAlignVertical="top"
                                    onFocus={() => setBodyFocused(true)}
                                    onBlur={() => setBodyFocused(false)}
                                />
                            </View>
                        </View>
                    </View>

                    {/* ── Section 2: Labels ── */}
                    <View style={fs.sectionGroup}>
                        <View style={fs.sectionPadded}>
                            <LabelPicker
                                availableLabels={availableLabels}
                                selectedLabels={selectedLabels}
                                loadingLabels={loadingLabels}
                                onToggleLabel={toggleLabel}
                            />
                        </View>
                    </View>
                </ScrollView>

                {/* ── Actions (pinned bottom) ── */}
                <View style={fs.sheetActionsBar}>
                    <Pressable
                        onPress={doSave}
                        disabled={!canSave}
                        style={[
                            fs.primaryButton,
                            !canSave && { opacity: 0.4 },
                        ]}
                    >
                        {isSaving ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <Text style={fs.primaryButtonText}>
                                {t("common.save")}
                            </Text>
                        )}
                    </Pressable>
                    <Pressable
                        style={fs.cancelLink}
                        onPress={onClose}
                        hitSlop={8}
                    >
                        <Text style={fs.cancelLinkText}>
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    },
);
