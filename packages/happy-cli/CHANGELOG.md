# Changelog

## 0.44.4 - 2026-03-21

- Fixed session restore causing messages to become unresponsive and cleared after 10 minutes

## 0.44.2 - 2026-03-20

- Fixed multiple supervisor loop issues

## 0.44.1 - 2026-03-19

- Fixed security issue: prevent remote users from extracting model config and API keys
- Updated dotenv from 16.x to 17.x
- Pinned claude-agent-sdk to exact version

## 0.44.0 - 2026-03-19

- Added Supervisor Loop Mode (autopilot analyze→fix→re-analyze cycles)
- Extracted shared supervisor utils with concurrency limits for fix/analysis sessions

## 0.43.0 - 2026-03-18

- Added preflight sync before supervisor analysis/research
- Fixed retry session spawn during build to prevent dist/ race condition

## 0.42.6 - 2026-03-17

- Replaced console.log with logger in CLI daemon-context code

## 0.42.5 - 2026-03-17

- Research actions now verified against codebase before creation

## 0.42.4 - 2026-03-16

- Research reports now generate actionable tasks

## 0.42.2 - 2026-03-16

- Fixed cold-restart on context window tier change (200K ↔ 1M)
