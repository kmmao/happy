import { parseLegacyCodexPlanPreview } from "@/components/tools/codexPlanCompat";
import {
  type ProgressTodo,
  type ResolvedChecklist,
} from "@/components/session/sessionProgressData";
import { Message } from "@/sync/typesMessage";

export type CodexPlanSource = ResolvedChecklist["source"] | "legacy_preview";

export interface CodexPlanData {
  source: CodexPlanSource;
  listId?: string;
  todos: ProgressTodo[];
  updatedAt: number | null;
  label?: string;
  currentStage?: string;
  blockers?: string[];
  explanation?: string | null;
}

function mapLegacyPreviewStatus(
  status: "completed" | "in_progress" | "pending" | "unknown",
): ProgressTodo["status"] {
  if (status === "completed" || status === "in_progress") {
    return status;
  }
  return "pending";
}

function resolveLegacyCodexPlanPreview(
  messages: readonly Message[],
): CodexPlanData | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.kind !== "agent-text") {
      continue;
    }

    const preview = parseLegacyCodexPlanPreview(message.text);
    if (!preview) {
      continue;
    }

    return {
      source: "legacy_preview",
      updatedAt: message.createdAt,
      explanation: preview.explanation,
      todos: preview.items.map((item) => ({
        content: item.text,
        status: mapLegacyPreviewStatus(item.status),
      })),
    };
  }

  return null;
}

export function resolveCodexPlanData(
  checklist: ResolvedChecklist,
  messages: readonly Message[],
): CodexPlanData {
  if (checklist.source !== "none") {
    return {
      source: checklist.source,
      listId: checklist.listId,
      todos: checklist.todos,
      updatedAt: checklist.updatedAt,
      label: checklist.label,
      currentStage: checklist.currentStage,
      blockers: checklist.blockers,
    };
  }

  const legacyPreview = resolveLegacyCodexPlanPreview(messages);
  if (legacyPreview) {
    return legacyPreview;
  }

  return {
    source: "none",
    todos: [],
    updatedAt: null,
  };
}

export function getCodexPlanSourceLabelKey(
  source: CodexPlanSource,
):
  | "session.progressSourceMcp"
  | "session.progressSourceTodoWrite"
  | "tools.names.planProposal" {
  if (source === "mcp") {
    return "session.progressSourceMcp";
  }
  if (source === "todowrite") {
    return "session.progressSourceTodoWrite";
  }
  return "tools.names.planProposal";
}
