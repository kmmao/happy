import React from "react";
import { Platform } from "react-native";
import { log } from "@/log";

interface State {
    hasError: boolean;
    message: string | null;
}

export class WebErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
    state: State = { hasError: false, message: null };

    static getDerivedStateFromError(error: unknown): State {
        return {
            hasError: true,
            message: error instanceof Error ? error.message : String(error),
        };
    }

    componentDidCatch(error: unknown, info: React.ErrorInfo) {
        log.error("WebErrorBoundary caught render error:", error, info.componentStack);
    }

    handleReload = () => {
        if (typeof window !== "undefined") {
            window.location.reload();
        }
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100vh",
                    width: "100vw",
                    fontFamily: "system-ui, sans-serif",
                    backgroundColor: "#0f0f0f",
                    color: "#e0e0e0",
                    gap: 16,
                    padding: 32,
                    boxSizing: "border-box",
                }}
            >
                <div style={{ fontSize: 32, marginBottom: 8 }}>⚠</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</div>
                {this.state.message && (
                    <div
                        style={{
                            fontSize: 13,
                            color: "#888",
                            maxWidth: 480,
                            textAlign: "center",
                            wordBreak: "break-word",
                        }}
                    >
                        {this.state.message}
                    </div>
                )}
                <button
                    onClick={this.handleReload}
                    style={{
                        marginTop: 8,
                        padding: "10px 24px",
                        borderRadius: 8,
                        border: "none",
                        background: "#007aff",
                        color: "#fff",
                        fontSize: 15,
                        cursor: "pointer",
                        fontFamily: "inherit",
                    }}
                >
                    Reload
                </button>
            </div>
        );
    }
}

export function setupWebErrorHandlers() {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    window.addEventListener("error", (event) => {
        log.error("Uncaught error:", event.message, event.filename, event.lineno);
    });

    window.addEventListener("unhandledrejection", (event) => {
        log.error("Unhandled promise rejection:", event.reason);
    });
}
