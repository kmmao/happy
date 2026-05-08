import { Socket } from "socket.io";
import { z } from "zod";
import { kvGet } from "@/app/kv/kvGet";

const WORLD_CONFIG_KEY = "world.config";

const FetchWorldConfigSchema = z.object({
    sid: z.string().min(1),
});

interface WorldConfig {
    narrative: string;
    laws: string;
    policy: string;
}

/**
 * Socket handler that lets CLI sessions fetch the global world config
 * (narrative + laws + policy) stored in UserKVStore under "world.config".
 * Used to inject world laws/narrative into the CLI system prompt context.
 */
export function worldConfigHandler(userId: string, socket: Socket): void {
    socket.on("fetch-world-config", async (
        data: unknown,
        callback: (response: WorldConfig | null) => void,
    ) => {
        if (!callback) return;
        try {
            const parsed = FetchWorldConfigSchema.safeParse(data);
            if (!parsed.success) {
                callback(null);
                return;
            }

            const result = await kvGet({ uid: userId }, WORLD_CONFIG_KEY);
            if (!result) {
                callback(null);
                return;
            }

            // KV value is stored as base64(JSON-string). Decode it.
            const json = Buffer.from(result.value, "base64").toString("utf8");
            const config = JSON.parse(json) as Partial<WorldConfig>;

            callback({
                narrative: config.narrative ?? "",
                laws: config.laws ?? "",
                policy: config.policy ?? "suggest",
            });
        } catch {
            callback(null);
        }
    });
}
