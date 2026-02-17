# happy-app CLAUDE.md

## Tauri Desktop Commands
- `yarn tauri:dev` - macOS desktop with hot reload
- `yarn tauri:build:dev` / `tauri:build:preview` / `tauri:build:production`

## OTA Deployment
- `yarn ota` - Deploy over-the-air updates via EAS Update

## Changelog
When adding features/fixes, update `/CHANGELOG.md` then run `npx tsx sources/scripts/parseChangelog.ts`.
Format: `## Version [N] - YYYY-MM-DD` with bullet points starting with verbs (Added, Fixed, Improved). Write user-friendly descriptions with a brief summary paragraph. Auto-parsed during `yarn ota`.

## i18n Rules
- Use `t('section.key')` from `@/text` for ALL user-visible strings (dev pages excepted)
- Check `common.*` for existing keys before adding new ones
- New strings MUST be added to ALL languages in `sources/text/translations/` (en, ru, pl, es, ca, it, pt, ja, zh-Hans)
- Key sections: `common.*`, `settings.*`, `session.*`, `errors.*`, `modals.*`, `components.*`
- Language metadata centralized in `sources/text/_all.ts`
- Always re-read translation files before adding new keys to understand existing structure
- Keep technical terms (CLI, API, URL, JSON) untranslated

## Unistyles Notes
- For `expo-image`: set `width`/`height` as inline styles, `tintColor` on component prop directly — never use unistyles for expo-image
- Use `useStyles` hook only for non-RN/non-reanimated components; provide styles directly otherwise

## App-Specific Rules
- Web is secondary platform; avoid web-specific code unless requested
- Set screen params in `_layout.tsx` to avoid layout shifts; never use custom headers or Stack.Screen options in individual pages
- Apply layout width constraints from `@/components/layout` to full-screen ScrollViews
- Use `ItemList` for most list containers; use `Item` component first before custom ones
- Use `Avatar` component for avatars
- Use `useHappyAction` for async operations (auto error handling)
- Create dedicated hooks in hooks folder with explanatory comments for non-trivial hooks
- Use `useGlobalKeyboard` for hotkeys (web only); use `AsyncLock` for exclusive async locks
- Core: never show loading errors — always retry; sync main data via "sync" class with `invalidate sync`
- Temporary scripts go in `sources/trash` folder
