import * as React from "react";
import { View, Text, PanResponder } from "react-native";
import Svg, { Path, Line, Text as SvgText, Circle } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type { LifecycleTrendPoint } from "@/hooks/useProjectKnowledge";

interface Props {
    data: LifecycleTrendPoint[];
}

const CHART_H = 100;
const PAD_LEFT = 28;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 18;
const LEGEND_H = 24;
const TOOLTIP_H = 44;

function makePath(points: Array<[number, number]>): string {
    return points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
}

export function KnowledgeLifecycleTrendChart({ data }: Props) {
    const { theme } = useUnistyles();
    const [width, setWidth] = React.useState(0);
    const [activeIndex, setActiveIndex] = React.useState<number | null>(null);

    const n = data.length;
    const chartW = width - PAD_LEFT - PAD_RIGHT;
    const chartInnerH = CHART_H - PAD_TOP - PAD_BOTTOM;

    const maxVal = React.useMemo(() => {
        const m = Math.max(...data.map((d) => Math.max(d.created, d.superseded, d.archived)));
        return m <= 0 ? 1 : m;
    }, [data]);

    const xPos = React.useCallback(
        (i: number) => PAD_LEFT + (n <= 1 ? chartW / 2 : (i / (n - 1)) * chartW),
        [n, chartW],
    );
    const yPos = React.useCallback(
        (v: number) => PAD_TOP + chartInnerH - (v / maxVal) * chartInnerH,
        [chartInnerH, maxVal],
    );

    const panResponder = React.useMemo(
        () =>
            PanResponder.create({
                onStartShouldSetPanResponder: () => true,
                onMoveShouldSetPanResponder: () => true,
                onPanResponderGrant: (evt) => {
                    const x = evt.nativeEvent.locationX;
                    const idx = Math.round(((x - PAD_LEFT) / chartW) * (n - 1));
                    setActiveIndex(Math.max(0, Math.min(n - 1, idx)));
                },
                onPanResponderMove: (evt) => {
                    const x = evt.nativeEvent.locationX;
                    const idx = Math.round(((x - PAD_LEFT) / chartW) * (n - 1));
                    setActiveIndex(Math.max(0, Math.min(n - 1, idx)));
                },
                onPanResponderRelease: () => {
                    setActiveIndex(null);
                },
                onPanResponderTerminate: () => {
                    setActiveIndex(null);
                },
            }),
        [chartW, n],
    );

    const createdPath = React.useMemo(() => makePath(data.map((d, i) => [xPos(i), yPos(d.created)])), [data, xPos, yPos]);
    const supersededPath = React.useMemo(() => makePath(data.map((d, i) => [xPos(i), yPos(d.superseded)])), [data, xPos, yPos]);
    const archivedPath = React.useMemo(() => makePath(data.map((d, i) => [xPos(i), yPos(d.archived)])), [data, xPos, yPos]);

    const xLabelIndices = [0, 7, 14, 21, n - 1].filter((i) => i >= 0 && i < n);

    const totalH = CHART_H + LEGEND_H;

    const lines = React.useMemo(
        () => [
            { path: createdPath, color: theme.colors.success, label: t("projects.knowledgeLifecycleActive"), key: "created" as const },
            { path: supersededPath, color: theme.colors.accentOrange, label: t("projects.knowledgeLifecycleSuperseded"), key: "superseded" as const },
            { path: archivedPath, color: theme.colors.textSecondary, label: t("projects.knowledgeLifecycleArchived"), key: "archived" as const },
        ],
        [createdPath, supersededPath, archivedPath, theme],
    );

    if (width === 0 || n < 2) {
        return <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: totalH + TOOLTIP_H }} />;
    }

    const activePoint = activeIndex !== null ? data[activeIndex] : null;
    const activeCx = activeIndex !== null ? xPos(activeIndex) : 0;

    return (
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ marginTop: 8, marginBottom: 2 }}>
            {/* Tooltip row */}
            <View style={styles.tooltipRow}>
                {activePoint ? (
                    <>
                        <Text style={[styles.tooltipDate, { color: theme.colors.text }]}>
                            {activePoint.date}
                        </Text>
                        <View style={styles.tooltipValues}>
                            {lines.map(({ color, key }) => (
                                <View key={key} style={styles.tooltipItem}>
                                    <View style={[styles.tooltipDot, { backgroundColor: color }]} />
                                    <Text style={[styles.tooltipValue, { color: theme.colors.text }]}>
                                        {activePoint[key]}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </>
                ) : (
                    <Text style={[styles.tooltipHint, { color: theme.colors.textSecondary }]}>
                        {t("projects.knowledgeLifecycleTrendHint")}
                    </Text>
                )}
            </View>

            <View {...panResponder.panHandlers}>
                <Svg width={width} height={totalH}>
                    {/* Horizontal grid lines */}
                    {[0, 0.5, 1].map((frac) => (
                        <Line
                            key={frac}
                            x1={PAD_LEFT}
                            y1={PAD_TOP + chartInnerH * (1 - frac)}
                            x2={width - PAD_RIGHT}
                            y2={PAD_TOP + chartInnerH * (1 - frac)}
                            stroke={theme.colors.surfaceHighest}
                            strokeWidth={0.5}
                            strokeDasharray={frac === 0 ? undefined : "3,3"}
                        />
                    ))}

                    {/* Y max label */}
                    <SvgText
                        x={PAD_LEFT - 3}
                        y={PAD_TOP + 4}
                        fontSize={9}
                        fill={theme.colors.textSecondary}
                        textAnchor="end"
                    >
                        {maxVal}
                    </SvgText>

                    {/* Data lines */}
                    {lines.map(({ path, color }) => (
                        <Path key={color} d={path} stroke={color} strokeWidth={1.5} fill="none" />
                    ))}

                    {/* Active indicator */}
                    {activeIndex !== null && (
                        <>
                            <Line
                                x1={activeCx}
                                y1={PAD_TOP}
                                x2={activeCx}
                                y2={PAD_TOP + chartInnerH}
                                stroke={theme.colors.textSecondary}
                                strokeWidth={0.5}
                                strokeDasharray="2,2"
                            />
                            {lines.map(({ color, key }) => (
                                <Circle
                                    key={key}
                                    cx={activeCx}
                                    cy={yPos(activePoint![key])}
                                    r={3.5}
                                    fill={color}
                                    stroke={theme.colors.surface}
                                    strokeWidth={1.5}
                                />
                            ))}
                        </>
                    )}

                    {/* X axis labels */}
                    {xLabelIndices.map((i) => (
                        <SvgText
                            key={i}
                            x={xPos(i)}
                            y={CHART_H - 2}
                            fontSize={9}
                            fill={theme.colors.textSecondary}
                            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                        >
                            {data[i].date.slice(5)}
                        </SvgText>
                    ))}

                    {/* Legend */}
                    {lines.map(({ color, label }, idx) => {
                        const lx = PAD_LEFT + (idx * chartW) / 3;
                        const ly = CHART_H + 6;
                        return (
                            <React.Fragment key={label}>
                                <Circle cx={lx + 4} cy={ly + 4} r={4} fill={color} />
                                <SvgText x={lx + 12} y={ly + 8} fontSize={9} fill={theme.colors.textSecondary}>
                                    {label}
                                </SvgText>
                            </React.Fragment>
                        );
                    })}
                </Svg>
            </View>
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    tooltipRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 4,
        height: 22,
        marginBottom: 2,
    },
    tooltipDate: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    tooltipValues: {
        flexDirection: "row",
        gap: 10,
    },
    tooltipItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
    },
    tooltipDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
    },
    tooltipValue: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    tooltipHint: {
        ...Typography.default("regular"),
        fontSize: 11,
    },
}));
