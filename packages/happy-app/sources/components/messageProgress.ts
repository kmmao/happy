export function parseTaskStatusMessage(text: string): {
    status: "start" | "progress" | "completed" | "failed" | "stopped";
    summary: string;
    metrics: string | null;
} | null {
    const lines = text.split("\n");
    const header = lines[0]?.trim();
    const status =
        header === "⏳ Task started"
            ? "start"
            : header === "⏳ Task progress"
              ? "progress"
              : header === "✓ Task completed"
                ? "completed"
                : header === "✗ Task failed"
                  ? "failed"
                  : header === "■ Task stopped"
                    ? "stopped"
                    : null;
    if (!status) {
        return null;
    }

    const summary = lines[1]?.trim();
    if (!summary) {
        return null;
    }

    const rawMetrics = lines[2]?.trim();
    const metrics = rawMetrics?.startsWith("_") && rawMetrics.endsWith("_")
        ? rawMetrics.slice(1, -1)
        : null;

    return { status, summary, metrics };
}

export function getThinkingLabelTitle(text: string): string | null {
    const normalizedText = text.trim().replace(/^\*+|\*+$/g, "");
    const firstMeaningfulLine = normalizedText
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0);

    if (!firstMeaningfulLine) {
        return null;
    }

    const normalizedTitle = firstMeaningfulLine
        .replace(/^#{1,6}\s+/, "")
        .replace(/\*+$/g, "")
        .trim();

    return normalizedTitle.length > 0 ? normalizedTitle : null;
}
