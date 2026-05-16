import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { inTx } from "@/storage/inTx";
import { storeKnowledgeEmbedding, findSimilarByEmbedding } from "./knowledgeEmbedding";
import { generateEmbedding, truncateForEmbedding } from "./embeddingService";
import { addRelations } from "./knowledgeRelation";
import { trackKnowledgeCreation } from "./knowledgeAutoProfile";
import { parseKnowledgeConfig, mergeWithDefaults } from "./knowledgeConfigResolver";
import { z } from "zod";

// ─── Configuration ───

const MERGE_CLUSTER_SIMILARITY = 0.75;
const MERGE_MIN_CLUSTER_SIZE = 2;
const MERGE_MAX_CLUSTER_SIZE = 5;
const MERGE_MAX_CLUSTERS_PER_RUN = 5;
const MAX_RETRIES = 2;

// ─── Types ───

interface MergeCluster {
    entries: ClusterEntry[];
}

interface ClusterEntry {
    id: string;
    title: string;
    content: string;
    entryType: string;
    tags: string;
    confidence: string;
    createdAt: Date;
    sessionId: string | null;
}

// ─── Zod schema for LLM merge output ───

const MergedKnowledgeSchema = z.object({
    title: z.string().max(200),
    content: z.string().max(4000),
    entryType: z.enum(["discovery", "decision", "fix", "convention", "warning", "summary"]),
    confidence: z.enum(["high", "medium", "low"]),
    tags: z.array(z.string().max(50)).max(10),
});

type MergedKnowledge = z.infer<typeof MergedKnowledgeSchema>;

// ─── LLM Provider (reuse pattern from knowledgeRefiner) ───

type LLMProvider = "ollama" | "anthropic" | "none";

function detectProvider(): LLMProvider {
    const explicit = process.env.PROFILE_PROVIDER;
    if (explicit === "ollama" || explicit === "anthropic") return explicit;

    if (process.env.ANTHROPIC_API_KEY) return "anthropic";
    if (process.env.OLLAMA_URL) return "ollama";
    return "none";
}

async function callAnthropic(systemPrompt: string, userMessage: string): Promise<string | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
    const model = process.env.ANTHROPIC_PROFILE_MODEL || "claude-haiku-4-5-20251001";

    const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model,
            max_tokens: 2048,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
        }),
        signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errBody.slice(0, 500)}`);
    }

    const data = await response.json() as { content: { type: string; text: string }[] };
    return data.content[0]?.text ?? null;
}

async function callOllama(systemPrompt: string, userMessage: string): Promise<string | null> {
    const url = process.env.OLLAMA_URL || "http://localhost:11434";
    const model = process.env.OLLAMA_CHAT_MODEL || "gpt-oss:20b";

    const response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ],
            stream: false,
            options: { temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${errBody.slice(0, 500)}`);
    }

    const data = await response.json() as { message: { content: string } };
    return data.message?.content ?? null;
}

// ─── Merge Prompt ───

const MERGE_SYSTEM_PROMPT = `You are a knowledge consolidation specialist. Given multiple related knowledge entries from a software project, merge them into a single comprehensive summary.

Output ONLY valid JSON matching this schema:
{
  "title": "merged descriptive title (max 200 chars)",
  "content": "comprehensive merged knowledge (max 4000 chars)",
  "entryType": "discovery|decision|fix|convention|warning",
  "confidence": "high|medium|low",
  "tags": ["relevant", "tags"]
}

Rules:
- Preserve ALL unique information from source entries
- Resolve contradictions by preferring the most recent entry
- Use the SAME LANGUAGE as the input entries (Chinese → Chinese, English → English)
- The merged entry must be self-contained — a reader should not need the originals
- entryType: choose the most representative type across all entries
- confidence: use the highest confidence from the source entries
- tags: union of all source tags, deduplicated, max 10
- Be concise but thorough`;

// ─── Cluster Discovery ───

/**
 * Find clusters of semantically similar active entries in a project.
 * Uses embedding similarity to group entries, then filters for merge candidates.
 *
 * Algorithm:
 * 1. Fetch all active, non-pinned entries with embeddings
 * 2. For each entry, find similar entries (similarity > threshold)
 * 3. Group into clusters, dedup across clusters
 * 4. Return clusters of size >= MERGE_MIN_CLUSTER_SIZE
 */
