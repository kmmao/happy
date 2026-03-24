/**
 * Caddy HTTPS reverse proxy section — multi-domain support.
 * Reads from daemonState.tunnels, grouped by hostname.
 * Operations via tunnel RPC (not machineBash).
 */

import React, { useCallback, useMemo, useState } from "react";
import {
    Linking,
    Pressable,
    Text,
    TextInput,
    View,
} from "react-native";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { RoundButton } from "@/components/RoundButton";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Modal } from "@/modal";
import { t } from "@/text";
import { isMachineOnline } from "@/utils/machineUtils";
import { machineTunnelAdd, machineTunnelRemove } from "@/sync/ops";
import type { Machine } from "@/sync/storageTypes";

type CaddyRoute = {
    localPort: number;
    remotePort: number;
    path: string;
    target: string;
    publicUrl: string;
    hostname: string;
};

type Props = {
    machineId: string;
    machine: Machine;
};

export const CaddyTunnelSection = React.memo(function CaddyTunnelSection({
    machineId,
    machine,
}: Props) {
    const { theme } = useUnistyles();
    const online = isMachineOnline(machine);

    const caddyProvider = useMemo(() => {
        const providers = (machine.daemonState as any)?.tunnels?.providers;
        if (!Array.isArray(providers)) return null;
        return providers.find((p: any) => p.provider === "caddy") ?? null;
    }, [machine.daemonState]);

    if (!caddyProvider || caddyProvider.status !== "available") return null;

    const domains = (caddyProvider.metadata?.domains ?? "").split(",").filter(Boolean);
    const routes: CaddyRoute[] = (caddyProvider.entries ?? []).map((e: any) => ({
        localPort: e.localPort ?? 0,
        remotePort: e.remotePort ?? 443,
        path: e.path ?? "/",
        target: e.target ?? "",
        publicUrl: e.publicUrl ?? "",
        hostname: e.hostname ?? "",
    }));

    // Group routes by hostname
    const grouped = useMemo(() => {
        const map = new Map<string, CaddyRoute[]>();
        for (const r of routes) {
            const list = map.get(r.hostname) ?? [];
            list.push(r);
            map.set(r.hostname, list);
        }
        return map;
    }, [routes]);

    return (
        <>
            {[...grouped.entries()].map(([hostname, hostRoutes]) => (
                <CaddyDomainGroup
                    key={hostname}
                    machineId={machineId}
                    hostname={hostname}
                    routes={hostRoutes}
                    online={online}
                    theme={theme}
                    allDomains={domains}
                />
            ))}
            {online && (
                <ItemGroup>
                    <Item
                        title={t("machine.caddyAddSite")}
                        titleStyle={{ color: theme.colors.textLink }}
                        icon={<Ionicons name="globe-outline" size={20} color={theme.colors.textLink} />}
                        onPress={() => {
                            Modal.show({
                                component: AddCaddySiteForm,
                                props: {
                                    existingDomains: domains,
                                    onSubmit: async (domain: string, localPort: number) => {
                                        const result = await machineTunnelAdd(machineId, "caddy", {
                                            hostname: domain,
                                            localPort,
                                            path: "/",
                                        });
                                        if (!result.success && result.error) {
                                            Modal.alert(t("machine.caddyError"), result.error);
                                        }
                                    },
                                },
                            });
                        }}
                        showChevron={false}
                    />
                </ItemGroup>
            )}
        </>
    );
});

// ---------------------------------------------------------------------------
// Per-domain group
// ---------------------------------------------------------------------------

