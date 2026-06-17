import { Message } from "@/sync/typesMessage";

/**
 * Detect whether the "caveman" skill is currently active in this session by
 * scanning user-text messages newest-first.
 *
 * Rules (mirror ~/.claude/skills/caveman activation contract):
 *   - Activate when a user message starts with "/caveman".
 *   - Deactivate when a user message starts with "stop caveman" or "normal mode".
 *   - The newest matching message wins; default is OFF when no message matches.
 *
 * Matching against the message PREFIX (not anywhere in the body) avoids false
 * positives from incidental mentions like "remind me how stop caveman works".
 * The detector is pure so it works the same on any device viewing the session —
 * no local hook / state file required.
 */

const ACTIVATE_RE = /^\/caveman\b/i;
// Deactivation triggers — English skill contract plus the natural Chinese
// phrasings users actually type ("关闭 caveman", "退出 caveman", "停止 caveman",
// "普通模式", "正常模式"). Prefix-anchored so incidental mentions inside a
// longer sentence don't false-positive.
const DEACTIVATE_RE =
  /^(?:stop\s+caveman|normal\s+mode|(?:关闭|退出|停止)\s*caveman|普通模式|正常模式)/i;

export function isCavemanActive(
  messages: readonly Message[] | null | undefined,
): boolean {
  if (!messages || messages.length === 0) {
    return false;
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.kind !== "user-text") {
      continue;
    }

    const text = (message.displayText ?? message.text).trim();
    if (text.length === 0) {
      continue;
    }

    if (DEACTIVATE_RE.test(text)) {
      return false;
    }
    if (ACTIVATE_RE.test(text)) {
      return true;
    }
  }

  return false;
}
