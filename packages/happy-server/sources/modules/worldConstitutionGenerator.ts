/**
 * Generate World Constitution elements (narrative, laws, roles, member, goal)
 * from project context.
 *
 * Two modes:
 * - "auto": Smart initialization — only generates missing elements.
 * - "custom": User provides a description; generates all elements based on it.
 *
 * Selective generation:
 * - `elements`: Optional whitelist of element types to generate.
 *   When provided, only those elements are generated (even if they already exist = reset).
 *   When omitted, auto/custom logic determines what to generate.
 *
 * Text language: "en" | "zh" (matches app appearance language: Chinese variants → zh, else en).
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { auditLog } from "./worldAuditLog";

// ── Types ──

export type WorldContentLanguage = "en" | "zh";

export type WorldElement = "narrative" | "laws" | "roles" | "member" | "goal";

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

interface GeneratedMember {
    id: string;
    role: string;
    maxConcurrency: number;
}

interface GeneratedGoal {
    id: string;
    title: string;
    priority: string;
    layer: string;
}

export interface WorldGenerateResult {
    narrative: string | null;
    laws: GeneratedLaw[] | null;
    roles: GeneratedRole[] | null;
    member: GeneratedMember | null;
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
    lang: WorldContentLanguage,
    projectName: string,
    profile: ProjectProfile | null,
    conventionTitles: string[],
    customPrompt?: string,
): string {
    const lines: string[] = [];

    if (customPrompt) {
        lines.push(customPrompt.trim());
        lines.push("");
        if (lang === "zh") {
            lines.push(`世界：${projectName}`);
            if (profile?.techStack && profile.techStack.length > 0) {
                lines.push(`技术栈：${profile.techStack.slice(0, 8).join("、")}`);
            }
            if (profile?.architectureType) {
                lines.push(`架构：${profile.architectureType}`);
            }
        } else {
            lines.push(`World: ${projectName}`);
            if (profile?.techStack && profile.techStack.length > 0) {
                lines.push(`Tech Stack: ${profile.techStack.slice(0, 8).join(", ")}`);
            }
            if (profile?.architectureType) {
                lines.push(`Architecture: ${profile.architectureType}`);
            }
        }
    } else {
        if (lang === "zh") {
            let first = `${projectName} 是一个软件世界`;
            if (profile?.architectureType) {
                first += `，采用 ${profile.architectureType} 架构`;
            }
            if (profile?.techStack && profile.techStack.length > 0) {
                first += `，使用 ${profile.techStack.slice(0, 8).join("、")}`;
            }
            first += "。";
            lines.push(first);
        } else {
            let first = `${projectName} is a software world`;
            if (profile?.architectureType) {
                first += ` built with a ${profile.architectureType} architecture`;
            }
            if (profile?.techStack && profile.techStack.length > 0) {
                first += `, using ${profile.techStack.slice(0, 8).join(", ")}`;
            }
            first += ".";
            lines.push(first);
        }
    }

    lines.push("");
    if (lang === "zh") {
        lines.push(
            "本世界致力于在所有贡献中保持较高的代码质量、安全性与一致性。每个 agent 会话都应遵守下方定义的世界约定与法则。",
        );
        lines.push("");
        lines.push(
            "语言说明：本世界的叙事、法则与默认角色描述与维护者在应用「设置 → 外观 → 语言」中的选择一致，当前为中文。请在本世界中以中文撰写说明、评审意见与文档类内容（代码与标识符仍遵循仓库既有惯例）。",
        );
        lines.push("");
        lines.push(
            "协作模型：叙事与法则构成全部会话的共享基础，在任何代理协作中均应持续遵守。已记录的正式决策、各角色的完整说明与职责、以及角色间消息等，仅在对应工作流需要时由系统检索或注入；除非当前上下文中明确出现，请勿假定已获知这些内容。",
        );
    } else {
        lines.push(
            "This world aims to maintain high code quality, security, and consistency across all contributions. Every agent session should respect the world's conventions and laws defined below.",
        );
        lines.push("");
        lines.push(
            "Language: The narrative, laws, and default role descriptions match the maintainer's choice under Settings → Appearance → Language (English). Use English for explanations, review comments, and documentation in this world (code and identifiers follow existing repository conventions).",
        );
        lines.push("");
        lines.push(
            "Collaboration model: The narrative and laws are the shared foundation for every session in this world. Formal decisions, full role definitions, and inter-role messages are retrieved or injected only when a workflow needs them — do not assume you have seen them unless they appear explicitly in your current context.",
        );
    }

    if (conventionTitles.length > 0) {
        lines.push("");
        if (lang === "zh") {
            lines.push("通过世界历史形成的关键约定：");
        } else {
            lines.push("Key conventions established through world history:");
        }
        for (const title of conventionTitles.slice(0, 6)) {
            lines.push(`- ${title}`);
        }
    }

    if (profile?.knownPitfalls && profile.knownPitfalls.length > 0) {
        lines.push("");
        if (lang === "zh") {
            lines.push("需要避免的已知陷阱：");
        } else {
            lines.push("Known pitfalls to avoid:");
        }
        for (const pitfall of profile.knownPitfalls.slice(0, 4)) {
            lines.push(`- ${pitfall}`);
        }
    }

    return lines.join("\n");
}

// ── Laws Builder ──

function lawTemplates(lang: WorldContentLanguage): Array<Pick<GeneratedLaw, "category" | "description" | "severity">> {
    if (lang === "zh") {
        return [
            { category: "quality", description: "新增代码须包含相应测试，测试覆盖率不得下降。", severity: "high" },
            { category: "quality", description: "生产代码中不得保留注释掉的代码或调试输出。", severity: "medium" },
            {
                category: "security",
                description: "禁止提交密钥、API 密钥或凭证；应使用环境变量或密钥管理方案。",
                severity: "critical",
            },
            { category: "security", description: "所有用户输入在处理前必须经过校验与清理。", severity: "high" },
            {
                category: "architecture",
                description: "遵守模块边界，不得在包或层级之间形成循环依赖。",
                severity: "high",
            },
            {
                category: "convention",
                description: "遵循既有代码风格与命名约定，使用世界配置的格式化与静态检查工具。",
                severity: "medium",
            },
            {
                category: "process",
                description: "合并请求应聚焦且体量合理，避免在同一 PR 中混杂无关改动。",
                severity: "medium",
            },
            {
                category: "ops",
                description: "持续集成须保持通过；构建失败应先修复再继续新功能开发。",
                severity: "high",
            },
        ];
    }
    return [
        {
            category: "quality",
            description: "All new code must include corresponding tests. Test coverage should not decrease.",
            severity: "high",
        },
        {
            category: "quality",
            description: "No commented-out code or debug statements in production code.",
            severity: "medium",
        },
        {
            category: "security",
            description: "Never commit secrets, API keys, or credentials. Use environment variables or secret management.",
            severity: "critical",
        },
        {
            category: "security",
            description: "All user input must be validated and sanitized before processing.",
            severity: "high",
        },
        {
            category: "architecture",
            description: "Respect module boundaries. Do not create circular dependencies between packages or layers.",
            severity: "high",
        },
        {
            category: "convention",
            description: "Follow existing code style and naming conventions. Use the world's configured formatter and linter.",
            severity: "medium",
        },
        {
            category: "process",
            description: "Pull requests should be focused and reasonably sized. Avoid mixing unrelated changes in a single PR.",
            severity: "medium",
        },
        {
            category: "ops",
            description: "CI builds must stay green. A failing build should be fixed before new feature work continues.",
            severity: "high",
        },
    ];
}

function buildLaws(
    lang: WorldContentLanguage,
    profile: ProjectProfile | null,
    conventions: Array<{ title: string }>,
    warnings: Array<{ title: string }>,
): GeneratedLaw[] {
    const laws: GeneratedLaw[] = [];

    for (const t of lawTemplates(lang)) {
        laws.push({ id: generateId(), category: t.category, description: t.description, enabled: true, severity: t.severity });
    }

    for (const conv of conventions.slice(0, 4)) {
        const desc = conv.title.length > 120 ? conv.title.substring(0, 117) + "..." : conv.title;
        laws.push({ id: generateId(), category: "convention", description: desc, enabled: true, severity: "medium" });
    }

    for (const warn of warnings.slice(0, 3)) {
        const desc = warn.title.length > 120 ? warn.title.substring(0, 117) + "..." : warn.title;
        laws.push({ id: generateId(), category: "quality", description: desc, enabled: true, severity: "high" });
    }

    if (profile?.coreConventions) {
        for (const convention of profile.coreConventions.slice(0, 3)) {
            if (convention.length < 10) continue;
            const exists = laws.some(
                (l) => l.description.toLowerCase().includes(convention.toLowerCase().substring(0, 30)),
            );
            if (exists) continue;
            laws.push({
                id: generateId(),
                category: "convention",
                description: convention.length > 120 ? convention.substring(0, 117) + "..." : convention,
                enabled: true,
                severity: "medium",
            });
        }
    }

    return laws;
}

// ── Roles Builder ──

/** Default agentType per role type. null = inherit from CLI active profile. */
const ROLE_AGENT_TYPE: Record<string, string | null> = {
    guardian: "claude",
    builder: "claude",
    healer: "claude",
    chronicler: "claude",
    planner: "claude",
    messenger: null,
};

