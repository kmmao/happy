import { runAgentLoopJob, type AgentLoopHandlerDeps } from "./AgentLoopRunner";
import { handleSupervisorTrigger } from "@/supervisor/handleSupervisorTrigger";
import type { SupervisorHandlerDeps } from "@/supervisor/handleSupervisorTrigger";
import { handleWebhookTrigger } from "@/webhook/handleWebhookTrigger";
import type { WebhookHandlerDeps } from "@/webhook/handleWebhookTrigger";
import type { AutomationJob, AutomationRunResult } from "./types";

export interface AutomationRunnerDeps {
  supervisor: SupervisorHandlerDeps;
  webhook: WebhookHandlerDeps;
  agentLoop: AgentLoopHandlerDeps;
}

export async function runAutomationJob(
  job: AutomationJob,
  deps: AutomationRunnerDeps,
): Promise<AutomationRunResult> {
  if (job.kind === "supervisor") {
    const result = await handleSupervisorTrigger(job.payload, deps.supervisor);
    if (!result.success) {
      throw new Error(result.errorMessage ?? "Supervisor job failed");
    }
    return {
      completion: result.sessionId ? "session" : "immediate",
      sessionId: result.sessionId,
    };
  }

  if (job.kind === "agent_loop") {
    const result = await runAgentLoopJob(job.payload, deps.agentLoop);
    if (!result.success) {
      throw new Error(result.errorMessage ?? "Agent loop job failed");
    }
    return {
      completion: result.sessionId ? "session" : "immediate",
      sessionId: result.sessionId,
    };
  }

  const result = await handleWebhookTrigger(job.payload, deps.webhook);
  if (!result.success) {
    throw new Error(result.errorMessage ?? "Webhook job failed");
  }
  return {
    completion: result.sessionId ? "session" : "immediate",
    sessionId: result.sessionId,
  };
}
