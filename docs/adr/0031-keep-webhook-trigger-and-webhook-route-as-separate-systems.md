---
status: accepted
---

# 0031 — Keep WebhookTrigger and WebhookRoute as separate systems; rename in UI, not in code

Happy ended up with two "webhook" systems that overlap visually but not functionally:

- **WebhookTrigger** — a generic, provider-agnostic Trigger backed by an Account-defined slug + Server-generated secret. The Account installs the inbound hook themselves at the source (GitHub repo Settings → Webhooks, Zapier, crontab + curl, monitoring tools); Happy is unaware of the event shape beyond a few `HAPPY_WEBHOOK_*` env vars it injects into the spawned Session. Created from the main list `+` menu → "Create a Webhook URL" modal. Added during the Workflow IA rollout to give Workflow's Event kind a real backing entity.
- **WebhookRoute** — a GitHub / Gitea / GitLab-aware Trigger bound to a specific `repoUrl` + provider. Happy uses the Account's stored `apiToken` for that provider to **auto-install** the inbound webhook on the platform (via the provider's REST API), stores the platform-side webhook id in `remoteWebhookId`, filters inbound deliveries by `labels` + `authors` allowlists, and produces a `WebhookEvent` row per delivery that spawns a Task or a supervisor fix run. Configured under **Settings → Git Hosts → Repo Webhook tab**. Predates the Workflow IA — the GitHub issue → supervisor fix pipeline was the original use case.

The two predate each other by months. By the time we wired the Workflow modal, "webhook" already meant WebhookRoute in users' heads; we accidentally shipped a second one under the same label. A user asked the natural question — "when does the new webhook get called, and isn't the GitHub config in settings enough?" — and the modal could not answer either half on its own.

## Decision

Keep both systems. Distinguish them at the surface, not in code.

- **Internal symbols stay separate and unchanged.** `WebhookTrigger` and `WebhookRoute` remain the canonical Prisma models, route prefixes (`/v1/webhook-triggers`, `/v1/webhook-routes`, public callback `/v1/triggers/:slug`), and CONTEXT.md entries. The bare word "Webhook" is forbidden as a glossary term going forward (CONTEXT.md _Avoid_ clauses on both entries).
- **UI labels diverge.** The Workflow modal and `+` menu call WebhookTrigger a **"Webhook URL"** (emphasises "we give you a URL"). The Settings tab calls WebhookRoute a **"Repo Webhook"** (emphasises "bound to a repo, Happy auto-installs"). The two surfaces show **cross-pointer banners** to each other so a user landing in the wrong place can pivot in one tap.

## Considered alternatives

- **A.1 — docs only, no UI change.** Rejected: shipping a glossary fix while leaving the UI showing the collided "Webhook" label in two places solves the wrong half of the problem. The user confusion lives at the surface.
- **B — merge into Workflow.** Make WebhookRoute a variant of the Workflow Webhook URL modal: add an optional "bind to a repo" switch that flips on label/author filters + the platform auto-install via `apiToken`. Rejected on two counts. First, the modal would grow from 4 fields to 10+, breaking the "30-second setup" property the Workflow IA was designed for. Second, the auto-install behaviour is conditional and provider-aware — collapsing it into a generic modal would either hide it (users would miss the most valuable feature of the old WebhookRoute) or surface it with provider-specific UI branches that defeat the unification.
- **C — split harder ("Trigger URL" vs "Webhook").** Strip the word "webhook" from WebhookTrigger entirely; rename Workflow's Event kind to "Trigger URL Workflow". Rejected: A.3 already disambiguates without forcing existing Workflow users to relearn the name they just got used to. C also collides with the umbrella `Trigger` we already had in CONTEXT.md.
- **D — flip ownership of "Webhook" toward WebhookRoute.** Let WebhookRoute keep the bare "Webhook" label (which is what it most naturally is — Happy auto-installing a callback on a platform _is_ the textbook webhook), and rename WebhookTrigger to something like "Trigger URL". Rejected with the most regret: D is arguably the cleanest reading of the underlying domain, but the Workflow IA 8-batch sprint had just landed and changing the freshly-published "Create a Webhook" workflow name to something else would have looked like flailing. Recorded here so a future ADR that revisits naming has the option live.

## Consequences

- CONTEXT.md is now the canonical reference for which webhook is which; both terms cross-reference each other and `Webhook` (bare) is forbidden.
- New surfaces that mention webhooks pick one specifically — there is no shared umbrella term to fall back on.
- Two i18n keys + two cross-pointer banners (Workflow modal ↔ Settings Repo Webhook tab) are now load-bearing for the disambiguation — they shouldn't be deleted as "redundant info" without revisiting this ADR.
- The Workflow IA's `Event-driven Workflow` kind covers WebhookTrigger only. If WebhookRoute should eventually also surface as a Workflow row, that's a follow-up ADR (mentioned as an open question below).
- If a third "webhook-shaped" Trigger appears (e.g. provider-agnostic + filtered, or platform-installed + custom prompt), this ADR should be revisited rather than extended — three webhook systems under the current naming scheme would re-create the collision at a new level.

## Open subordinate questions

- **Should WebhookRoute also become a Workflow kind?** Today the Workflow list shows Ad-hoc / Scheduled / Event / Loop, and Event = WebhookTrigger only. Folding WebhookRoute into the Event row would unify the list view but re-raise the merge question this ADR rejected. Wait for a real product need.
- **Auto-installed Repo Webhook for non-issue triggers?** WebhookRoute currently only handles issue events. PR / push / release would be a natural extension but would force the `WebhookRoute` × `eventType` matrix to grow. Deferred.
