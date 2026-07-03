---
status: accepted
---

# Notification dispatch stays per-subscriber — no unified NotificationOrchestrator

## Context

An architecture review proposed collapsing the App's notification dispatch into
one `NotificationOrchestrator` seam, observing that several `ingestEvents`
subscribers in `sync.ts` (`permission-requested`, `terminal-signal`,
`task-completed`) each "route one event to multiple channels." Verifying against
the code, the three channels are genuinely different, not one pattern:

- **Voice cue** (`voiceHooks.on*`) — fired UNCONDITIONALLY on
  `permission-requested`; no platform or settings gate.
- **Web notification** (`notifyPermissionRequest` / `notifyTaskComplete`) —
  gated on `Platform.OS === "web" && settings.webNotifications`, needs a session
  lookup + `getSessionName`, and carries a per-event payload (requestId +
  toolName for permission; none for task-complete).
- **Native platform notification** (`Notifications.scheduleNotificationAsync`) —
  fired on the `terminal-signal` `notification` kind, with NO web/settings gate,
  and a different title/body shape.

These are three distinct channels with three distinct gating rules and payloads.
A single orchestrator "parameterized by channel + settings" would be a shallow
module — its interface (which channels, which gate, which payload, per event)
is as complex as the three inline subscribers it would replace. It also fights
ADR-0026, under which ingest side-effects deliberately fan out as independent
subscribers that each own their presentation.

The only genuinely shared fragment is a two-line web-notification gate
(`isWeb && settings.webNotifications && session → { sessionName, persistent }`)
duplicated across `permission-requested` and `task-completed`. Centralizing two
lines is not worth threading a new dependency through `sync.ts` (2.4k lines) and
coupling every notification subscriber to a shared dispatcher.

By the deletion test: deleting the (nonexistent) orchestrator changes nothing;
the per-channel gating does not concentrate — it is genuinely per-channel.

## Decision

No `NotificationOrchestrator`. Notification dispatch stays as independent
`ingestEvents` subscribers, each owning its own channel, gate, and payload
(ADR-0026). A future review proposing to "unify notification dispatch" or add a
"multi-channel notification seam" should verify against this ADR first.

## Consequences

- Adding a new notification channel or event is a new subscriber, not a change
  to a central dispatcher — no shared-interface widening.
- If a THIRD subscriber ever needs the exact web-notification gate (a real
  second+ adapter for that one rule), extracting a small pure
  `resolveWebNotificationTarget(session, isWeb, enabled, persistent)` helper —
  and ONLY that gate, not a channel orchestrator — becomes worthwhile. That
  narrow gate, not channel unification, is the trigger.