async function findMergeClusters(projectId: string): Promise<MergeCluster[]> {
    // Get active entries that have embeddings
    const entries = await db.projectKnowledge.findMany({
        where: {
            projectId,
            status: "active",
            pinned: false,
        },
        select: {
            id: true,
            title: true,
            content: true,
            entryType: true,
            tags: true,
            confidence: true,
            createdAt: true,
            sessionId: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
    });

    if (entries.length < MERGE_MIN_CLUSTER_SIZE) return [];

    // Check which entries already have "combines" relations (skip them)
    const existingCombines = await db.knowledgeRelation.findMany({
        where: {
            relationType: "combines",
            OR: [
                { fromEntryId: { in: entries.map((e) => e.id) } },
                { toEntryId: { in: entries.map((e) => e.id) } },
            ],
        },
        select: { fromEntryId: true, toEntryId: true },
    });

    const combinedIds = new Set<string>();
    for (const r of existingCombines) {
        combinedIds.add(r.fromEntryId);
        combinedIds.add(r.toEntryId);
    }

    const candidates = entries.filter((e) => !combinedIds.has(e.id));
    if (candidates.length < MERGE_MIN_CLUSTER_SIZE) return [];

    // Find clusters via embedding similarity
    const clusters: MergeCluster[] = [];
    const assigned = new Set<string>();

    for (const entry of candidates) {
        if (assigned.has(entry.id)) continue;

        const text = truncateForEmbedding(`${entry.title} ${entry.content}`);
        const embedding = await generateEmbedding(text);
        if (!embedding) continue;

        const similar = await findSimilarByEmbedding(
            projectId,
            embedding,
            MERGE_MAX_CLUSTER_SIZE + 1, // +1 to account for self-match
            MERGE_CLUSTER_SIMILARITY,
        );

        // Filter: only include candidates not yet assigned
        const clusterMembers = similar
            .filter((s) => !assigned.has(s.id) && s.id !== entry.id)
            .slice(0, MERGE_MAX_CLUSTER_SIZE - 1);

        if (clusterMembers.length < MERGE_MIN_CLUSTER_SIZE - 1) continue;

        // Build cluster
        const memberIds = [entry.id, ...clusterMembers.map((m) => m.id)];
        const clusterEntries = candidates.filter((c) => memberIds.includes(c.id));

        for (const id of memberIds) assigned.add(id);

        clusters.push({ entries: clusterEntries });

        if (clusters.length >= MERGE_MAX_CLUSTERS_PER_RUN) break;
    }

    return clusters;
}

// ─── LLM Merge ───

function buildMergePrompt(entries: ClusterEntry[]): string {
    const parts = entries.map((e, i) => {
        let tags = "[]";
        try { tags = JSON.parse(e.tags).join(", "); } catch { /* ignore */ }
        return [
            `--- Entry ${i + 1} (${e.createdAt.toISOString()}) ---`,
            `Title: ${e.title}`,
            `Type: ${e.entryType}`,
            `Confidence: ${e.confidence}`,
            `Tags: ${tags}`,
            `Content: ${e.content.slice(0, 2000)}`,
        ].join("\n");
    });

    return parts.join("\n\n");
}

async function llmMerge(entries: ClusterEntry[]): Promise<MergedKnowledge | null> {
    const provider = detectProvider();
    if (provider === "none") return null;

    const callLLM = provider === "anthropic" ? callAnthropic : callOllama;
    const userMessage = buildMergePrompt(entries);

    let lastError: string | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const text = await callLLM(MERGE_SYSTEM_PROMPT, userMessage);
            if (!text) {
                lastError = "Empty LLM response";
                break;
            }

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                lastError = "No JSON in LLM response";
                continue;
            }

            const parsed = JSON.parse(jsonMatch[0]);
            return MergedKnowledgeSchema.parse(parsed);
        } catch (err) {
            lastError = `Attempt ${attempt + 1}: ${err}`;
        }
    }

    log({ module: "knowledge-merge" }, `LLM merge failed: ${lastError}`);
    return null;
}

// ─── Execute Merge ───

/**
 * Execute a single cluster merge:
 * 1. Call LLM to generate merged entry
 * 2. In transaction: create merged entry + supersede originals
 * 3. Create "combines" relations
 * 4. Generate embedding for merged entry
 */
