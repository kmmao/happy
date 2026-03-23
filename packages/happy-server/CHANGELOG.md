# Changelog

## 2026-03-23

- Fix Socket.IO rpcListeners Map potential memory leak
- Fix supervisorScheduler unbounded findMany missing take limit
- Replace any types with unknown in webhook files
- Add Zod runtime validation to webhook parsers
- Add projectId+status composite index to SupervisorRun
- Parallelize serial DB queries in supervisorLoop detail endpoint
- Fix sessionCache batch update optimization
- Fix multiple findMany queries missing pagination limits
- Fix sessionCache.ts setInterval timer not calling unref()

## 2026-03-15

- Supervisor auto-fix detection and manual intervention
- Configurable analysis result limit (maxFindings)
- Fix supervisor action composite index
- Fix supervisor loop multiple issues
- Fix auto-approval checks and cost aggregation

## 2026-03-05

- Renamed from @slopus scope to @kmmao scope
- Session resume V2 — reuse same Happy session
- Added happy-wire session protocol migration

## 2026-02-20

- Voice pipeline overhaul with Edge TTS and web VAD
- WebSocket-based speech-to-text service
- Sync session preferences to server

## 2026-02-10

- Self-hosted STT service with faster-whisper
- Persist token usage across page refresh
- Fix per-call usage report storage
