import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGoalDetail, fetchGoals } from './apiProjects';
import type { AuthCredentials } from '@/auth/tokenStorage';

vi.mock('./serverConfig', () => ({
    getServerUrl: () => 'https://api.test.com',
}));

vi.mock('@/utils/time', () => ({
    backoff: vi.fn((fn) => fn()),
}));

describe('apiProjects', () => {
    const credentials: AuthCredentials = {
        token: 'test-token',
        secret: 'test-secret',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('fetchGoals', () => {
        it('should reject invalid goals response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    goals: [{ id: 'goal-1', status: 'bad-status' }],
                    total: 1,
                }),
            } as any);

            await expect(fetchGoals(credentials, 'project-1'))
                .rejects.toThrow('Invalid goals response');
        });

        it('should parse agent blocker summary fields', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    goals: [
                        {
                            id: 'goal-1',
                            projectId: 'project-1',
                            title: 'Goal 1',
                            description: null,
                            status: 'blocked',
                            progress: 25,
                            priority: 'normal',
                            deadline: null,
                            parentGoalId: null,
                            machineId: 'machine-1',
                            createdBy: 'user',
                            plannerTaskId: null,
                            createdAt: 1,
                            updatedAt: 2,
                            subGoalCount: 0,
                            taskCount: 1,
                            decisionCount: 1,
                            taskStatusSummary: {
                                dispatching: 0,
                                queued: 0,
                                running: 0,
                                completed: 0,
                                failed: 0,
                                cancelled: 0,
                            },
                            latestSession: null,
                            blocker: {
                                kind: 'agent_conflict',
                                summary: 'builder conflict: Need decision on API migration direction',
                                requiresHuman: true,
                                sourceMessageId: 'msg-1',
                                sessionId: 'session-1',
                                decisionId: 'decision-1',
                                messageStatus: 'unread',
                            },
                            tasks: [],
                        },
                    ],
                    total: 1,
                }),
            } as any);

            const result = await fetchGoals(credentials, 'project-1');

            expect(result[0]?.blocker).toEqual({
                kind: 'agent_conflict',
                summary: 'builder conflict: Need decision on API migration direction',
                requiresHuman: true,
                sourceMessageId: 'msg-1',
                sessionId: 'session-1',
                decisionId: 'decision-1',
                messageStatus: 'unread',
            });
        });
    });

    describe('fetchGoalDetail', () => {
        it('should fetch goal detail', async () => {
            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    goal: {
                        id: 'goal-1',
                        projectId: 'project-1',
                        title: 'Goal 1',
                        description: 'desc',
                        status: 'in_progress',
                        progress: 50,
                        priority: 'normal',
                        deadline: null,
                        parentGoalId: null,
                        machineId: 'machine-1',
                        createdBy: 'user',
                        plannerTaskId: null,
                        createdAt: 1,
                        updatedAt: 2,
                        subGoalCount: 1,
                        taskCount: 2,
                        decisionCount: 1,
                        taskStatusSummary: {
                            dispatching: 0,
                            queued: 0,
                            running: 1,
                            completed: 1,
                            failed: 0,
                            cancelled: 0,
                        },
                        latestSession: {
                            sessionId: 'session-1',
                            taskId: 'task-1',
                            taskTitle: 'Implement part',
                            status: 'running',
                            updatedAt: 2,
                        },
                        blocker: {
                            kind: 'task_failed',
                            summary: 'Task failed: Implement part',
                            sourceTaskId: 'task-1',
                            requiresHuman: false,
                        },
                        tasks: [
                            {
                                id: 'task-1',
                                title: 'Implement part',
                                status: 'running',
                                sessionId: 'session-1',
                                roleType: 'builder',
                                promptPreview: 'Prompt',
                                priority: 'user',
                                createdAt: 1,
                                completedAt: null,
                            },
                        ],
                        subGoals: [
                            {
                                id: 'subgoal-1',
                                title: 'Sub Goal',
                                status: 'planning',
                                progress: 0,
                                priority: 'normal',
                            },
                        ],
                        blockers: [
                            {
                                kind: 'agent_conflict',
                                summary: 'builder conflict: Need decision on API migration direction',
                                requiresHuman: true,
                                sourceMessageId: 'msg-1',
                                sessionId: 'session-1',
                                decisionId: 'decision-1',
                                messageStatus: 'unread',
                            },
                        ],
                        decisions: [
                            {
                                id: 'decision-1',
                                question: 'Choose approach?',
                                status: 'pending',
                                createdAt: 3,
                            },
                        ],
                    },
                }),
            };
            global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

            const result = await fetchGoalDetail(credentials, 'project-1', 'goal-1');

            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.test.com/v1/projects/project-1/goals/goal-1',
                {
                    headers: {
                        Authorization: 'Bearer test-token',
                        'Content-Type': 'application/json',
                    },
                },
            );
            expect(result.id).toBe('goal-1');
            expect(result.subGoals).toHaveLength(1);
            expect(result.blockers).toHaveLength(1);
            expect(result.blockers[0]?.decisionId).toBe('decision-1');
            expect(result.blockers[0]?.messageStatus).toBe('unread');
            expect(result.decisions).toHaveLength(1);
            expect(result.tasks[0]?.sessionId).toBe('session-1');
        });

        it('should reject invalid goal detail response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    goal: {
                        id: 'goal-1',
                        projectId: 'project-1',
                        title: 'Goal 1',
                        description: 'desc',
                        status: 'not-a-real-status',
                    },
                }),
            } as any);

            await expect(fetchGoalDetail(credentials, 'project-1', 'goal-1'))
                .rejects.toThrow('Invalid goal detail response');
        });

        it('should throw when server returns error', async () => {
            global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as any);

            await expect(fetchGoalDetail(credentials, 'project-1', 'goal-404'))
                .rejects.toThrow('Failed to fetch goal detail: 404');
        });
    });
});
