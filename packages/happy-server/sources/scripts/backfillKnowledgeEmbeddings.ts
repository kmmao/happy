/**
 * Backfill script: generate embeddings for existing ProjectKnowledge entries
 * that don't have one yet.
 *
 * Usage: npx tsx sources/scripts/backfillKnowledgeEmbeddings.ts [--batch-size=50] [--dry-run]
 *
 * Requires OPENAI_API_KEY (or EMBEDDING_API_KEY) in environment.
 */

import { db } from "@/storage/db";
import { generateEmbedding, truncateForEmbedding } from "@/modules/embeddingService";

const DEFAULT_BATCH_SIZE = 50;
const DELAY_BETWEEN_BATCHES_MS = 1000;

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const batchSizeArg = args.find((a) => a.startsWith("--batch-size="));
    const batchSize = batchSizeArg ? parseInt(batchSizeArg.split("=")[1], 10) : DEFAULT_BATCH_SIZE;

    if (isNaN(batchSize) || batchSize <= 0) {
        console.error("Invalid --batch-size value. Must be a positive integer.");
        process.exit(1);
    }

    console.log(`Backfill knowledge embeddings (batch=${batchSize}, dryRun=${dryRun})`);

    // Count entries needing backfill
    const countResult = await db.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM "ProjectKnowledge" WHERE "embedding" IS NULL
    `;
    const total = Number(countResult[0].count);
    console.log(`Found ${total} entries without embeddings`);

    if (total === 0 || dryRun) {
        console.log(dryRun ? "Dry run — no changes made" : "Nothing to backfill");
        process.exit(0);
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    while (true) {
        // Fetch a batch of entries without embeddings (single query, no double-fetch)
        const batch = await db.$queryRawUnsafe<{ id: string; title: string; content: string }[]>(
            `SELECT id, title, content
             FROM "ProjectKnowledge"
             WHERE "embedding" IS NULL
             ORDER BY "createdAt" ASC
             LIMIT $1`,
            batchSize,
        );

        if (batch.length === 0) break;

        for (const entry of batch) {
            try {
                const text = truncateForEmbedding(`${entry.title} ${entry.content}`);
                const embedding = await generateEmbedding(text);

                if (embedding) {
                    const vectorStr = `[${embedding.join(",")}]`;
                    await db.$executeRawUnsafe(
                        `UPDATE "ProjectKnowledge" SET "embedding" = $1::vector WHERE "id" = $2`,
                        vectorStr,
                        entry.id,
                    );
                    succeeded++;
                } else {
                    failed++;
                }
            } catch (err) {
                console.error(`Failed for entry ${entry.id}: ${err}`);
                failed++;
            }
        }

        processed += batch.length;
        console.log(`Progress: ${processed}/${total} (${succeeded} ok, ${failed} failed)`);

        // Rate limit: pause between batches
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }

    console.log(`\nDone: ${succeeded} succeeded, ${failed} failed out of ${total}`);
    process.exit(0);
}

main().catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
});
