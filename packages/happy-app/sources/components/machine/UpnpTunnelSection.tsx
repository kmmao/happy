/**
 * UPnP port mapping management section for the machine detail page.
 * Shows active UPnP mappings and allows add/remove.
 */

import React, { useState, useCallback, useMemo } from "react";
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
import { machineUpnpAdd, machineUpnpRemove } from "@/sync/ops";
import type { Machine } from "@/sync/storageTypes";

type UpnpEntry = {
    localPort: number;
    remotePort: number;
    protocol: string;
    target: string;
    publicUrl: string;
    metadata?: Record<string, string>;
};

type Props = {
    machineId: string;
    machine: Machine;
};

export const UpnpTunnelSection = React.memo(function UpnpTunnelSection({
    machineId,
    machine,
}: Props) {
    const { theme } = useUnistyles();
    const online = isMachineOnline(machine);

    // Read from tunnels.providers where provider === "upnp"
    const upnpProvider = useMemo(() => {
        const providers = (machine.daemonState as any)?.tunnels?.providers;
        if (!Array.isArray(providers)) return null;
        return providers.find((p: any) => p.provider === "upnp") ?? null;
    }, [machine.daemonState]);

    // Don't render if UPnP is not available
    if (!upnpProvider || upnpProvider.status !== "available") return null;

    const externalIp = upnpProvider.metadata?.externalIp ?? "";
    const entries: UpnpEntry[] = (upnpProvider.entries ?? []).map((e: any) => ({
        localPort: e.localPort ?? 0,
        remotePort: e.remotePort ?? 0,
        protocol: e.protocol ?? "TCP",
        target: e.target ?? "",
        publicUrl: e.publicUrl ?? `http://${externalIp}:${e.remotePort ?? 0}`,
        metadata: e.metadata,
    }));

    return (
        <UpnpSectionInner
            machineId={machineId}
            online={online}
            externalIp={externalIp}
            entries={entries}
            theme={theme}
        />
    );
});

