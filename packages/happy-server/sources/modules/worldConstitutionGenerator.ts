/**
 * Generate World Constitution elements (narrative, laws, roles, goals)
 * from project context.
 *
 * Two modes:
 * - "auto": Smart initialization — only generates missing elements.
 * - "custom": User provides a description; generates all elements based on it.
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";

// ── Types ──

interface GeneratedLaw {
    id: string;
    category: string;
    description: string;
    enabled: boolean;
    severity: string;
}

interface GeneratedRole {
    id: string;
    name: string;
    type: string;
    description: string;
    duties: string[];
}

interface GeneratedGoal {
    id: string;
    title: string;
    description: string;
    priority: string;
}

export interface WorldGenerateResult {
    narrative: string | null;
    laws: GeneratedLaw[] | null;
    roles: GeneratedRole[] | null;
    goals: GeneratedGoal[] | null;
    skipped: string[];
    errors: string[];
}

interface ProjectProfile {
    techStack?: string[];
    architectureType?: string;
    coreConventions?: string[];
    knownPitfalls?: string[];
}

// ── Helpers ──

function generateId(): string {
    return `law-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseProfile(content: string | null | undefined): ProjectProfile | null {
    if (!content) return null;
    try {
        return JSON.parse(content) as ProjectProfile;
    } catch {
        return null;
    }
}

function inferProjectName(path: string): string {
    const segments = path.replace(/\/$/, "").split("/");
    return segments[segments.length - 1] ?? "Project";
}

// ── Narrative Builder ──

function buildNarrative(
    projectName: string,
    profile: ProjectProfile | null,
    conventionTitles: string[],
    customPrompt?: string,
): string {
    const lines: string[] = [];

    if (customPrompt) {
        lines.push(customPrompt.trim());
        lines.push("");
        lines.push(`World: ${projectName}`);
        if (profile?.techStack && profile.techStack.length > 0) {
            lines.push(`Tech Stack: ${profile.techStack.slice(0, 8).join(", ")}`);
        }
        if (profile?.architectureType) {
            lines.push(`Architecture: ${profile.architectureType}`);
        }
    } else {
        lines.push(`${projectName} is a software world`);
        if (profile?.architectureType) {
            lines[0] += ` built with a ${profile.architectureType} architecture`;
        }
        if (profile?.techStack && profile.techStack.length > 0) {
            lines[0] += `, using ${profile.techStack.slice(0, 8).join(", ")}`;
        }
        lines[0] += ".";
    }

    lines.push("");
    lines.push("This world aims to maintain high code quality, security, and consistency across all contributions. Every agent session should respect the world's conventions and laws defined below.");

    if (conventionTitles.length > 0) {
        lines.push("");
        lines.push("Key conventions established through world history:");
        for (const title of conventionTitles.slice(0, 6)) {
            lines.push(`- ${title}`);
        }
    }

    if (profile?.knownPitfalls && profile.knownPitfalls.length > 0) {
        lines.push("");
        lines.push("Known pitfalls to avoid:");
        for (const pitfall of profile.knownPitfalls.slice(0, 4)) {
            lines.push(`- ${pitfall}`);
        }
    }

    return lines.join("\n");
}

// ── Laws Builder ──

function buildLaws(
    profile: ProjectProfile | null,
    conventions: Array<{ title: string }>,
    warnings: Array<{ title: string }>,
): GeneratedLaw[] {
    const laws: GeneratedLaw[] = [];

    // Quality
    laws.push({
        id: generateId(), category: "quality",
        description: "All new code must include corresponding tests. Test coverage should not decrease.",
        enabled: true, severity: "high",
    });
    laws.push({
        id: generateId(), category: "quality",
        description: "No commented-out code or debug statements in production code.",
        enabled: true, severity: "medium",
    });

    // Security
    laws.push({
        id: generateId(), category: "security",
        description: "Never commit secrets, API keys, or credentials. Use environment variables or secret management.",
        enabled: true, severity: "critical",
    });
    laws.push({
        id: generateId(), category: "security",
        description: "All user input must be validated and sanitized before processing.",
        enabled: true, severity: "high",
    });

    // Architecture
    laws.push({
        id: generateId(), category: "architecture",
        description: "Respect module boundaries. Do not create circular dependencies between packages or layers.",
        enabled: true, severity: "high",
    });

    // Convention
    laws.push({
        id: generateId(), category: "convention",
        description: "Follow existing code style and naming conventions. Use the world's configured formatter and linter.",
        enabled: true, severity: "medium",
    });

    // Process — PR and review discipline
    laws.push({
        id: generateId(), category: "process",
        description: "Pull requests should be focused and reasonably sized. Avoid mixing unrelated changes in a single PR.",
        enabled: true, severity: "medium",
    });

    // Ops — build and runtime health
    laws.push({
        id: generateId(), category: "ops",
        description: "CI builds must stay green. A failing build should be fixed before new feature work continues.",
        enabled: true, severity: "high",
    });

    // Knowledge-driven laws from conventions
    for (const conv of conventions.slice(0, 4)) {
        const desc = conv.title.length > 120 ? conv.title.substring(0, 117) + "..." : conv.title;
        laws.push({ id: generateId(), category: "convention", description: desc, enabled: true, severity: "medium" });
    }

    // Knowledge-driven laws from warnings
    for (const warn of warnings.slice(0, 3)) {
        const desc = warn.title.length > 120 ? warn.title.substring(0, 117) + "..." : warn.title;
        laws.push({ id: generateId(), category: "quality", description: desc, enabled: true, severity: "high" });
    }

    // Profile-specific convention laws
    if (profile?.coreConventions) {
        for (const convention of profile.coreConventions.slice(0, 3)) {
            if (convention.length < 10) continue;
            const exists = laws.some(
                (l) => l.description.toLowerCase().includes(convention.toLowerCase().substring(0, 30)),
            );
            if (exists) continue;
            laws.push({
                id: generateId(), category: "convention",
                description: convention.length > 120 ? convention.substring(0, 117) + "..." : convention,
                enabled: true, severity: "medium",
            });
        }
    }

    return laws;
}

// ── Roles Builder ──

const DEFAULT_ROLES: Array<{ name: string; type: string; description: string; duties: string[] }> = [
    {
        name: "Guardian", type: "guardian",
        description: "Protect code quality, security, and compliance with world laws.",
        duties: [
            "Scan for security vulnerabilities",
            "Verify compliance with world laws",
            "Check dependency updates and known CVEs",
        ],
    },
    {
        name: "Builder", type: "builder",
        description: "Implement features and write code according to specifications.",
        duties: [
            "Implement assigned tasks and features",
            "Write tests for new code",
            "Follow world conventions and style guides",
        ],
    },
    {
        name: "Healer", type: "healer",
        description: "Diagnose and fix issues, monitor health, and optimize performance.",
        duties: [
            "Fix failing tests and broken builds",
            "Diagnose and fix performance issues",
            "Fix reported bugs with minimal changes",
        ],
    },
    {
        name: "Chronicler", type: "chronicler",
        description: "Maintain this world's knowledge base, document changes, and summarize learnings.",
        duties: [
            "Maintain and update world documentation",
            "Record important decisions and their rationale",
            "Summarize session outcomes into knowledge entries",
        ],
    },
    {
        name: "Planner", type: "planner",
        description: "Analyze goals, break them into tasks, and create execution plans.",
        duties: [
            "Analyze high-level world goals",
            "Break goals into actionable tasks with estimates",
            "Prioritize task execution order and identify risks",
        ],
    },
    {
        name: "Messenger", type: "messenger",
        description: "Coordinate communication across roles and keep shared context aligned.",
        duties: [
            "Route requests and updates between roles with clear ownership",
            "Summarize key decisions and unresolved conflicts",
            "Ensure law suggestions and conflict reports reach the right reviewers",
        ],
    },
];

function buildRoles(_customPrompt?: string): Array<{ name: string; type: string; description: string; duties: string[] }> {
    return [...DEFAULT_ROLES];
}

// ── Goals Builder ──

function buildGoals(projectName: string, customPrompt?: string): Array<{ title: string; description: string; priority: string }> {
    const goals: Array<{ title: string; description: string; priority: string }> = [];

    if (customPrompt && customPrompt.length > 10) {
        goals.push({
            title: `Initialize ${projectName} world model`,
            description: `Set up the world model based on: ${customPrompt.substring(0, 200)}`,
            priority: "normal",
        });
    }

    goals.push({
        title: "Establish code quality baseline",
        description: "Run initial quality analysis, set up test coverage tracking, and identify existing technical debt.",
        priority: "normal",
    });

    goals.push({
        title: "Security audit",
        description: "Scan for known vulnerabilities, review dependency security, and ensure secrets management is in place.",
        priority: "urgent",
    });

    goals.push({
        title: "Knowledge base initialization",
        description: "Catalog existing world conventions, document architectural decisions, and seed the knowledge base for future agent reference.",
        priority: "normal",
    });

    return goals;
}

// ── Main Function ──

export async function generateWorldConstitution(
    projectId: string,
    accountId: string,
    opts: { mode: "auto" | "custom"; prompt?: string },
): Promise<WorldGenerateResult> {
    const project = await db.project.findFirst({
        where: { id: projectId, accountId },
        select: { path: true, narrative: true, laws: true },
    });
    if (!project) throw new Error("Project not found");

    const projectName = inferProjectName(project.path);
    const skipped: string[] = [];
    const errors: string[] = [];

    // Load context
    const profileRecord = await db.projectProfile.findUnique({
        where: { projectId },
        select: { content: true },
    });
    const profile = parseProfile(profileRecord?.content);

    const [conventions, warnings, existingRoles, existingGoals] = await Promise.all([
        db.projectKnowledge.findMany({
            where: { projectId, entryType: "convention", status: "active" },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { title: true },
        }),
        db.projectKnowledge.findMany({
            where: { projectId, entryType: "warning", status: "active" },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { title: true },
        }),
        db.agentRole.count({ where: { accountId, projectId } }),
        db.goal.count({ where: { accountId, projectId } }),
    ]);

    const isAuto = opts.mode === "auto";

    // ── Narrative ──
    let narrative: string | null = null;
    const hasNarrative = Boolean(project.narrative && project.narrative.trim().length > 0);
    if (isAuto && hasNarrative) {
        skipped.push("narrative");
    } else {
        narrative = buildNarrative(
            projectName,
            profile,
            conventions.map((c) => c.title),
            opts.prompt,
        );
    }

    // ── Laws ──
    let laws: GeneratedLaw[] | null = null;
    const hasLaws = Boolean(project.laws && project.laws.trim().length > 2);
    if (isAuto && hasLaws) {
        skipped.push("laws");
    } else {
        laws = buildLaws(profile, conventions, warnings);
    }

    // ── Roles ──
    let roles: GeneratedRole[] | null = null;
    if (isAuto && existingRoles > 0) {
        skipped.push("roles");
    } else {
        const roleDefs = buildRoles(opts.prompt);
        const createdRoles: GeneratedRole[] = [];

        // Fetch existing role names to avoid duplicates
        const existingNames = existingRoles > 0
            ? (await db.agentRole.findMany({
                where: { accountId, projectId },
                select: { name: true },
            })).map((r) => r.name.toLowerCase())
            : [];

        for (const def of roleDefs) {
            if (existingNames.includes(def.name.toLowerCase())) continue;
            try {
                const role = await db.agentRole.create({
                    data: {
                        accountId,
                        projectId,
                        name: def.name,
                        type: def.type,
                        description: def.description,
                        duties: JSON.stringify(def.duties),
                        skillIds: "[]",
                        maxConcurrency: 1,
                    },
                });
                createdRoles.push({
                    id: role.id,
                    name: role.name,
                    type: role.type,
                    description: role.description ?? "",
                    duties: def.duties,
                });
            } catch (e) {
                log({ module: "world-gen" }, `Failed to create role ${def.name}: ${e}`);
                errors.push(`role:${def.name}`);
            }
        }

        roles = createdRoles.length > 0 ? createdRoles : null;
        if (!roles) skipped.push("roles");
    }

    // ── Goals ──
    let goals: GeneratedGoal[] | null = null;

    // Find a machineId for goal creation
    const machine = await db.machine.findFirst({
        where: { accountId },
        select: { id: true },
        orderBy: { updatedAt: "desc" },
    });

    if (isAuto && existingGoals > 0) {
        skipped.push("goals");
    } else if (machine) {
        const goalDefs = buildGoals(projectName, opts.prompt);
        const createdGoals: GeneratedGoal[] = [];

        for (const def of goalDefs) {
            try {
                const goal = await db.goal.create({
                    data: {
                        accountId,
                        projectId,
                        machineId: machine.id,
                        title: def.title,
                        description: def.description,
                        priority: def.priority,
                        createdBy: "user",
                    },
                });
                createdGoals.push({
                    id: goal.id,
                    title: goal.title,
                    description: goal.description ?? "",
                    priority: goal.priority,
                });
            } catch (e) {
                log({ module: "world-gen" }, `Failed to create goal ${def.title}: ${e}`);
                errors.push(`goal:${def.title}`);
            }
        }

        goals = createdGoals.length > 0 ? createdGoals : null;
        if (!goals) skipped.push("goals");
    } else {
        skipped.push("goals");
    }

    return { narrative, laws, roles, goals, skipped, errors };
}
