/**
 * Adjudicate a Decision: update status, create Knowledge precedent, notify.
 */

import { db } from "@/storage/db";
import { lawSuggestionApply } from "./lawSuggestionApply";
import { log } from "@/utils/log";
import { worldSuggestionRefresh } from "./worldSuggestionGenerate";
import { eventRouter, buildTaskTriggerEphemeral } from "@/app/events/eventRouter";
import { availableSlotsForRole } from "./roleConcurrencyCheck";

interface AdjudicateInput {
    decisionId: string;
    accountId: string;
    chosenOption: string;
    rationale?: string;
}

interface AdjudicateResult {
    decision: { id: string; status: string; knowledgeId: string | null };
}

export async function decisionAdjudicate(input: AdjudicateInput): Promise<AdjudicateResult> {
    const decision = await db.decision.findFirst({
        where: { id: input.decisionId, accountId: input.accountId, status: "pending" },
    });

    if (!decision) {
        throw new Error("Decision not found or already resolved");
    }

    // Parse options to get chosen option description
    let chosenDesc = input.chosenOption;
    try {
        const options = JSON.parse(decision.options) as Array<{ id: string; description: string }>;
        const chosen = options.find((o) => o.id === input.chosenOption);
        if (!chosen) {
            throw new Error("Invalid decision option");
        }
        chosenDesc = chosen.description;
    } catch (error) {
        if (error instanceof Error && error.message === "Invalid decision option") {
            throw error;
        }
        throw new Error("Decision options are invalid");
    }

    // Build precedent content
    const precedentContent = [
        `## Question`,
        decision.question,
        "",
        `## Decision`,
        `**Chosen**: ${chosenDesc}`,
        input.rationale ? `**Rationale**: ${input.rationale}` : "",
        "",
        decision.context ? `## Context\n${decision.context}` : "",
    ].filter(Boolean).join("\n");

    const precedentTitle = decision.question.length > 100
        ? `${decision.question.substring(0, 97)}...`
        : decision.question;

    // Create Knowledge precedent entry
    const knowledge = await db.projectKnowledge.create({
        data: {
            projectId: decision.projectId,
            entryType: "decision",
            category: "project",
            contributorType: "user",
            action: "create",
            status: "active",
            title: precedentTitle,
            content: precedentContent,
            tags: JSON.stringify(["precedent", ...(decision.precedentKey ? [decision.precedentKey] : [])]),
            confidence: "high",
            pinned: true,
        },
    });

    // Update Decision
    const updated = await db.decision.update({
        where: { id: decision.id },
        data: {
            status: "decided",
            chosenOption: input.chosenOption,
            rationale: input.rationale ?? null,
            knowledgeId: knowledge.id,
            decidedAt: new Date(),
        },
    });

    // Mark related inbox items as read
    await db.inboxItem.updateMany({
        where: {
            accountId: input.accountId,
            refType: "decision",
            refId: decision.id,
            read: false,
        },
        data: { read: true },
    });

    log({ module: "decision" }, `Decision ${decision.id} adjudicated → option "${input.chosenOption}", precedent ${knowledge.id}`);

    void worldSuggestionRefresh(input.accountId, decision.projectId);

    // Post-adjudication: handle law_suggestion approval
    void handleLawSuggestionIfApproved(decision.id, decision.projectId, input.accountId, input.chosenOption);

    // Resume tasks that were waiting on this decision
    void resumeWaitingTasks({
        decisionId: decision.id,
        projectId: decision.projectId,
        accountId: input.accountId,
        chosenOption: input.chosenOption,
        chosenDesc,
        rationale: input.rationale,
    });

    return {
        decision: {
            id: updated.id,
            status: updated.status,
            knowledgeId: knowledge.id,
        },
    };
}

/**
 * Resume tasks that were paused waiting for this decision.
 * Creates a continuation task that appends the decision result to the original
 * prompt, then cancels the paused task.
 */
