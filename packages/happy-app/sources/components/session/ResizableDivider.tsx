import * as React from "react";
import { View, Platform } from "react-native";
import { useUnistyles } from "react-native-unistyles";

const DIVIDER_WIDTH = 6;

interface ResizableDividerProps {
    onResize: (deltaX: number) => void;
    onResizeEnd: () => void;
}

export { DIVIDER_WIDTH };

export const ResizableDivider = React.memo<ResizableDividerProps>(
    function ResizableDivider({ onResize, onResizeEnd }) {
        const { theme } = useUnistyles();
        const [active, setActive] = React.useState(false);
        const lastXRef = React.useRef(0);
        const onResizeRef = React.useRef(onResize);
        const onResizeEndRef = React.useRef(onResizeEnd);
        onResizeRef.current = onResize;
        onResizeEndRef.current = onResizeEnd;

        // On web: attach mousedown via ref, global move/up via window
        const viewRef = React.useRef<View>(null);

        React.useEffect(() => {
            if (Platform.OS !== "web" || !viewRef.current) return;
            // In RN Web, View ref IS the DOM element
            const el = viewRef.current as unknown as HTMLDivElement;

            const onMouseDown = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                lastXRef.current = e.clientX;
                setActive(true);

                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";

                const onMouseMove = (ev: MouseEvent) => {
                    const d = ev.clientX - lastXRef.current;
                    lastXRef.current = ev.clientX;
                    if (d !== 0) onResizeRef.current(d);
                };

                const onMouseUp = () => {
                    setActive(false);
                    document.body.style.cursor = "";
                    document.body.style.userSelect = "";
                    window.removeEventListener("mousemove", onMouseMove);
                    window.removeEventListener("mouseup", onMouseUp);
                    onResizeEndRef.current();
                };

                window.addEventListener("mousemove", onMouseMove);
                window.addEventListener("mouseup", onMouseUp);
            };

            el.addEventListener("mousedown", onMouseDown);
            return () => {
                el.removeEventListener("mousedown", onMouseDown);
            };
        }, []);

        if (Platform.OS !== "web") {
            return (
                <View style={{ width: 1, backgroundColor: theme.colors.divider }} />
            );
        }

        return (
            <View
                ref={viewRef}
                style={{
                    width: DIVIDER_WIDTH,
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "col-resize" as any,
                }}
            >
                <View
                    style={{
                        width: active ? 2 : 1,
                        height: "100%",
                        backgroundColor: active
                            ? theme.colors.textLink
                            : theme.colors.divider,
                    }}
                    pointerEvents="none"
                />
            </View>
        );
    },
);
