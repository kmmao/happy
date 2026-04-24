import * as React from "react";
import { View, Platform, Text } from "react-native";
import { WebView } from "react-native-webview";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { log } from '@/log';

const KATEX_VERSION = "0.16.11";
const KATEX_CDN = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist`;

/**
 * Escape HTML special characters to prevent XSS when interpolating
 * user content into WebView HTML templates.
 */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export const MathRenderer = React.memo((props: {
    content: string;
    mode: 'inline' | 'block';
}) => {
    const { theme } = useUnistyles();
    const displayMode = props.mode === 'block';

    // Web platform: render directly with KaTeX
    if (Platform.OS === "web") {
        const [html, setHtml] = React.useState<string | null>(null);
        const [hasError, setHasError] = React.useState(false);

        React.useEffect(() => {
            let isMounted = true;
            setHasError(false);

            const renderMath = async () => {
                try {
                    const katexModule: any = await import("katex");
                    const katex = katexModule.default || katexModule;

                    const rendered = katex.renderToString(props.content, {
                        displayMode,
                        throwOnError: false,
                        output: 'html',
                    });

                    const dompurifyModule: any = await import("dompurify");
                    const DOMPurify = dompurifyModule.default || dompurifyModule;
                    const sanitized = DOMPurify.sanitize(rendered, { FORCE_BODY: true });

                    if (isMounted) {
                        setHtml(sanitized);
                    }
                } catch (error) {
                    if (isMounted) {
                        log.warn(`[Math] Render failed: ${error instanceof Error ? error.message : String(error)}`);
                        setHasError(true);
                    }
                }
            };

            renderMath();

            return () => {
                isMounted = false;
            };
        }, [props.content, displayMode]);

        if (hasError) {
            return (
                <View style={displayMode ? style.blockErrorContainer : undefined}>
                    <Text style={style.errorText}>{props.content}</Text>
                </View>
            );
        }

        if (!html) {
            return null;
        }

        // Inject KaTeX CSS via link tag + rendered HTML
        const fullHtml = `<link rel="stylesheet" href="${KATEX_CDN}/katex.min.css" />${html}`;

        return (
            <View style={displayMode ? style.blockContainer : style.inlineContainer}>
                {/* @ts-ignore - Web only */}
                <div
                    style={{
                        color: theme.colors.text,
                        fontSize: displayMode ? 18 : 16,
                        lineHeight: displayMode ? '1.6' : '1.4',
                        textAlign: displayMode ? 'center' : 'inherit',
                    }}
                    dangerouslySetInnerHTML={{ __html: fullHtml }}
                />
            </View>
        );
    }

    // Mobile: use WebView with KaTeX CDN
    const [webViewHeight, setWebViewHeight] = React.useState(displayMode ? 60 : 24);

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
            <link rel="stylesheet" href="${KATEX_CDN}/katex.min.css">
            <script src="${KATEX_CDN}/katex.min.js"></script>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    background-color: transparent;
                    color: ${theme.colors.text};
                    font-size: ${displayMode ? 18 : 16}px;
                    display: flex;
                    justify-content: ${displayMode ? 'center' : 'flex-start'};
                    align-items: center;
                    min-height: ${displayMode ? 40 : 20}px;
                    padding: ${displayMode ? '8px 4px' : '0 2px'};
                    overflow: hidden;
                }
                #math-container {
                    max-width: 100%;
                    overflow-x: auto;
                }
                .katex { color: ${theme.colors.text}; }
                .katex-error { color: ${theme.colors.textSecondary}; font-family: monospace; font-size: 14px; }
            </style>
        </head>
        <body>
            <div id="math-container"></div>
            <script>
                try {
                    var content = decodeURIComponent("${encodeURIComponent(props.content)}");
                    katex.render(content, document.getElementById('math-container'), {
                        displayMode: ${displayMode},
                        throwOnError: false,
                        output: 'html'
                    });
                } catch (e) {
                    document.getElementById('math-container').textContent = '${escapeHtml(props.content)}';
                }
                // Report actual height back to React Native
                setTimeout(function() {
                    var height = document.body.scrollHeight;
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'dimensions', height: height }));
                }, 100);
            </script>
        </body>
        </html>
    `;

    return (
        <View style={displayMode ? style.blockContainer : style.inlineContainer}>
            <WebView
                source={{ html: htmlContent }}
                style={[
                    { height: webViewHeight, backgroundColor: 'transparent' },
                    !displayMode && { minWidth: 40 },
                ]}
                scrollEnabled={false}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                onMessage={(event) => {
                    try {
                        const data = JSON.parse(event.nativeEvent.data);
                        if (data.type === "dimensions") {
                            setWebViewHeight(Math.max(data.height, displayMode ? 40 : 20));
                        }
                    } catch (e) {
                        // ignore parse errors
                    }
                }}
            />
        </View>
    );
});

const style = StyleSheet.create((theme) => ({
    blockContainer: {
        marginVertical: 8,
        width: "100%",
        alignItems: "center",
    },
    inlineContainer: {
        marginVertical: 4,
    },
    blockErrorContainer: {
        marginVertical: 8,
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        padding: 12,
    },
    errorText: {
        ...Typography.mono(),
        color: theme.colors.textSecondary,
        fontSize: 14,
        lineHeight: 20,
    },
}));
