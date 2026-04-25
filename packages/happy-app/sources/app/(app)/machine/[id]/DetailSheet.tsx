/**
 * DetailSheet — 通用玻璃化详情底卡
 *
 * 适用于 automation 模块的 Job / Guardian / AuditEvent 详情。
 * 通过 Modal.show({ component: DetailSheet, props: {...} }) 调用，
 * onClose 由 CustomModal 自动注入。
 */
import * as React from "react";
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { BaseModal } from "@/modal/components/BaseModal";

// ── 公共类型 ─────────────────────────────────────────────────────────────────

export type DetailRow = {
    label: string;
    value: string;
    accent?: string;   // 文字高亮颜色
    mono?: boolean;    // 等宽字体（ID / 路径等）
};

export type DetailSection = {
    title?: string;    // 若有则显示小节标题
    rows: DetailRow[];
};

export type TimelineEntry = {
    label: string;
    time: string;
    color?: string;
};

export type EventEntry = {
    id: string;
    title: string;
    time: string;
    message?: string;
};

export type DetailButton = {
    text: string;
    style?: "default" | "cancel" | "destructive";
    onPress?: () => void;
};

export interface DetailSheetProps {
    title: string;
    kind?: string;           // 副标题，如 "Supervisor" / "agent-loop"
    statusLabel?: string;    // 状态徽章文字
    statusColor?: string;    // 状态徽章颜色
    errorMessage?: string;   // 若有则显示红色错误横幅
    sections: DetailSection[];
    timeline?: TimelineEntry[];
    events?: EventEntry[];
    buttons: DetailButton[];
    onClose: () => void;     // 由 CustomModal 注入
}

// ── 内部子组件 ────────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
    const { theme } = useUnistyles();
    return (
        <Text style={{
            fontSize: 10, fontWeight: "700", letterSpacing: 0.8,
            color: theme.colors.textSecondary,
            marginTop: 18, marginBottom: 4,
        }}>
            {label.toUpperCase()}
        </Text>
    );
}

function InfoRow({ label, value, accent, mono }: DetailRow) {
    const { theme } = useUnistyles();
    return (
        <View style={{
            flexDirection: "row", alignItems: "flex-start",
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.divider + "50",
            gap: 12,
        }}>
            <Text style={{ fontSize: 12, color: theme.colors.textSecondary, width: 88, flexShrink: 0, paddingTop: 1 }}>
                {label}
            </Text>
            <Text
                style={{
                    flex: 1, fontSize: 13,
                    color: accent ?? theme.colors.text,
                    fontFamily: mono ? (Platform.OS === "ios" ? "Menlo" : "monospace") : undefined,
                }}
                selectable
            >
                {value}
            </Text>
        </View>
    );
}

// ── 主组件 ───────────────────────────────────────────────────────────────────

