export function formatCompactTabNumber(value: number): string {
    const absoluteValue = Math.abs(value);
    const sign = value < 0 ? "-" : "";

    if (absoluteValue < 1000) {
        return `${sign}${absoluteValue}`;
    }

    const units = [
        { value: 1_000_000_000, suffix: "b" },
        { value: 1_000_000, suffix: "m" },
        { value: 1_000, suffix: "k" },
    ] as const;

    for (const unit of units) {
        if (absoluteValue < unit.value) continue;

        const scaled = absoluteValue / unit.value;
        const decimals = scaled < 10 ? 1 : 0;
        const factor = 10 ** decimals;
        const rounded = Math.round(scaled * factor) / factor;
        const rendered = decimals === 0
            ? `${Math.round(rounded)}`
            : rounded.toFixed(1).replace(/\.0$/, "");

        return `${sign}${rendered}${unit.suffix}`;
    }

    return `${sign}${absoluteValue}`;
}