const CaddyDomainGroup = React.memo(function CaddyDomainGroup({
    machineId,
    hostname,
    routes,
    online,
    theme,
    allDomains,
}: {
    machineId: string;
    hostname: string;
    routes: CaddyRoute[];
    online: boolean;
    theme: any;
    allDomains: string[];
}) {
    const httpsPort = routes[0]?.remotePort ?? 2443;
    const baseUrl = `https://${hostname}${httpsPort === 443 ? "" : `:${httpsPort}`}`;

    const handleRemoveRoute = useCallback(async (route: CaddyRoute) => {
        if (!online || route.path === "/") return;
        const confirmed = await Modal.confirm(
            t("machine.caddyRemove"),
            t("machine.caddyRemoveConfirm", { path: route.path }),
        );
        if (confirmed) {
            const result = await machineTunnelRemove(machineId, "caddy", {
                hostname,
                path: route.path,
            });
            if (!result.success && result.error) {
                Modal.alert(t("machine.caddyError"), result.error);
            }
        }
    }, [machineId, hostname, online]);

    const handleRemoveSite = useCallback(async () => {
        if (!online) return;
        const confirmed = await Modal.confirm(
            t("machine.caddyRemoveSite"),
            t("machine.caddyRemoveSiteConfirm", { domain: hostname }),
        );
        if (confirmed) {
            const result = await machineTunnelRemove(machineId, "caddy", {
                hostname,
                removeEntireSite: true,
            });
            if (!result.success && result.error) {
                Modal.alert(t("machine.caddyError"), result.error);
            }
        }
    }, [machineId, hostname, online]);

    const handleAddRoute = useCallback(() => {
        if (!online) return;
        Modal.show({
            component: AddCaddyRouteForm,
            props: {
                domain: hostname,
                existingPaths: routes.map((r) => r.path),
                onSubmit: async (localPort: number, path: string) => {
                    const result = await machineTunnelAdd(machineId, "caddy", {
                        hostname,
                        localPort,
                        path,
                    });
                    if (!result.success && result.error) {
                        Modal.alert(t("machine.caddyError"), result.error);
                    }
                },
            },
        });
    }, [machineId, hostname, online, routes]);

    return (
        <ItemGroup
            title={`🔒 ${hostname}`}
            footer={baseUrl}
        >
            {routes.map((route) => {
                const pathLabel = route.path === "/" ? "/" : route.path;
                const url = route.publicUrl;
                return (
                    <Item
                        key={route.path}
                        title={pathLabel}
                        subtitle={`→ localhost:${route.localPort}\n${url}`}
                        subtitleLines={0}
                        subtitleStyle={{
                            fontFamily: "Menlo",
                            fontSize: 12,
                            color: theme.colors.textLink,
                        }}
                        rightElement={
                            <View style={{ flexDirection: "row", alignItems: "center" }}>
                                <Ionicons name="lock-closed" size={12} color={theme.colors.success} style={{ marginRight: 4 }} />
                                <Text style={{ fontSize: 14, color: theme.colors.success }}>HTTPS</Text>
                            </View>
                        }
                        onPress={() => Linking.openURL(url)}
                        onLongPress={online && route.path !== "/" ? () => handleRemoveRoute(route) : undefined}
                        showChevron={false}
                    />
                );
            })}
            {online && (
                <Item
                    title={t("machine.caddyAdd")}
                    titleStyle={{ color: theme.colors.textLink }}
                    icon={<Ionicons name="add-circle-outline" size={20} color={theme.colors.textLink} />}
                    onPress={handleAddRoute}
                    showChevron={false}
                />
            )}
            {online && (
                <Item
                    title={t("machine.caddyRemoveSite")}
                    titleStyle={{ color: theme.colors.textSecondary, fontSize: 13 }}
                    onPress={handleRemoveSite}
                    showChevron={false}
                    destructive
                />
            )}
        </ItemGroup>
    );
});

// ---------------------------------------------------------------------------
// AddCaddyRouteForm
// ---------------------------------------------------------------------------

