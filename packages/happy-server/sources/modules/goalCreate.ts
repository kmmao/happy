/**
 * Create a Goal, associated InboxItem, and optionally dispatch a Planner Task.
 */

import { db } from "@/storage/db";
import { inboxCreate } from "./inboxCreate";
import {
    eventRouter,
    buildTaskTriggerEphemeral,
    buildGoalCreatedEphemeral,
} from "@/app/events/eventRouter";
import { log } from "@/utils/log";

interface GoalCreateInput {
    accountId: string;
    projectId: string;
    machineId: string;
    title: string;
    description?: string;
    priority?: string;
    deadline?: Date;
    parentGoalId?: string;
    autoDecompose?: boolean;
}

interface GoalCreateResult {
    id: string;
    plannerTaskId: string | null;
}

export async function goalCreate(input: GoalCreateInput): Promise<GoalCreateResult> {
    const {
        accountId,
        projectId,
        machineId,
        title,
        description,
        priority = "normal",
        deadline,
        parentGoalId,
        autoDecompose = true,
    } = input;

    // Validate parent goal if provided
    if (parentGoalId) {
        const parent = await db.goal.findFirst({
            where: { id: parentGoalId, accountId, projectId },
            select: { id: true },
        });
        if (!parent) {
            throw new Error("Parent goal not found");
        }
    }

    // Create the goal
    const goal = await db.goal.create({
        data: {
            accountId,
            projectId,
            machineId,
            title,
            description: description ?? null,
            priority,
            deadline: deadline ?? null,
            parentGoalId: parentGoalId ?? null,
            createdBy: "user",
        },
    });

    // Emit ephemeral to App
    eventRouter.emitEphemeral({
        userId: accountId,
        payload: buildGoalCreatedEphemeral({
            goalId: goal.id,
            projectId,
            title,
        }),
        recipientFilter: { type: "user-scoped-only" },
    });

    // Create InboxItem
    void inboxCreate({
        accountId,
        category: "goal",
        eventType: "goal.created",
        severity: "info",
        title: title.length > 80 ? `${title.substring(0, 77)}...` : title,
        body: `New goal created (priority: ${priority})`,
        referenceUrl: `/project/${projectId}/goals/${goal.id}`,
        refType: "goal",
        refId: goal.id,
        groupKey: `goal:${goal.id}:created`,
    });

    // Dispatch Planner Task if autoDecompose
    let plannerTaskId: string | null = null;
    if (autoDecompose) {
        plannerTaskId = await dispatchPlannerTask({
            accountId,
            projectId,
            machineId,
            goal,
        });

        if (plannerTaskId) {
            await db.goal.update({
                where: { id: goal.id },
                data: { plannerTaskId },
            });
        }
    }

    log({ module: "goal" }, `Created goal ${goal.id} for project ${projectId} (autoDecompose=${autoDecompose})`);

    return { id: goal.id, plannerTaskId };
}

// === Planner Task Dispatch ===

async function dispatchPlannerTask(opts: {
    accountId: string;
    projectId: string;
    machineId: string;
    goal: { id: string; title: string; description: string | null; priority: string; deadline: Date | null };
}): Promise<string | null> {
    const { accountId, projectId, machineId, goal } = opts;

    // Resolve project directory
    const project = await db.project.findFirst({
        where: { id: projectId, accountId },
        select: { path: true, narrative: true, laws: true },
    });
    if (!project) return null;

    // Find planner role and its bound skills
    const plannerRole = await db.agentRole.findFirst({
        where: { accountId, projectId, type: "planner", enabled: true },
        select: { name: true, skillIds: true },
    });

    // Load skills if role has bindings
    let skillContents: Array<{ name: string; content: string }> | undefined;
    if (plannerRole) {
        const skillIds: string[] = safeParseJsonArray(plannerRole.skillIds);
        if (skillIds.length > 0) {
            const skills = await db.skill.findMany({
                where: { id: { in: skillIds }, accountId, archived: false },
                orderBy: { name: "asc" },
            });
            if (skills.length > 0) {
                skillContents = skills.map((s) => ({ name: s.name, content: s.content }));
            }
        }
    }

    // Load existing roles for planner context
    const roles = await db.agentRole.findMany({
        where: { accountId, projectId, enabled: true },
        select: { name: true, type: true, duties: true },
    });

    // Build planner prompt
    const prompt = buildPlannerPrompt({
        projectId,
        goalId: goal.id,
        goalTitle: goal.title,
        goalDescription: goal.description,
        goalPriority: goal.priority,
        goalDeadline: goal.deadline?.toISOString(),
        projectNarrative: project.narrative,
        projectLaws: project.laws,
        roles: roles.map((r) => ({
            name: r.name,
            type: r.type,
            duties: safeParseJsonArray(r.duties),
        })),
    });

    // Create task
    const task = await db.task.create({
        data: {
            accountId,
            projectId,
            machineId,
            prompt,
            priority: goal.priority === "urgent" ? "urgent" : "user",
            maxAttempts: 2,
            triggerType: "manual",
            status: "dispatching",
            goalId: goal.id,
        },
    });

    // Dispatch to CLI
    eventRouter.emitEphemeral({
        userId: accountId,
        payload: buildTaskTriggerEphemeral({
            taskId: task.id,
            prompt,
            directory: project.path,
            priority: task.priority,
            projectId,
            skillContents,
        }),
        recipientFilter: {
            type: "machine-scoped-only",
            machineId,
        },
    });

    log({ module: "goal" }, `Dispatched planner task ${task.id} for goal ${goal.id}`);
    return task.id;
}