async function executeClusterMerge(
    projectId: string,
    cluster: MergeCluster,
): Promise<{ mergedId: string } | null> {
    const merged = await llmMerge(cluster.entries);
    if (!merged) return null;

    const sourceIds = cluster.entries.map((e) => e.id);

    const entry = await inTx(async (tx) => {
        // Mark source entries as superseded
        await tx.projectKnowledge.updateMany({
            where: { id: { in: sourceIds } },
            data: { status: "superseded" },
        });

        // Create merged entry
        return tx.projectKnowledge.create({
            data: {
                projectId,
                entryType: merged.entryType,
                contributorType: "supervisor",
                action: "supersede",
                title: merged.title,
                content: merged.content,
                structured: JSON.stringify({
                    request: `Merged from ${sourceIds.length} entries`,
                    findings: `Source IDs: ${sourceIds.join(", ")}`,
                    sources: cluster.entries.map((e) => ({
                        id: e.id,
                        title: e.title,
                        sessionId: e.sessionId,
                    })),
                }),
                tags: JSON.stringify(merged.tags),
                confidence: merged.confidence,
                affectedFiles: "[]",
                relatedIds: "[]",
            },
        });
    });

    // Create "combines" relations (merged → each source)
    void addRelations(
        sourceIds.map((sourceId) => ({
            fromId: entry.id,
            toId: sourceId,
            relationType: "combines" as const,
        })),
    );

    // Generate embedding for the merged entry
    void storeKnowledgeEmbedding(entry.id, merged.title, merged.content);

    log(
        { module: "knowledge-merge" },
        `Merged ${sourceIds.length} entries → "${merged.title.slice(0, 50)}" (${entry.id})`,
    );

    return { mergedId: entry.id };
}

// ─── Public API ───

/**
 * Run the merge job for a single project.
 * Discovers similar clusters, merges them via LLM, writes results.
 *
 * Returns { merged: number of entries merged, clusters: number of clusters processed }
 */
export async function runMergeJob(projectId: string): Promise<{
    merged: number;
    clusters: number;
}> {
    let merged = 0;
    let clustersProcessed = 0;

    try {
        const clusters = await findMergeClusters(projectId);

        if (clusters.length === 0) {
            return { merged: 0, clusters: 0 };
        }

        for (const cluster of clusters) {
            const result = await executeClusterMerge(projectId, cluster);
            if (result) {
                merged += cluster.entries.length;
                clustersProcessed++;
            }
        }

        if (merged > 0) {
            trackKnowledgeCreation(projectId);
            log(
                { module: "knowledge-merge" },
                `Merge job: ${merged} entries → ${clustersProcessed} merged entries for project ${projectId}`,
            );
        }
    } catch (err) {
        log({ module: "knowledge-merge" }, `Merge job failed for project ${projectId}: ${err}`);
    }

    return { merged, clusters: clustersProcessed };
}

/**
 * Run merge job across all projects with sufficient active entries.
 */
export async function runGlobalMergeJob(): Promise<{
    totalMerged: number;
    projectsProcessed: number;
}> {
    let totalMerged = 0;
    let projectsProcessed = 0;

    try {
        // Find projects with at least MERGE_MIN_CLUSTER_SIZE * 2 active entries
        const projectCounts = await db.projectKnowledge.groupBy({
            by: ["projectId"],
            where: { status: "active", pinned: false },
            _count: { id: true },
            having: {
                id: { _count: { gte: MERGE_MIN_CLUSTER_SIZE * 2 } },
            },
        });

        // Batch-fetch project configs to avoid N+1
        const projectIds = projectCounts.map((p) => p.projectId);
        const projectConfigs = await db.project.findMany({
            where: { id: { in: projectIds } },
            select: { id: true, knowledgeConfig: true },
        });
        const configMap = new Map(projectConfigs.map((p) => [p.id, p.knowledgeConfig]));

        for (const { projectId } of projectCounts) {
            const config = mergeWithDefaults(parseKnowledgeConfig(configMap.get(projectId) ?? null));
            if (!config.mergeEnabled) continue;

            const result = await runMergeJob(projectId);
            totalMerged += result.merged;
            if (result.clusters > 0) projectsProcessed++;
        }

        if (totalMerged > 0) {
            log(
                { module: "knowledge-merge" },
                `Global merge: ${totalMerged} entries merged across ${projectsProcessed} projects`,
            );
        }
    } catch (err) {
        log({ module: "knowledge-merge" }, `Global merge job failed: ${err}`);
    }

    return { totalMerged, projectsProcessed };
}
