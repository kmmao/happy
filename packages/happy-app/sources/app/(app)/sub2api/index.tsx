import * as React from "react";
import { View, TextInput, Platform } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { RoundButton } from "@/components/RoundButton";
import { Ionicons } from "@expo/vector-icons";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { UsageBar } from "@/components/usage/UsageBar";
import { t } from "@/text";
import { useUnistyles } from "react-native-unistyles";
import { useHappyAction } from "@/hooks/useHappyAction";
import { useAuth } from "@/auth/AuthContext";
import {
    saveConfig,
    clearConfig,
    useSub2ApiUsage,
} from "@/sub2api";
import type { UsageProgress } from "@/sub2api";

function formatRemainingTime(seconds: number): string {
    if (seconds <= 0) return t("sub2api.expired");
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function getUtilizationColor(utilization: number): string {
    if (utilization >= 90) return "#FF3B30";
    if (utilization >= 70) return "#FF9500";
    return "#34C759";
}

function UsageProgressBar({ label, progress }: { label: string; progress: UsageProgress }) {
    const { theme } = useUnistyles();
    const color = getUtilizationColor(progress.utilization);
    const resetText = progress.remaining_seconds > 0
        ? t("sub2api.resetsIn", { time: formatRemainingTime(progress.remaining_seconds) })
        : "";

    return (
        <View style={{ marginBottom: 4 }}>
            <UsageBar
                label={label}
                value={progress.utilization}
                maxValue={100}
                color={color}
                showPercentage={false}
                formatValue={(v) => `${Math.round(v)}%`}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
                {resetText ? (
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                        {resetText}
                    </Text>
                ) : <View />}
                {progress.window_stats && (
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                        {progress.window_stats.requests} req · ${progress.window_stats.cost.toFixed(2)}
                    </Text>
                )}
            </View>
        </View>
    );
}

export default React.memo(function Sub2ApiScreen() {
    const { theme } = useUnistyles();
    const auth = useAuth();
    const { data, loading, error, configured, refresh } = useSub2ApiUsage();

    const [baseUrl, setBaseUrl] = React.useState("");
    const [email, setEmail] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [showConfig, setShowConfig] = React.useState(!configured);

    // Sync showConfig when configured state changes
    React.useEffect(() => {
        setShowConfig(!configured);
    }, [configured]);

    const [isSaving, doSave] = useHappyAction(
        React.useCallback(async () => {
            if (!auth.credentials) return;
            await saveConfig(auth.credentials, {
                baseUrl: baseUrl.trim(),
                email: email.trim(),
                password: password.trim(),
            });
            setShowConfig(false);
            refresh();
        }, [auth.credentials, baseUrl, email, password, refresh]),
    );

    const [isClearing, handleClear] = useHappyAction(
        React.useCallback(async () => {
            if (!auth.credentials) return;
            await clearConfig(auth.credentials);
            setBaseUrl("");
            setEmail("");
            setPassword("");
            setShowConfig(true);
            refresh();
        }, [auth.credentials, refresh]),
    );

    // Config form
    if (showConfig) {
        return (
            <ItemList>
                <ItemGroup>
                    <View style={{ alignItems: "center", paddingVertical: 24, paddingHorizontal: 16 }}>
                        <Ionicons
                            name="speedometer-outline"
                            size={48}
                            color={theme.colors.button.primary.background}
                            style={{ marginBottom: 16 }}
                        />
                        <Text style={{
                            ...Typography.default("semiBold"),
                            fontSize: 20,
                            textAlign: "center",
                            marginBottom: 12,
                            color: theme.colors.text,
                        }}>
                            {t("sub2api.title")}
                        </Text>
                        <Text style={{
                            ...Typography.default(),
                            fontSize: 14,
                            color: theme.colors.textSecondary,
                            textAlign: "center",
                            lineHeight: 20,
                        }}>
                            {t("sub2api.configDescription")}
                        </Text>
                    </View>
                </ItemGroup>

                <ItemGroup title={t("sub2api.connectionSettings")}>
                    <Item
                        title={t("sub2api.apiUrl")}
                        showChevron={false}
                        icon={<Ionicons name="server-outline" size={29} color={theme.colors.button.primary.background} />}
                    />
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                        <TextInput
                            value={baseUrl}
                            onChangeText={setBaseUrl}
                            placeholder={t("sub2api.apiUrlPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="url"
                            style={{
                                ...Typography.default(),
                                fontSize: 16,
                                color: theme.colors.text,
                                backgroundColor: theme.colors.input.background,
                                borderRadius: 8,
                                paddingHorizontal: 12,
                                paddingVertical: Platform.OS === "ios" ? 12 : 8,
                            }}
                        />
                    </View>

                    <Item
                        title={t("sub2api.email")}
                        showChevron={false}
                        icon={<Ionicons name="mail-outline" size={29} color={theme.colors.button.primary.background} />}
                    />
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                        <TextInput
                            value={email}
                            onChangeText={setEmail}
                            placeholder={t("sub2api.emailPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="email-address"
                            style={{
                                ...Typography.default(),
                                fontSize: 16,
                                color: theme.colors.text,
                                backgroundColor: theme.colors.input.background,
                                borderRadius: 8,
                                paddingHorizontal: 12,
                                paddingVertical: Platform.OS === "ios" ? 12 : 8,
                            }}
                        />
                    </View>

                    <Item
                        title={t("sub2api.password")}
                        showChevron={false}
                        icon={<Ionicons name="lock-closed-outline" size={29} color={theme.colors.button.primary.background} />}
                    />
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                        <TextInput
                            value={password}
                            onChangeText={setPassword}
                            placeholder={t("sub2api.passwordPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                            secureTextEntry
                            style={{
                                ...Typography.default(),
                                fontSize: 16,
                                color: theme.colors.text,
                                backgroundColor: theme.colors.input.background,
                                borderRadius: 8,
                                paddingHorizontal: 12,
                                paddingVertical: Platform.OS === "ios" ? 12 : 8,
                            }}
                        />
                    </View>
                </ItemGroup>

                <ItemGroup>
                    <View style={{ paddingHorizontal: 16, paddingVertical: 16, gap: 12 }}>
                        <RoundButton
                            title={isSaving ? t("sub2api.connecting") : t("sub2api.save")}
                            onPress={doSave}
                            size="large"
                            disabled={isSaving || !baseUrl.trim() || !email.trim() || !password.trim()}
                            loading={isSaving}
                        />
                        {configured && (
                            <RoundButton
                                title={t("common.cancel")}
                                onPress={() => setShowConfig(false)}
                                size="large"
                                display="inverted"
                            />
                        )}
                    </View>
                </ItemGroup>
            </ItemList>
        );
    }

    // Usage display
    return (
        <ItemList>
            {/* Account usage cards */}
            {data.map(({ account, usage }) => (
                <ItemGroup key={account.id} title={`${account.name} (${account.type})`}>
                    <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                        {usage.five_hour && (
                            <UsageProgressBar
                                label={t("sub2api.fiveHourLimit")}
                                progress={usage.five_hour}
                            />
                        )}
                        {usage.seven_day && (
                            <UsageProgressBar
                                label={t("sub2api.sevenDayLimit")}
                                progress={usage.seven_day}
                            />
                        )}
                        {usage.seven_day_sonnet && (
                            <UsageProgressBar
                                label={t("sub2api.sevenDaySonnetLimit")}
                                progress={usage.seven_day_sonnet}
                            />
                        )}
                        {!usage.five_hour && !usage.seven_day && !usage.seven_day_sonnet && (
                            <Text style={{ fontSize: 14, color: theme.colors.textSecondary, textAlign: "center", paddingVertical: 8 }}>
                                {t("sub2api.noUsageData")}
                            </Text>
                        )}
                    </View>
                </ItemGroup>
            ))}

            {/* Empty state */}
            {!loading && data.length === 0 && !error && (
                <ItemGroup>
                    <Item
                        title={t("sub2api.noAccounts")}
                        subtitle={t("sub2api.noAccountsHint")}
                        icon={<Ionicons name="information-circle-outline" size={29} color={theme.colors.textSecondary} />}
                        showChevron={false}
                    />
                </ItemGroup>
            )}

            {/* Error state */}
            {error && (
                <ItemGroup>
                    <Item
                        title={t("sub2api.fetchError")}
                        subtitle={error}
                        icon={<Ionicons name="warning-outline" size={29} color="#FF3B30" />}
                        showChevron={false}
                    />
                </ItemGroup>
            )}

            {/* Actions */}
            <ItemGroup>
                <View style={{ paddingHorizontal: 16, paddingVertical: 16, gap: 12 }}>
                    <RoundButton
                        title={loading ? t("sub2api.refreshing") : t("sub2api.refresh")}
                        onPress={refresh}
                        size="large"
                        loading={loading}
                    />
                    <RoundButton
                        title={t("sub2api.editConfig")}
                        onPress={() => setShowConfig(true)}
                        size="large"
                        display="inverted"
                    />
                    <RoundButton
                        title={t("sub2api.clearConfig")}
                        onPress={handleClear}
                        size="large"
                        display="inverted"
                        loading={isClearing}
                    />
                </View>
            </ItemGroup>
        </ItemList>
    );
});
