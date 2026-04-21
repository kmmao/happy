## Summary

- What changed:
- Why:

## Validation

- Tests / checks run:
- Risk / rollback notes:

---

## Codex alignment (fill out when this PR touches Codex-related behavior)

> If this PR does **not** touch Codex-related runtime / config / protocol / UI behavior, write `N/A` and leave the checklist unchecked.

### When this section is REQUIRED

Fill out this section when the PR changes any of these:

- `packages/happy-cli/src/codex/**`
- `packages/happy-cli/src/codex-app/**`
- `packages/happy-cli/src/codex-shared/**`
- `packages/happy-cli/src/sessionProtocol/**`
- `packages/happy-cli/scripts/generate-codex-app-server-notification-contract-subset.mjs`
- `packages/happy-cli/src/codex-app/__fixtures__/**`
- `packages/happy-app` Codex-specific session/model/permission UI
- Codex-related docs/plans that change alignment policy, config policy, fallback policy, or contract workflow

If this PR only touches unrelated areas, explicitly write `N/A` in Classification.

### Classification

- Classification: `upstream-aligned` | `happy-opinionated` | `compat` | `N/A`
- Affected module(s):
  - `N/A`

### Upstream baseline

- Upstream source:
  - `N/A`
- Verified date:
  - `N/A`
- Upstream reference:
  - release:
  - docs/page:
  - file/module:

### Divergence rationale

> Required when classification is `happy-opinionated` or `compat`.

- Why not upstream-aligned:
  - `N/A`
- User-visible:
  - `yes` | `no` | `N/A`
- Where exposed:
  - `UI` | `metadata` | `docs` | `internal only` | `N/A`
- Planned future:
  - `keep` | `shrink` | `make configurable` | `remove` | `N/A`

### Codex-specific checks

- [ ] I ran `yarn codex:refresh-app-server-contract` if this PR touched any of:
  - `packages/happy-cli/src/codex-app/**`
  - `packages/happy-cli/src/codex-app/__fixtures__/**`
  - `packages/happy-cli/scripts/generate-codex-app-server-notification-contract-subset.mjs`
- [ ] I ran `yarn codex:verify-app-server-contract` if this PR touched any of:
  - `packages/happy-cli/src/codex-app/**`
  - `packages/happy-cli/src/codex-app/__fixtures__/**`
  - `packages/happy-cli/scripts/generate-codex-app-server-notification-contract-subset.mjs`
- [ ] I updated UI / metadata / docs if this PR changes `happy-opinionated` Codex behavior
- [ ] I documented trigger conditions and intended retirement path if this PR changes `compat` behavior

### Minimum evidence to paste for Codex app-server contract changes

When this PR touches Codex app-server notification schema/client/fixtures, include:

- Refresh command result:
  - `yarn codex:refresh-app-server-contract`
- Verify command result:
  - `yarn codex:verify-app-server-contract`
- Whether generated subset changed:
  - `yes` / `no`
- If yes, why:
  - `N/A`

### CI enforcement

- Expected GitHub Actions check:
  - `Codex App Server Contract`
- If this check did not run when you expected it to, explain why:
  - `N/A`

### Notes for reviewers

- Relevant matrix row(s):
  - `docs/plans/codex-upstream-alignment-matrix.md`
- Relevant roadmap:
  - `docs/plans/codex-upstream-alignment-roadmap.md`
