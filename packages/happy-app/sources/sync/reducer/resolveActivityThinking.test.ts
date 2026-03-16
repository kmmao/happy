import { describe, it, expect } from 'vitest';
import { resolveActivityThinking } from './resolveActivityThinking';

describe('resolveActivityThinking', () => {
    // ─── Race 1: Stale heartbeat overwrites lifecycle event ─────────────
    describe('stale heartbeat must not overwrite lifecycle thinking state', () => {
        it('should keep thinking=true when lifecycle turn-start is newer than heartbeat', () => {
            // Lifecycle event just set thinking=true at t=5000
            // A stale heartbeat arrives with thinking=false at t=4800
            const result = resolveActivityThinking(
                { thinking: true, thinkingAt: 5000 },
                { active: true, activeAt: 4800, thinking: false },
            );

            expect(result.thinking).toBe(true);
            expect(result.thinkingAt).toBe(5000);
        });

        it('should keep thinking=false when lifecycle turn-end is newer than heartbeat', () => {
            // Lifecycle event set thinking=false (turn-end) at t=5000
            // A stale heartbeat arrives with thinking=true at t=4900
            const result = resolveActivityThinking(
                { thinking: false, thinkingAt: 5000 },
                { active: true, activeAt: 4900, thinking: true },
            );

            expect(result.thinking).toBe(false);
            expect(result.thinkingAt).toBe(5000);
        });

        it('should preserve thinkingAt so future stale heartbeats are also rejected', () => {
            // First stale heartbeat
            const result1 = resolveActivityThinking(
                { thinking: true, thinkingAt: 5000 },
                { active: true, activeAt: 4500, thinking: false },
            );
            expect(result1.thinkingAt).toBe(5000);

            // Second stale heartbeat with slightly newer activeAt — still stale
            const result2 = resolveActivityThinking(
                result1,
                { active: true, activeAt: 4900, thinking: false },
            );
            expect(result2.thinking).toBe(true);
            expect(result2.thinkingAt).toBe(5000);
        });
    });

    // ─── Race 2: Fresh heartbeat correctly updates thinking state ───────
    describe('fresh heartbeat should update thinking state normally', () => {
        it('should accept thinking=true from a heartbeat newer than lifecycle', () => {
            const result = resolveActivityThinking(
                { thinking: false, thinkingAt: 3000 },
                { active: true, activeAt: 5000, thinking: true },
            );

            expect(result.thinking).toBe(true);
            expect(result.thinkingAt).toBe(5000);
        });

        it('should accept thinking=false from a heartbeat newer than lifecycle', () => {
            const result = resolveActivityThinking(
                { thinking: true, thinkingAt: 3000 },
                { active: true, activeAt: 5000, thinking: false },
            );

            expect(result.thinking).toBe(false);
            // thinkingAt stays at lifecycle value since heartbeat is not thinking
            expect(result.thinkingAt).toBe(3000);
        });
    });

    // ─── Race 3: Session goes inactive ──────────────────────────────────
    describe('inactive session should clear thinking state', () => {
        it('should set thinking=false when session becomes inactive (fresh heartbeat)', () => {
            const result = resolveActivityThinking(
                { thinking: true, thinkingAt: 3000 },
                { active: false, activeAt: 5000, thinking: false },
            );

            expect(result.thinking).toBe(false);
        });

        it('should set thinking=false when inactive even if heartbeat says thinking=true', () => {
            // Edge case: active=false but thinking=true should still resolve to false
            const result = resolveActivityThinking(
                { thinking: true, thinkingAt: 3000 },
                { active: false, activeAt: 5000, thinking: true },
            );

            expect(result.thinking).toBe(false);
        });

        it('should NOT override lifecycle when stale inactive heartbeat arrives', () => {
            // Lifecycle just set thinking=true, but a stale session-end arrives
            const result = resolveActivityThinking(
                { thinking: true, thinkingAt: 5000 },
                { active: false, activeAt: 4000, thinking: false },
            );

            expect(result.thinking).toBe(true);
            expect(result.thinkingAt).toBe(5000);
        });
    });

    // ─── Race 4: Exact same timestamp (boundary condition) ──────────────
    describe('boundary: equal timestamps', () => {
        it('should use heartbeat value when timestamps are equal', () => {
            // When thinkingAt === activeAt, lifecycleIsNewer is false,
            // so heartbeat wins — this is correct because if they're concurrent,
            // the real-time heartbeat is the more up-to-date signal.
            const result = resolveActivityThinking(
                { thinking: true, thinkingAt: 5000 },
                { active: true, activeAt: 5000, thinking: false },
            );

            expect(result.thinking).toBe(false);
        });
    });

    // ─── Race 5: Rapid turn-start → turn-end sequence ───────────────────
    describe('rapid lifecycle transitions', () => {
        it('should handle turn-start then stale heartbeat then turn-end correctly', () => {
            // Step 1: turn-start sets thinking=true
            const afterTurnStart = { thinking: true, thinkingAt: 5000 };

            // Step 2: Stale heartbeat arrives — should be rejected
            const afterStaleHeartbeat = resolveActivityThinking(
                afterTurnStart,
                { active: true, activeAt: 4800, thinking: false },
            );
            expect(afterStaleHeartbeat.thinking).toBe(true);

            // Step 3: turn-end sets thinking=false (simulated by direct state)
            const afterTurnEnd = { thinking: false, thinkingAt: 5100 };

            // Step 4: Another stale heartbeat with thinking=true — should be rejected
            const afterStaleHeartbeat2 = resolveActivityThinking(
                afterTurnEnd,
                { active: true, activeAt: 5050, thinking: true },
            );
            expect(afterStaleHeartbeat2.thinking).toBe(false);

            // Step 5: Fresh heartbeat confirms thinking=false
            const afterFreshHeartbeat = resolveActivityThinking(
                afterTurnEnd,
                { active: true, activeAt: 5200, thinking: false },
            );
            expect(afterFreshHeartbeat.thinking).toBe(false);
        });
    });

    // ─── Race 6: thinkingAt=0 (initial state / fetchSessions) ───────────
    describe('initial state with thinkingAt=0', () => {
        it('should accept any heartbeat when session has thinkingAt=0', () => {
            // Fresh session from fetchSessions — thinkingAt=0
            const result = resolveActivityThinking(
                { thinking: false, thinkingAt: 0 },
                { active: true, activeAt: 1000, thinking: true },
            );

            expect(result.thinking).toBe(true);
            expect(result.thinkingAt).toBe(1000);
        });
    });

    // ─── Race 7: Multiple heartbeats advancing state correctly ──────────
    describe('sequential fresh heartbeats', () => {
        it('should track thinking state through a full cycle', () => {
            let state = { thinking: false, thinkingAt: 0 };

            // Heartbeat 1: idle
            state = resolveActivityThinking(state,
                { active: true, activeAt: 1000, thinking: false });
            expect(state.thinking).toBe(false);

            // Heartbeat 2: thinking starts
            state = resolveActivityThinking(state,
                { active: true, activeAt: 3000, thinking: true });
            expect(state.thinking).toBe(true);
            expect(state.thinkingAt).toBe(3000);

            // Heartbeat 3: still thinking
            state = resolveActivityThinking(state,
                { active: true, activeAt: 5000, thinking: true });
            expect(state.thinking).toBe(true);
            expect(state.thinkingAt).toBe(5000);

            // Heartbeat 4: thinking ends
            state = resolveActivityThinking(state,
                { active: true, activeAt: 7000, thinking: false });
            expect(state.thinking).toBe(false);
            // thinkingAt stays at last thinking timestamp
            expect(state.thinkingAt).toBe(5000);

            // Heartbeat 5: session disconnects
            state = resolveActivityThinking(state,
                { active: false, activeAt: 9000, thinking: false });
            expect(state.thinking).toBe(false);
        });
    });
});
