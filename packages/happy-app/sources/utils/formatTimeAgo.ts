/**
 * Render a millisecond timestamp as a short "just now / Nm ago / Nh ago /
 * Nd ago" label. Originally lived inside the Timeline screen; lifted here
 * so Session Info (and any future surface) can reuse the same wording and
 * i18n keys without forking the logic.
 *
 * Past timestamps only — future timestamps (negative diff) render as
 * "just now" rather than as a negative count, which matches what callers
 * actually want when clock skew makes the App tick ahead of the CLI.
 *
 * Reuses the existing `timeline.*` translation keys so we don't grow the
 * i18n surface for a label that already has nine localizations.
 */
import { t } from "@/text";

export function formatTimeAgo(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 0) return t("timeline.justNow");
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("timeline.justNow");
    if (minutes < 60) return t("timeline.minutesAgo", minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("timeline.hoursAgo", hours);
    const days = Math.floor(hours / 24);
    return t("timeline.daysAgo", days);
}