// === Planner Prompt Builder ===

function buildPlannerPrompt(opts: {
    projectId: string;
    goalId: string;
    goalTitle: string;
    goalDescription: string | null;
    goalPriority: string;
    goalDeadline?: string;
    projectNarrative: string | null;
    projectLaws: string | null;
    roles: Array<{ name: string; type: string; duties: string[] }>;
}): string {
    const sections: string[] = [];

    sections.push("# Goal Decomposition Task");
    sections.push("");
    sections.push("You are a **Planner Agent**. Your job is to analyze the codebase, decompose a high-level goal into actionable sub-tasks, and report the plan back to the server.");
    sections.push("");

    // Rules
    sections.push("## Rules (CRITICAL)");
    sections.push("1. **DO NOT modify any files.** This is an analysis-only session.");
    sections.push("2. **DO NOT create commits, branches, or PRs.**");
    sections.push("3. You MAY read files and run diagnostic commands to understand the codebase.");
    sections.push("");

    // Goal info
    sections.push("## Goal");
    sections.push(`- **Title**: ${opts.goalTitle}`);
    if (opts.goalDescription) {
        sections.push(`- **Description**: ${opts.goalDescription}`);
    }
    sections.push(`- **Priority**: ${opts.goalPriority}`);
    if (opts.goalDeadline) {
        sections.push(`- **Deadline**: ${opts.goalDeadline}`);
    }
    sections.push(`- **Goal ID**: ${opts.goalId}`);
    sections.push("");

    // Project context
    if (opts.projectNarrative) {
        sections.push("## Project Narrative");
        sections.push(opts.projectNarrative);
        sections.push("");
    }

    if (opts.projectLaws) {
        sections.push("## Project Laws");
        sections.push("Ensure all sub-tasks comply with these laws:");
        sections.push(opts.projectLaws);
        sections.push("");
    }

    // Available roles
    if (opts.roles.length > 0) {
        sections.push("## Available Roles");
        for (const role of opts.roles) {
            const duties = role.duties.length > 0 ? ` — duties: ${role.duties.join(", ")}` : "";
            sections.push(`- **${role.name}** (${role.type})${duties}`);
        }
        sections.push("");
    }

    // Instructions
    sections.push("## Instructions");
    sections.push("");
    sections.push("1. Read the project structure and key files to understand the codebase");
    sections.push("2. Analyze the goal in context of the existing code");
    sections.push("3. Break the goal into 3-8 concrete, actionable sub-tasks");
    sections.push("4. For each sub-task, write a detailed prompt and suggest the most appropriate role");
    sections.push("5. Order tasks by dependency (independent tasks first)");
    sections.push("6. Report the plan to the server via curl (see below)");
    sections.push("7. Send /exit to end this session");
    sections.push("");

    // Output format
    const exampleJson = JSON.stringify({
        goalId: opts.goalId,
        tasks: [
            {
                title: "Task title",
                prompt: "Detailed prompt for the agent to execute this task. Include specific file paths and requirements discovered during analysis.",
                suggestedRole: "builder",
                priority: "normal",
                order: 1,
            },
        ],
    }, null, 2);

    sections.push("## MANDATORY: Report Plan Results (CRITICAL)");
    sections.push("");
    sections.push("After analyzing the codebase and creating your plan, you MUST report it to the server.");
    sections.push("Write the plan JSON to a temp file, then POST it:");
    sections.push("");
    sections.push("```");
    sections.push(`cat > /tmp/planner-result-${opts.goalId}.json << 'PLANNER_EOF'`);
    sections.push(exampleJson);
    sections.push("PLANNER_EOF");
    sections.push("");
    sections.push(`curl -s -X POST "$HAPPY_TASK_SERVER_URL/v1/projects/${opts.projectId}/goals/${opts.goalId}/plan-result" \\`);
    sections.push(`  -H "Authorization: Bearer $HAPPY_TASK_AUTH_TOKEN" \\`);
    sections.push(`  -H "Content-Type: application/json" \\`);
    sections.push(`  -d @/tmp/planner-result-${opts.goalId}.json`);
    sections.push("");
    sections.push(`rm -f /tmp/planner-result-${opts.goalId}.json`);
    sections.push("```");
    sections.push("");
    sections.push("**Important**: Replace the example tasks array with your actual decomposition. Each task's `prompt` should be detailed enough for another agent to execute independently.");
    sections.push("");
    sections.push("After successfully reporting, send /exit to end this session.");
    sections.push("");
    sections.push("If curl fails, try again once. If still failing, output the JSON in a code block so a human can submit it manually.");
    sections.push("");
    sections.push("Begin your analysis now.");

    return sections.join("\n");
}

// === Helpers ===

function safeParseJsonArray(json: string): string[] {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
