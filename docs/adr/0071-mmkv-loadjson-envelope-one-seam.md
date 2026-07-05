---
status: accepted
---

# The MMKV load envelope is owned by one seam (loadJson)

## Context

`sync/persistence.ts` has ~30 `loadX`/`saveX` accessors over MMKV. The simple
loaders all repeated the same envelope inline —

```ts
const raw = mmkv.getString(key);
if (raw) {
  try { return <parse raw>; }
  catch (e) { log.error("Failed to parse X", e); return fallback; }
}
return fallback;
```

— but with **drifting validation**: some ran a `*Parse` helper or a Zod
`.parse()` (Pattern A, validated), while many just returned `JSON.parse(raw)`
as an unchecked cast (Pattern B, no validation). The "read → decode → validate →
fall back on error" rule had no owner, so the amount of validation varied per key
by accident rather than intent.

## Decision

`loadJson<T>(key, parse, fallback)` owns the envelope: read the key, `JSON.parse`,
run `parse` on the decoded value, and return its result — or `fallback` when the
key is absent or anything throws (logged once). `parse` is where validation lives:
an identity cast preserves a Pattern-B loader's prior unchecked behavior; a
`*Parse`/Zod call validates (and its throw is caught here).

18 loaders migrated: the 7 validated (Pattern A — `loadSettings`,
`loadLocalSettings`, `loadThemePreference`, `loadPurchases`, `loadProfile`,
`loadPendingSettings`, `loadPendingSessionPreferences`) and the 11 unchecked
(Pattern B — session drafts / pending queues / paused / permission-modes /
model-modes / sdk-settings / needs-attention / starred / model-mappings /
custom-models / profiles).

## Deliberately NOT migrated

- **safeParse-with-side-effects loaders** (`loadBackfillBoundaries`,
  `loadHiddenProcesses`, `loadOneClickIgnoredRepos`) — they validate via
  `safeParse` and additionally delete stale keys / iterate per-machine keys.
- **ad-hoc field extractors** (`loadNewSessionDraft`, `loadSessionLastViewed`,
  `loadSessionBookmarks`, `loadDismissedTasks`, `loadResearchPrefs`) — they do
  per-field `typeof` coercion, legacy-format migration, or array→Set/number
  filtering, which is not the simple envelope.

Forcing those through `loadJson` would widen its interface to the union of every
loader's side effects — the shallow-module trap. They keep their own bodies.

## Consequences

- The read-decode-validate-fallback rule has one home and one test surface
  (`persistenceLoadJson.test.ts`): valid decode, corrupt JSON → fallback (no
  throw), missing key → fallback, and validating-parse-throws → fallback, driven
  through a Pattern-A and a Pattern-B caller with an in-memory MMKV fake.
- The Pattern-B loaders' lack of validation is now a visible, deliberate choice
  (`(v) => v as T`) rather than an inconsistency buried in copy-pasted bodies; any
  of them can adopt a real schema by changing only its `parse` argument.
- A new simple loader is a one-line `loadJson(...)`, not another copy of the
  try/catch envelope.
