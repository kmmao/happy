import { type Metadata } from "@/sync/storageTypes";

export type ToolProvider = "default" | "codex";

interface GetToolProviderParams {
  toolName: string;
  metadata?: Metadata | null;
}

export function getToolProvider({
  toolName,
  metadata,
}: GetToolProviderParams): ToolProvider {
  const flavor = metadata?.flavor?.toLowerCase();
  return flavor === "codex" || toolName.startsWith("Codex")
    ? "codex"
    : "default";
}