function AddCaddyRouteForm({ onClose, onSubmit, domain, existingPaths }: {
    onClose: () => void;
    onSubmit: (localPort: number, path: string) => void;
    domain: string;
    existingPaths: string[];
}) {
    const { theme } = useUnistyles();
    const [localPortText, setLocalPortText] = useState("");
    const [path, setPath] = useState("/");

    const localPort = parseInt(localPortText, 10);
    const isPortValid = Number.isInteger(localPort) && localPort >= 1 && localPort <= 65535;
    const isPathValid = path.trim().startsWith("/");
    const isPathDuplicate = existingPaths.includes(path.trim());
    const isValid = isPortValid && isPathValid && !isPathDuplicate;

    return (
        <View style={[formStyles.card, { backgroundColor: theme.colors.surface, shadowColor: theme.colors.shadow.color }]}>
            <Text style={[formStyles.title, { color: theme.colors.text }]}>{t("machine.caddyAddTitle")}</Text>
            <Text style={[formStyles.domainBadge, { color: theme.colors.textSecondary }]}>{domain}</Text>

            <Text style={[formStyles.label, { color: theme.colors.text }]}>{t("machine.caddyLocalPort")}</Text>
            <TextInput
                style={[formStyles.input, { borderColor: theme.colors.divider, color: theme.colors.text, backgroundColor: theme.colors.surfaceHigh }]}
                value={localPortText}
                onChangeText={setLocalPortText}
                placeholder="3000"
                placeholderTextColor={theme.colors.textSecondary}
                keyboardType="number-pad"
                autoFocus
            />

            <Text style={[formStyles.label, { color: theme.colors.text }]}>{t("machine.caddyPath")}</Text>
            <TextInput
                style={[formStyles.input, { borderColor: isPathDuplicate ? theme.colors.accentOrange : theme.colors.divider, color: theme.colors.text, backgroundColor: theme.colors.surfaceHigh }]}
                value={path}
                onChangeText={setPath}
                placeholder="/api"
                placeholderTextColor={theme.colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
            />
            {isPathDuplicate && (
                <Text style={{ fontSize: 12, color: theme.colors.accentOrange, marginTop: 4 }}>{t("machine.caddyPathDuplicate")}</Text>
            )}

            {isPortValid && (
                <View style={[formStyles.previewBox, { backgroundColor: theme.colors.surfaceHigh }]}>
                    <Text style={[formStyles.previewText, { color: theme.colors.textSecondary }]}>
                        {`https://${domain}${path.trim() === "/" ? "" : path.trim()} → localhost:${localPort}`}
                    </Text>
                </View>
            )}

            <View style={formStyles.actions}>
                <RoundButton title={t("common.cancel")} onPress={onClose} size="normal" />
                <View style={{ width: 12 }} />
                <RoundButton title={t("machine.caddyAdd")} onPress={() => { if (isValid) { onSubmit(localPort, path.trim()); onClose(); } }} size="normal" disabled={!isValid} display="inverted" />
            </View>
        </View>
    );
}

// ---------------------------------------------------------------------------
// AddCaddySiteForm — create new domain
// ---------------------------------------------------------------------------

function AddCaddySiteForm({ onClose, onSubmit, existingDomains }: {
    onClose: () => void;
    onSubmit: (domain: string, localPort: number) => void;
    existingDomains: string[];
}) {
    const { theme } = useUnistyles();
    const [domain, setDomain] = useState("");
    const [localPortText, setLocalPortText] = useState("");

    const localPort = parseInt(localPortText, 10);
    const isPortValid = Number.isInteger(localPort) && localPort >= 1 && localPort <= 65535;
    const isDomainValid = domain.trim().length > 0 && domain.includes(".");
    const isDomainDuplicate = existingDomains.includes(domain.trim());
    const isValid = isPortValid && isDomainValid && !isDomainDuplicate;

    return (
        <View style={[formStyles.card, { backgroundColor: theme.colors.surface, shadowColor: theme.colors.shadow.color }]}>
            <Text style={[formStyles.title, { color: theme.colors.text }]}>{t("machine.caddyAddSiteTitle")}</Text>

            <Text style={[formStyles.label, { color: theme.colors.text }]}>{t("machine.caddyDomain")}</Text>
            <TextInput
                style={[formStyles.input, { borderColor: isDomainDuplicate ? theme.colors.accentOrange : theme.colors.divider, color: theme.colors.text, backgroundColor: theme.colors.surfaceHigh }]}
                value={domain}
                onChangeText={setDomain}
                placeholder="api.xycloud.info"
                placeholderTextColor={theme.colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
            />
            {isDomainDuplicate && (
                <Text style={{ fontSize: 12, color: theme.colors.accentOrange, marginTop: 4 }}>{t("machine.caddyDomainExists")}</Text>
            )}

            <Text style={[formStyles.label, { color: theme.colors.text }]}>{t("machine.caddyLocalPort")}</Text>
            <TextInput
                style={[formStyles.input, { borderColor: theme.colors.divider, color: theme.colors.text, backgroundColor: theme.colors.surfaceHigh }]}
                value={localPortText}
                onChangeText={setLocalPortText}
                placeholder="3000"
                placeholderTextColor={theme.colors.textSecondary}
                keyboardType="number-pad"
            />

            <Text style={[formStyles.hint, { color: theme.colors.textSecondary }]}>
                {t("machine.caddyDnsHint")}
            </Text>

            {isValid && (
                <View style={[formStyles.previewBox, { backgroundColor: theme.colors.surfaceHigh }]}>
                    <Text style={[formStyles.previewText, { color: theme.colors.textSecondary }]}>
                        {`https://${domain.trim()} → localhost:${localPort}`}
                    </Text>
                </View>
            )}

            <View style={formStyles.actions}>
                <RoundButton title={t("common.cancel")} onPress={onClose} size="normal" />
                <View style={{ width: 12 }} />
                <RoundButton title={t("machine.caddyAddSite")} onPress={() => { if (isValid) { onSubmit(domain.trim(), localPort); onClose(); } }} size="normal" disabled={!isValid} display="inverted" />
            </View>
        </View>
    );
}

const formStyles = StyleSheet.create({
    card: { borderRadius: 14, padding: 20, width: 320, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },
    title: { fontSize: 17, fontWeight: "600", textAlign: "center", marginBottom: 4 },
    domainBadge: { fontSize: 13, textAlign: "center", marginBottom: 12, fontFamily: "Menlo" },
    label: { fontSize: 13, fontWeight: "500", marginTop: 14, marginBottom: 6 },
    hint: { fontSize: 11, marginTop: 8 },
    input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
    previewBox: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 14, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
    previewText: { fontSize: 12, fontFamily: "Menlo" },
    actions: { flexDirection: "row", justifyContent: "center", marginTop: 18 },
});