// Inner component to avoid hooks-after-early-return
const UpnpSectionInner = React.memo(function UpnpSectionInner({
    machineId,
    online,
    externalIp,
    entries,
    theme,
}: {
    machineId: string;
    online: boolean;
    externalIp: string;
    entries: UpnpEntry[];
    theme: any;
}) {
    const handleRemove = useCallback(async (entry: UpnpEntry) => {
        if (!online) return;
        const confirmed = await Modal.confirm(
            t("machine.upnpRemove"),
            t("machine.upnpRemoveConfirm", { port: String(entry.remotePort) }),
        );
        if (confirmed) {
            const result = await machineUpnpRemove(machineId, entry.remotePort, entry.protocol as "TCP" | "UDP");
            if (!result.success && result.stderr) {
                Modal.alert(t("machine.upnpError"), result.stderr);
            }
        }
    }, [machineId, online]);

    const handleAdd = useCallback(() => {
        if (!online) return;
        Modal.show({
            component: AddUpnpForm,
            props: {
                externalIp,
                onSubmit: async (localPort: number, externalPort: number, protocol: "TCP" | "UDP") => {
                    const result = await machineUpnpAdd(machineId, localPort, externalPort, protocol);
                    if (!result.success && result.stderr) {
                        Modal.alert(t("machine.upnpError"), result.stderr);
                    }
                },
            },
        });
    }, [machineId, online, externalIp]);

    return (
        <ItemGroup title={t("machine.upnpTitle")} footer={externalIp ? `IP: ${externalIp}` : undefined}>
            {entries.length === 0 && (
                <Item title={t("machine.upnpEmpty")} showChevron={false} />
            )}
            {entries.map((entry) => {
                const url = entry.publicUrl;
                return (
                    <Item
                        key={`${entry.remotePort}-${entry.protocol}`}
                        title={`:${entry.remotePort} ${entry.protocol}`}
                        subtitle={`→ ${entry.target}\n${url}`}
                        subtitleLines={0}
                        subtitleStyle={{
                            fontFamily: "Menlo",
                            fontSize: 12,
                            color: theme.colors.textLink,
                        }}
                        rightElement={
                            <Text style={{ fontSize: 14, color: theme.colors.success }}>
                                {t("machine.upnpPublic")}
                            </Text>
                        }
                        onPress={() => Linking.openURL(url)}
                        onLongPress={online ? () => handleRemove(entry) : undefined}
                        showChevron={false}
                    />
                );
            })}
            {online && (
                <Item
                    title={t("machine.upnpAdd")}
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
// AddUpnpForm — shown via Modal.show()
// ---------------------------------------------------------------------------

function AddUpnpForm({ onClose, onSubmit, externalIp }: {
    onClose: () => void;
    onSubmit: (localPort: number, externalPort: number, protocol: "TCP" | "UDP") => void;
    externalIp: string;
}) {
    const { theme } = useUnistyles();
    const [localPortText, setLocalPortText] = useState("");
    const [externalPortText, setExternalPortText] = useState("");
    const [protocol, setProtocol] = useState<"TCP" | "UDP">("TCP");

    const localPort = parseInt(localPortText, 10);
    const externalPort = parseInt(externalPortText || localPortText, 10);
    const isValid = Number.isInteger(localPort) && localPort >= 1 && localPort <= 65535
        && Number.isInteger(externalPort) && externalPort >= 1 && externalPort <= 65535;

    const handleSubmit = () => {
        if (!isValid) return;
        onSubmit(localPort, externalPort, protocol);
        onClose();
    };

    return (
        <View style={[formStyles.card, {
            backgroundColor: theme.colors.surface,
            shadowColor: theme.colors.shadow.color,
        }]}>
            <Text style={[formStyles.title, { color: theme.colors.text }]}>
                {t("machine.upnpAddTitle")}
            </Text>

            {/* Local port */}
            <Text style={[formStyles.label, { color: theme.colors.text }]}>
                {t("machine.upnpLocalPort")}
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

            {/* External port */}
            <Text style={[formStyles.label, { color: theme.colors.text }]}>
                {t("machine.upnpExternalPort")}
            </Text>
            <TextInput
                style={[formStyles.input, {
                    borderColor: theme.colors.divider,
                    color: theme.colors.text,
                    backgroundColor: theme.colors.surfaceHigh,
                }]}
                value={externalPortText}
                onChangeText={setExternalPortText}
                placeholder={localPortText || "3000"}
                placeholderTextColor={theme.colors.textSecondary}
                keyboardType="number-pad"
            />

            {/* Protocol */}
            <Text style={[formStyles.label, { color: theme.colors.text }]}>
                {t("machine.upnpProtocol")}
            </Text>
            <View style={formStyles.chipRow}>
                {(["TCP", "UDP"] as const).map((p) => (
                    <Pressable
                        key={p}
                        onPress={() => setProtocol(p)}
                        style={[
                            formStyles.chip,
                            { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh },
                            protocol === p && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
                        ]}
                    >
                        <Text style={[
                            formStyles.chipText,
                            { color: theme.colors.text },
                            protocol === p && { color: "#fff" },
                        ]}>
                            {p}
                        </Text>
                    </Pressable>
                ))}
            </View>

            {/* Preview */}
            {isValid && (
                <View style={[formStyles.previewBox, { backgroundColor: theme.colors.surfaceHigh }]}>
                    <Text style={[formStyles.previewText, { color: theme.colors.textSecondary }]}>
                        {`${externalIp}:${externalPort} → localhost:${localPort} (${protocol})`}
                    </Text>
                </View>
            )}

            {/* Actions */}
            <View style={formStyles.actions}>
                <RoundButton title={t("common.cancel")} onPress={onClose} size="normal" />
                <View style={{ width: 12 }} />
                <RoundButton
                    title={t("machine.upnpAdd")}
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
    chipRow: {
        flexDirection: "row",
        gap: 8,
    },
    chip: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
    },
    chipText: {
        fontSize: 15,
        fontWeight: "600",
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