export function DetailSheet({
    title,
    kind,
    statusLabel,
    statusColor,
    errorMessage,
    sections,
    timeline = [],
    events = [],
    buttons,
    onClose,
}: DetailSheetProps) {
    const { theme } = useUnistyles();
    const { height: screenHeight } = useWindowDimensions();
    // 最多占屏幕 65%，上方至少留 35% 供点击关闭
    const maxHeight = screenHeight * 0.65;

    const actionButtons = buttons.filter((b) => b.style !== "cancel");
    const cancelButton = buttons.find((b) => b.style === "cancel");

    return (
        <BaseModal visible onClose={onClose} closeOnBackdrop>
            <View style={{
                maxWidth: 480, width: "100%",
                maxHeight,
                borderRadius: 22, overflow: "hidden",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.15,
                shadowRadius: 20,
                elevation: 12,
            }}>
                    <View style={{
                        backgroundColor: theme.colors.surface,
                        borderRadius: 22,
                        overflow: "hidden",
                    }}>

                        {/* 拖动把手 */}
                        <View style={{ alignItems: "center", paddingTop: 12 }}>
                            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.colors.divider }} />
                        </View>

                        {/* 标题区 */}
                        <View style={{
                            paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.divider + "50",
                        }}>
                            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 17, fontWeight: "700", color: theme.colors.text }} numberOfLines={2}>
                                        {title}
                                    </Text>
                                    {kind ? (
                                        <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                                            {kind}
                                        </Text>
                                    ) : null}
                                </View>
                                {statusLabel && statusColor ? (
                                    <View style={{
                                        backgroundColor: statusColor + "1A",
                                        borderRadius: 8,
                                        paddingHorizontal: 10, paddingVertical: 5,
                                        borderWidth: 1, borderColor: statusColor + "50",
                                    }}>
                                        <Text style={{ fontSize: 12, fontWeight: "700", color: statusColor }}>
                                            {statusLabel}
                                        </Text>
                                    </View>
                                ) : null}
                            </View>

                            {errorMessage ? (
                                <View style={{
                                    marginTop: 10,
                                    backgroundColor: "#FF3B3015",
                                    borderRadius: 8, padding: 10,
                                    borderWidth: 1, borderColor: "#FF3B3030",
                                }}>
                                    <Text style={{ fontSize: 12, color: "#FF3B30" }}>{errorMessage}</Text>
                                </View>
                            ) : null}
                        </View>

                        {/* 可滚动内容 */}
                        <ScrollView
                            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
                            showsVerticalScrollIndicator={false}
                        >
                            {/* 字段区块 */}
                            {sections.map((section, si) => (
                                <React.Fragment key={si}>
                                    {section.title ? (
                                        <SectionLabel label={section.title} />
                                    ) : (
                                        si === 0 ? <View style={{ height: 8 }} /> : null
                                    )}
                                    {section.rows.map((row, ri) => (
                                        <InfoRow key={ri} {...row} />
                                    ))}
                                </React.Fragment>
                            ))}

                            {/* 生命周期时间线 */}
                            {timeline.length > 0 ? (
                                <>
                                    <SectionLabel label="生命周期" />
                                    {timeline.map((entry, i) => (
                                        <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", paddingVertical: 5, gap: 10 }}>
                                            <View style={{ alignItems: "center", width: 16, paddingTop: 3 }}>
                                                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: entry.color ?? theme.colors.textSecondary }} />
                                                {i < timeline.length - 1 ? (
                                                    <View style={{ width: 1, flex: 1, minHeight: 14, backgroundColor: theme.colors.divider, marginTop: 4 }} />
                                                ) : null}
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={{ fontSize: 13, color: theme.colors.text }}>{entry.label}</Text>
                                                <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginTop: 1 }}>{entry.time}</Text>
                                            </View>
                                        </View>
                                    ))}
                                </>
                            ) : null}

                            {/* 相关事件 */}
                            {events.length > 0 ? (
                                <>
                                    <SectionLabel label="相关事件" />
                                    {events.slice(0, 6).map((event) => (
                                        <View key={event.id} style={{
                                            flexDirection: "row", alignItems: "flex-start",
                                            paddingVertical: 7, gap: 8,
                                            borderBottomWidth: 1,
                                            borderBottomColor: theme.colors.divider + "40",
                                        }}>
                                            <Ionicons name="time-outline" size={12} color={theme.colors.textSecondary} style={{ marginTop: 2 }} />
                                            <View style={{ flex: 1 }}>
                                                <Text style={{ fontSize: 12, color: theme.colors.text }} numberOfLines={2}>
                                                    {event.title}{event.message ? ` — ${event.message}` : ""}
                                                </Text>
                                                <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginTop: 1 }}>
                                                    {event.time}
                                                </Text>
                                            </View>
                                        </View>
                                    ))}
                                </>
                            ) : null}
                        </ScrollView>

                        {/* 操作按钮区 */}
                        <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.divider + "50" }}>
                            {actionButtons.map((btn, i) => (
                                <Pressable
                                    key={i}
                                    style={({ pressed }) => ({
                                        paddingVertical: 14, alignItems: "center",
                                        borderBottomWidth: i < actionButtons.length - 1 ? 1 : 0,
                                        borderBottomColor: theme.colors.divider + "40",
                                        backgroundColor: pressed ? theme.colors.surfaceHigh : "transparent",
                                    })}
                                    onPress={() => { btn.onPress?.(); onClose(); }}
                                >
                                    <Text style={{
                                        fontSize: 16, fontWeight: "500",
                                        color: btn.style === "destructive" ? "#FF3B30" : theme.colors.textLink,
                                    }}>
                                        {btn.text}
                                    </Text>
                                </Pressable>
                            ))}

                            {/* 取消按钮视觉分离 */}
                            {cancelButton ? (
                                <Pressable
                                    style={({ pressed }) => ({
                                        paddingVertical: 14, alignItems: "center",
                                        borderTopWidth: 5,
                                        borderTopColor: theme.colors.groupped.background,
                                        backgroundColor: pressed ? theme.colors.surfaceHigh : "transparent",
                                    })}
                                    onPress={onClose}
                                >
                                    <Text style={{ fontSize: 16, fontWeight: "600", color: theme.colors.text }}>
                                        {cancelButton.text}
                                    </Text>
                                </Pressable>
                            ) : null}
                        </View>

                    </View>
            </View>
        </BaseModal>
    );
}