async function resumeWaitingTasks(opts: {
    decisionId: string;
    projectId: string;
    accountId: string;
    chosenOption: string;
    chosenDesc: string;
    rationale?: string;
}): Promise<void> {
    const { decisionId, projectId, accountId, chosenOption, chosenDesc, rationale } = opts;

    const waitingTasks = await db.task.findMany({
        where: { waitingDecisionId: decisionId, status: "waiting_decision" },
    });

    if (waitingTasks.length === 0) return;

    for (const task of waitingTasks) {
        try {
            const decisionSummary = [
                "---",
                "## Decision Result",
                `A pending decision has been adjudicated. You may now continue your work.`,
                `**Decision**: ${chosenDesc} (option: ${chosenOption})`,
                rationale ? `**Rationale**: ${rationale}` : "",
            ].filter(Boolean).join("\n");

            const continuationPrompt = `${task.prompt}\n\n${decisionSummary}`;

            // Check concurrency slot for role
            let shouldDispatch = true;
            if (task.roleType && task.projectId) {
                const slots = await availableSlotsForRole({
                    accountId,
                    projectId,
                    roleType: task.roleType,
                });
                shouldDispatch = slots > 0;
            }

            const continuation = await db.task.create({
                data: {
                    accountId,
                    projectId: task.projectId ?? projectId,
                    machineId: task.machineId,
                    title: task.title,
                    prompt: continuationPrompt,
                    priority: task.priority,
                    maxAttempts: task.maxAttempts,
                    triggerType: task.triggerType,
                    status: shouldDispatch ? "dispatching" : "queued",
                    goalId: task.goalId,
                    roleType: task.roleType,
                    directory: task.directory,
                },
            });

            // Cancel the paused original task
            await db.task.update({
                where: { id: task.id },
                data: { status: "cancelled", completedAt: new Date() },
            });

            if (shouldDispatch) {
                const role = task.roleType
                    ? await db.agentRole.findFirst({
                          where: { accountId, projectId, type: task.roleType, enabled: true },
                          select: { agentType: true, modelOverride: true },
                      })
                    : null;

                eventRouter.emitEphemeral({
                    userId: accountId,
                    payload: buildTaskTriggerEphemeral({
                        taskId: continuation.id,
                        prompt: continuationPrompt,
                        directory: task.directory ?? "",
                        priority: task.priority,
                        projectId: task.projectId ?? undefined,
                        agentType: role?.agentType ?? null,
                        modelOverride: role?.modelOverride ?? null,
                    }),
                    recipientFilter: {
                        type: "machine-scoped-only",
                        machineId: task.machineId,
                    },
                });
            }

            log({ module: "decision" }, `Resumed task ${task.id} → continuation ${continuation.id} (dispatched=${shouldDispatch})`);
        } catch (err) {
            log({ module: "decision", level: "error" }, `Failed to resume task ${task.id}: ${err}`);
        }
    }
}

/**
 * If this Decision was created from a law_suggestion AgentMessage and the
 * chosen option is "approve", apply the suggested law to the project.
 */
async function handleLawSuggestionIfApproved(
    decisionId: string,
    projectId: string,
    accountId: string,
    chosenOption: string,
): Promise<void> {
    try {
        if (chosenOption !== "approve") return;

        const agentMessage = await db.agentMessage.findFirst({
            where: { decisionId, msgType: "law_suggestion" },
            select: { id: true, content: true },
        });

        if (!agentMessage) return;

        await lawSuggestionApply(projectId, accountId, agentMessage.content);

        await db.agentMessage.update({
            where: { id: agentMessage.id },
            data: { status: "resolved" },
        });

        log({ module: "decision" }, `Law suggestion ${agentMessage.id} approved and applied`);
    } catch (err) {
        log({ module: "decision", level: "error" }, `Failed to handle law suggestion post-adjudication: ${err}`);
    }
}