function defaultRoles(lang: WorldContentLanguage): Array<{ name: string; type: string; description: string; duties: string[]; agentType: string | null }> {
    if (lang === "zh") {
        return [
            {
                name: "守护者",
                type: "guardian",
                description: "守护代码质量、安全性并确保遵守世界法则。",
                duties: ["扫描安全漏洞", "核对是否符合世界法则", "检查依赖更新与已知 CVE"],
                agentType: ROLE_AGENT_TYPE.guardian,
            },
            {
                name: "建造者",
                type: "builder",
                description: "按规格实现功能并编写代码。",
                duties: ["实现分配的任务与功能", "为新代码编写测试", "遵守世界约定与风格指南"],
                agentType: ROLE_AGENT_TYPE.builder,
            },
            {
                name: "治愈者",
                type: "healer",
                description: "诊断与修复问题，监控健康并优化性能。",
                duties: ["修复失败测试与构建中断", "诊断并修复性能问题", "以最小改动修复缺陷"],
                agentType: ROLE_AGENT_TYPE.healer,
            },
            {
                name: "编年史官",
                type: "chronicler",
                description: "维护世界知识库，记录变更并总结学习成果。",
                duties: ["维护并更新世界文档", "记录重要决策及理由", "将会话结果整理为知识条目"],
                agentType: ROLE_AGENT_TYPE.chronicler,
            },
            {
                name: "规划者",
                type: "planner",
                description: "分析目标，拆解任务并制定执行计划。",
                duties: ["分析高层世界目标", "将目标拆为可执行任务并估算", "排定执行顺序并识别风险"],
                agentType: ROLE_AGENT_TYPE.planner,
            },
            {
                name: "信使",
                type: "messenger",
                description: "协调各角色沟通并保持共享上下文一致。",
                duties: ["在角色间传递请求与更新并明确负责人", "总结关键决策与未解决冲突", "确保法则建议与冲突报告送达合适评审人"],
                agentType: ROLE_AGENT_TYPE.messenger,
            },
        ];
    }
    return [
        {
            name: "Guardian",
            type: "guardian",
            description: "Protect code quality, security, and compliance with world laws.",
            duties: [
                "Scan for security vulnerabilities",
                "Verify compliance with world laws",
                "Check dependency updates and known CVEs",
            ],
            agentType: ROLE_AGENT_TYPE.guardian,
        },
        {
            name: "Builder",
            type: "builder",
            description: "Implement features and write code according to specifications.",
            duties: [
                "Implement assigned tasks and features",
                "Write tests for new code",
                "Follow world conventions and style guides",
            ],
            agentType: ROLE_AGENT_TYPE.builder,
        },
        {
            name: "Healer",
            type: "healer",
            description: "Diagnose and fix issues, monitor health, and optimize performance.",
            duties: [
                "Fix failing tests and broken builds",
                "Diagnose and fix performance issues",
                "Fix reported bugs with minimal changes",
            ],
            agentType: ROLE_AGENT_TYPE.healer,
        },
        {
            name: "Chronicler",
            type: "chronicler",
            description: "Maintain this world's knowledge base, document changes, and summarize learnings.",
            duties: [
                "Maintain and update world documentation",
                "Record important decisions and their rationale",
                "Summarize session outcomes into knowledge entries",
            ],
            agentType: ROLE_AGENT_TYPE.chronicler,
        },
        {
            name: "Planner",
            type: "planner",
            description: "Analyze goals, break them into tasks, and create execution plans.",
            duties: [
                "Analyze high-level world goals",
                "Break goals into actionable tasks with estimates",
                "Prioritize task execution order and identify risks",
            ],
            agentType: ROLE_AGENT_TYPE.planner,
        },
        {
            name: "Messenger",
            type: "messenger",
            description: "Coordinate communication across roles and keep shared context aligned.",
            duties: [
                "Route requests and updates between roles with clear ownership",
                "Summarize key decisions and unresolved conflicts",
                "Ensure law suggestions and conflict reports reach the right reviewers",
            ],
            agentType: ROLE_AGENT_TYPE.messenger,
        },
    ];
}

