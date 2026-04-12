/**
 * Risk classification for autonomous actions (Stage H Sprint 3).
 *
 * Implements the iron law: all high-risk actions are intercepted regardless
 * of the policy configuration. Risk levels:
 *
 *   low    — safe to auto-accept under semi-auto or auto
 *   medium — requires auto mode
 *   high   — always escalated to the user, never auto-executed
 */

import type { WorldAutonomyPolicy } from "@kmmao/happy-wire";
import type { GoalLayer } from "./goalHealthEngine";

export type RiskLevel = "low" | "medium" | "high";

export type AutoActionType =
    | "auto_accept_task"
    | "auto_accept_goal"
    | "auto_resolve_decision";

// ---------------------------------------------------------------------------
// Pure function: classify risk
// ---------------------------------------------------------------------------

/**
 * Classify the risk of an autonomous action.
 *
 * Rules:
 *   high  — requiresHuman:true, strategic layer, or decision without precedent
 *   medium — operational-layer goal or decision with precedent
 *   low   — safe task in next_step bucket, non-strategic
 */
export function classifyActionRisk(input: {
    actionType: AutoActionType;
    goalLayer?: GoalLayer;
    requiresHuman: boolean;
    hasPrecedent: boolean;
}): { risk: RiskLevel; reasons: string[] } {
    const reasons: string[] = [];

    if (input.requiresHuman) {
        reasons.push("requiresHuman:true");
        return { risk: "high", reasons };
    }

    switch (input.actionType) {
        case "auto_accept_task":
            // Tasks are always low risk if requiresHuman=false
            reasons.push("suggested_task:safe");
            return { risk: "low", reasons };

        case "auto_accept_goal":
            if (input.goalLayer === "strategic") {
                reasons.push("goal_layer:strategic");
                return { risk: "high", reasons };
            }
            if (input.goalLayer === "operational") {
                reasons.push("goal_layer:operational");
                return { risk: "medium", reasons };
            }
            // Execution layer goal — treat as low
            reasons.push("goal_layer:execution");
            return { risk: "low", reasons };

        case "auto_resolve_decision":
            if (!input.hasPrecedent) {
                reasons.push("decision:no_precedent");
                return { risk: "high", reasons };
            }
            reasons.push("decision:has_precedent");
            return { risk: "medium", reasons };
    }
}

// ---------------------------------------------------------------------------
// Pure function: should escalate?
// ---------------------------------------------------------------------------

/**
 * Returns true if the action should be blocked and escalated to the user.
 *
 * Iron law: high risk is always blocked regardless of policy.
 * medium risk is blocked unless policy is "auto".
 * low risk passes through semi-auto and auto.
 */
export function shouldEscalate(input: {
    policy: WorldAutonomyPolicy;
    risk: RiskLevel;
}): boolean {
    const { policy, risk } = input;

    // High is always blocked — this is the iron law
    if (risk === "high") return true;

    // Medium requires "auto" mode
    if (risk === "medium") {
        return policy.level !== "auto";
    }

    // Low: passes through semi-auto and auto
    return false;
}
