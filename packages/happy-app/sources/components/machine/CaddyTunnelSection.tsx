/**
 * Caddy HTTPS reverse proxy section for the machine detail page.
 * Shows active routes and allows add/remove via Caddy Admin API.
 */

import React, { useState, useCallback, useMemo } from "react";
import {
    Linking,
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
import { machineBash, type MachineBashResult } from "@/sync/ops";
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

    const domain = caddyProvider.metadata?.domain ?? "";
    const routes: CaddyRoute[] = (caddyProvider.entries ?? []).map((e: any) => ({
        localPort: e.localPort ?? 0,
        remotePort: e.remotePort ?? 443,
        path: e.path ?? "/",
        target: e.target ?? "",
        publicUrl: e.publicUrl ?? "",
        hostname: e.hostname ?? domain,
    }));

    return (
        <CaddySectionInner
            machineId={machineId}
            online={online}
            domain={domain}
            routes={routes}
            theme={theme}
        />
    );
});

const CaddySectionInner = React.memo(function CaddySectionInner({
    machineId,
    online,
    domain,
    routes,
    theme,
}: {
    machineId: string;
    online: boolean;
    domain: string;
    routes: CaddyRoute[];
    theme: any;
}) {
    const handleRemove = useCallback(async (route: CaddyRoute) => {
        if (!online) return;
        if (route.path === "/") {
            Modal.alert(t("machine.caddyError"), t("machine.caddyCannotRemoveDefault"));
            return;
        }
        const confirmed = await Modal.confirm(
            t("machine.caddyRemove"),
            t("machine.caddyRemoveConfirm", { path: route.path }),
        );
        if (!confirmed) return;

        // Call CLI tunnel remove via a daemon RPC-like bash command
        // For now, we use curl to Caddy admin API directly from the machine
        const cmd = `curl -sf http://127.0.0.1:2019/config/ | python3 -c "
import json,sys
data=json.load(sys.stdin)
routes=data['apps']['http']['servers']['srv0']['routes'][0]['handle'][0]['routes']
filtered=[r for r in routes if not any('${route.path}' in (p) for m in r.get('match',[]) for p in m.get('path',[]))]
import urllib.request
req=urllib.request.Request('http://127.0.0.1:2019/config/apps/http/servers/srv0/routes/0/handle/0/routes',data=json.dumps(filtered).encode(),headers={'Content-Type':'application/json'},method='PATCH')
urllib.request.urlopen(req)
print('ok')
"`;
        const result = await machineBash(machineId, cmd, "/");
        if (!result.success && result.stderr) {
            Modal.alert(t("machine.caddyError"), result.stderr);
        }
    }, [machineId, online]);

    const handleAdd = useCallback(() => {
        if (!online) return;
        Modal.show({
            component: AddCaddyRouteForm,
            props: {
                domain,
                existingPaths: routes.map((r) => r.path),
                onSubmit: async (localPort: number, path: string) => {
                    // Use curl + python to add route via Caddy admin API
                    const mountPath = path.startsWith("/") ? path : `/${path}`;
                    const cmd = `curl -sf http://127.0.0.1:2019/config/ | python3 -c "
import json,sys,urllib.request
data=json.load(sys.stdin)
routes=data['apps']['http']['servers']['srv0']['routes'][0]['handle'][0]['routes']
new_route={'group':'group${mountPath.replace(/\//g, "_")}','handle':[{'handler':'subroute','routes':[{'handle':[{'handler':'rewrite','strip_path_prefix':'${mountPath}'}]},{'handle':[{'handler':'reverse_proxy','upstreams':[{'dial':'host.docker.internal:${localPort}'}]}]}]}],'match':[{'path':['${mountPath}','${mountPath}/*']}]}
routes.insert(len(routes)-1,new_route)
req=urllib.request.Request('http://127.0.0.1:2019/config/apps/http/servers/srv0/routes/0/handle/0/routes',data=json.dumps(routes).encode(),headers={'Content-Type':'application/json'},method='PATCH')
urllib.request.urlopen(req)
print('ok')
"`;
                    const result = await machineBash(machineId, cmd, "/");
                    if (!result.success && result.stderr) {
                        Modal.alert(t("machine.caddyError"), result.stderr);
                    }
                },
            },
        });
    }, [machineId, online, domain, routes]);

    return (
        <ItemGroup
            title={t("machine.caddyTitle")}
            footer={domain ? `https://${domain}` : undefined}
        >
            {routes.length === 0 && (
                <Item title={t("machine.caddyEmpty")} showChevron={false} />
            )}
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
                                <Text style={{ fontSize: 14, color: theme.colors.success }}>
                                    HTTPS
                                </Text>
                            </View>
                        }
                        onPress={() => Linking.openURL(url)}
                        onLongPress={online && route.path !== "/" ? () => handleRemove(route) : undefined}
                        showChevron={false}
                    />
                );
            })}
            {online && (
                <Item
                    title={t("machine.caddyAdd")}
                    titleStyle={{ color: theme.colors.textLink }}
                    icon={
                        <Ionicons
                            name="add-circle-outline"
                            size={20}
                            color={theme.colors.textLink}
                        />
                    }
                    onPress={handleAdd}
                    showChevron={false}
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

    const handleSubmit = () => {
        if (!isValid) return;
        onSubmit(localPort, path.trim());
        onClose();
    };

    return (
        <View style={[formStyles.card, {
            backgroundColor: theme.colors.surface,
            shadowColor: theme.colors.shadow.color,
        }]}>
            <Text style={[formStyles.title, { color: theme.colors.text }]}>
                {t("machine.caddyAddTitle")}
            </Text>

            <Text style={[formStyles.label, { color: theme.colors.text }]}>
                {t("machine.caddyLocalPort")}
            </Text>
            <TextInput
                style={[formStyles.input, {
                    borderColor: theme.colors.divider,
                    color: theme.colors.text,
                    backgroundColor: theme.colors.surfaceHigh,
                }]}
                value={localPortText}
                onChangeText={setLocalPortText}
                placeholder="3000"
                placeholderTextColor={theme.colors.textSecondary}
                keyboardType="number-pad"
                autoFocus
            />

            <Text style={[formStyles.label, { color: theme.colors.text }]}>
                {t("machine.caddyPath")}
            </Text>
            <TextInput
                style={[formStyles.input, {
                    borderColor: isPathDuplicate ? theme.colors.accentOrange : theme.colors.divider,
                    color: theme.colors.text,
                    backgroundColor: theme.colors.surfaceHigh,
                }]}
                value={path}
                onChangeText={setPath}
                placeholder="/api"
                placeholderTextColor={theme.colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
            />
            {isPathDuplicate && (
                <Text style={{ fontSize: 12, color: theme.colors.accentOrange, marginTop: 4 }}>
                    {t("machine.caddyPathDuplicate")}
                </Text>
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
                <RoundButton
                    title={t("machine.caddyAdd")}
                    onPress={handleSubmit}
                    size="normal"
                    disabled={!isValid}
                    display="inverted"
                />
            </View>
        </View>
    );
}

const formStyles = StyleSheet.create({
    card: {
        borderRadius: 14,
        padding: 20,
        width: 320,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    title: {
        fontSize: 17,
        fontWeight: "600",
        textAlign: "center",
        marginBottom: 16,
    },
    label: {
        fontSize: 13,
        fontWeight: "500",
        marginTop: 14,
        marginBottom: 6,
    },
    input: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
    },
    previewBox: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        marginTop: 14,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    previewText: {
        fontSize: 12,
        fontFamily: "Menlo",
    },
    actions: {
        flexDirection: "row",
        justifyContent: "center",
        marginTop: 18,
    },
});