function buildRoles(lang: WorldContentLanguage): Array<{ name: string; type: string; description: string; duties: string[]; agentType: string | null }> {
    return [...defaultRoles(lang)];
}

// ── Default Goal Templates ──

function defaultGoalTemplates(lang: WorldContentLanguage): Array<{ title: string; priority: string }> {
    if (lang === "zh") {
        return [
            { title: "建立并维护全面的测试覆盖率", priority: "normal" },
            { title: "审查并加固安全防线", priority: "normal" },
        ];
    }
    return [
        { title: "Establish and maintain comprehensive test coverage", priority: "normal" },
        { title: "Review and harden security posture", priority: "normal" },
    ];
}

// ── WorldMember Owner Defaults ──

const OWNER_DEFAULTS = {
    role: "owner" as const,
    lawAuthority: "create",
    decisionScope: "all",
    goalAuthority: "create",
    notifyLevel: "all",
    maxConcurrency: 10,
};

// ── Main Function ──

export async function generateWorldConstitution(
    projectId: string,
    accountId: string,
    opts: {
        mode: "auto" | "custom";
        prompt?: string;
        contentLanguage?: WorldContentLanguage;
        elements?: WorldElement[];
    },
): Promise<WorldGenerateResult> {
    const lang: WorldContentLanguage = opts.contentLanguage === "zh" ? "zh" : "en";

    const project = await db.project.findFirst({
        where: { id: projectId, accountId },
        select: { path: true, narrative: true, laws: true },
    });
    if (!project) throw new Error("Project not found");

    const projectName = inferProjectName(project.path);
    const skipped: string[] = [];
    const errors: string[] = [];

    // When elements is provided, only generate those elements (force-generate even if exist)
    const elementSet = opts.elements ? new Set(opts.elements) : null;
    const shouldGenerate = (el: WorldElement, existsCheck: boolean): boolean => {
        if (elementSet) return elementSet.has(el);
        // Original auto/custom logic
        return opts.mode === "custom" || !existsCheck;
    };

    const profileRecord = await db.projectProfile.findUnique({
        where: { projectId },
        select: { content: true },
    });
    const profile = parseProfile(profileRecord?.content);

    const [conventions, warnings, existingRoleCount] = await Promise.all([
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
    ]);

    // ── Narrative ──

    let narrative: string | null = null;
    const hasNarrative = Boolean(project.narrative && project.narrative.trim().length > 0);
    if (shouldGenerate("narrative", hasNarrative)) {
        narrative = buildNarrative(
            lang,
            projectName,
            profile,
            conventions.map((c) => c.title),
            opts.prompt,
        );
    } else {
        skipped.push("narrative");
    }

    // ── Laws ──

    let laws: GeneratedLaw[] | null = null;
    const hasLaws = Boolean(project.laws && project.laws.trim().length > 2);
    if (shouldGenerate("laws", hasLaws)) {
        laws = buildLaws(lang, profile, conventions, warnings);
    } else {
        skipped.push("laws");
    }

    // ── Roles ──

    let roles: GeneratedRole[] | null = null;
    if (shouldGenerate("roles", existingRoleCount > 0)) {
        // When resetting roles, delete existing ones first
        if (elementSet?.has("roles") && existingRoleCount > 0) {
            await db.agentRole.deleteMany({ where: { accountId, projectId } });
        }

        const roleDefs = buildRoles(lang);
        const createdRoles: GeneratedRole[] = [];

        const existingNames =
            existingRoleCount > 0 && !elementSet?.has("roles")
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
                        agentType: def.agentType,
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
    } else {
        skipped.push("roles");
    }

    // ── WorldMember (owner) ──

    let member: GeneratedMember | null = null;
    const existingMember = await db.worldMember.findUnique({
        where: { accountId_projectId: { accountId, projectId } },
        select: { id: true },
    });
    if (shouldGenerate("member", existingMember != null)) {
        try {
            if (existingMember && elementSet?.has("member")) {
                // Reset: update existing member to owner defaults
                const updated = await db.worldMember.update({
                    where: { id: existingMember.id },
                    data: OWNER_DEFAULTS,
                });
                member = { id: updated.id, role: updated.role, maxConcurrency: updated.maxConcurrency };
            } else if (!existingMember) {
                // Create new owner record
                const created = await db.worldMember.create({
                    data: {
                        accountId,
                        projectId,
                        ...OWNER_DEFAULTS,
                    },
                });
                member = { id: created.id, role: created.role, maxConcurrency: created.maxConcurrency };
            } else {
                // Auto mode + member already exists → skip
                skipped.push("member");
            }
        } catch (e) {
            log({ module: "world-gen" }, `Failed to create/update owner member: ${e}`);
            errors.push("member");
        }
    } else {
        skipped.push("member");
    }

    // ── Goals ──

    let goals: GeneratedGoal[] | null = null;
    const existingGoalCount = await db.goal.count({ where: { accountId, projectId } });
    if (shouldGenerate("goal", existingGoalCount > 0)) {
        const goalTemplates = defaultGoalTemplates(lang);
        const createdGoals: GeneratedGoal[] = [];

        // Find a machine for this account+project (needed for goal creation)
        const machine = await db.machine.findFirst({
            where: { accountId, active: true },
            select: { id: true },
            orderBy: { lastActiveAt: "desc" },
        });

        if (machine) {
            for (const tmpl of goalTemplates) {
                try {
                    const goal = await db.goal.create({
                        data: {
                            accountId,
                            projectId,
                            machineId: machine.id,
                            title: tmpl.title,
                            priority: tmpl.priority,
                            createdBy: "system",
                            layer: "strategic",
                        },
                    });
                    createdGoals.push({
                        id: goal.id,
                        title: goal.title,
                        priority: goal.priority,
                        layer: goal.layer ?? "strategic",
                    });
                } catch (e) {
                    log({ module: "world-gen" }, `Failed to create goal "${tmpl.title}": ${e}`);
                    errors.push(`goal:${tmpl.title}`);
                }
            }
        } else {
            errors.push("goal:no-active-machine");
        }

        goals = createdGoals.length > 0 ? createdGoals : null;
        if (!goals) skipped.push("goal");
    } else {
        skipped.push("goal");
    }

    // ── Audit log ──
    const generated: string[] = [];
    if (narrative) generated.push("narrative");
    if (laws) generated.push("laws");
    if (roles) generated.push("roles");
    if (member) generated.push("member");
    if (goals) generated.push("goals");

    if (generated.length > 0) {
        void auditLog({
            accountId,
            projectId,
            memberId: member?.id ?? null,
            action: elementSet ? "world.reset" : "world.generate",
            entityType: "world",
            summary: `${elementSet ? "Reset" : "Generated"} world elements: ${generated.join(", ")}`,
            after: { elements: generated, mode: opts.mode },
        });
    }

    return { narrative, laws, roles, member, goals, skipped, errors };
}
