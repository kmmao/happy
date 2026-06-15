/**
 * Workflow data-source change bus.
 *
 * Fires whenever any underlying list that feeds useWorkflows changes
 * (AgentLoops, WebhookTriggers, TriggerSchedules, future Workflow source
 * types). Create-modals call notifyWorkflowSourcesChanged() after a
 * successful POST so the workflow list reflects the new row immediately
 * instead of waiting for the next task-status throttle tick.
 *
 * useWorkflows is the only subscriber today; on notification it triggers
 * its throttledLoad() which refetches every source in one go. Singleton;
 * subscribers come and go freely.
 */

type WorkflowSourcesChangedListener = () => void;

const workflowSourcesChangedListeners = new Set<WorkflowSourcesChangedListener>();

export function onWorkflowSourcesChanged(
    listener: WorkflowSourcesChangedListener,
): () => void {
    workflowSourcesChangedListeners.add(listener);
    return () => {
        workflowSourcesChangedListeners.delete(listener);
    };
}

export function notifyWorkflowSourcesChanged(): void {
    for (const listener of workflowSourcesChangedListeners) {
        try {
            listener();
        } catch {
            // A misbehaving subscriber must not prevent the others from running.
        }
    }
}
