import type { CodexSessionConfig } from './types';

type CodexApprovalPolicy = NonNullable<CodexSessionConfig['approval-policy']>;
type CodexSandboxMode = NonNullable<CodexSessionConfig['sandbox']>;

export function resolveCodexExecutionPolicy(
    permissionMode: import('@/api/types').PermissionMode,
    sandboxManagedByHappy: boolean,
): {
    approvalPolicy?: CodexApprovalPolicy;
    sandbox?: CodexSandboxMode;
} {
    if (sandboxManagedByHappy) {
        return {
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        };
    }

    switch (permissionMode) {
        case 'default':
            // Respect the user's existing Codex configuration when no explicit
            // Happy override is requested.
            return {};
        case 'read-only':
            return {
                approvalPolicy: 'never',
                sandbox: 'read-only',
            };
        case 'safe-yolo':
            return {
                approvalPolicy: 'on-failure',
                sandbox: 'workspace-write',
            };
        case 'yolo':
            return {
                approvalPolicy: 'never',
                sandbox: 'danger-full-access',
            };
        case 'bypassPermissions':
            return {
                approvalPolicy: 'never',
                sandbox: 'danger-full-access',
            };
        case 'acceptEdits':
            return {
                approvalPolicy: 'on-request',
                sandbox: 'workspace-write',
            };
        case 'plan':
            return {
                approvalPolicy: 'untrusted',
                sandbox: 'workspace-write',
            };
        default:
            return {};
    }
}
