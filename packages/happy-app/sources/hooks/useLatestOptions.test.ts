import { describe, expect, it } from "vitest";
import { extractLatestOptions } from "./useLatestOptions";
import { type Message } from "@/sync/typesMessage";

function agentMessage(id: string, text: string): Message {
  return {
    kind: "agent-text",
    id,
    localId: null,
    createdAt: 1,
    text,
  };
}

function toolCallMessage(id: string, toolName: string, input: any): Message {
  return {
    kind: "tool-call",
    id,
    localId: null,
    createdAt: 1,
    tool: {
      name: toolName,
      state: "completed",
      input,
      createdAt: 1,
      startedAt: 1,
      completedAt: 2,
      description: null,
    },
    children: [],
  };
}

describe("extractLatestOptions", () => {
  it("返回最新 options 及其来源消息 id", () => {
    const messages: Message[] = [
      agentMessage(
        "msg-2",
        "Some text\n<options>\n<option>继续修 token</option>\n<option>整理检查清单</option>\n</options>",
      ),
    ];

    expect(extractLatestOptions(messages)).toEqual({
      sourceMessageId: "msg-2",
      items: ["继续修 token", "整理检查清单"],
    });
  });

  it("没有 options 时返回空结果", () => {
    const messages: Message[] = [agentMessage("msg-1", "No options here")];

    expect(extractLatestOptions(messages)).toEqual({
      sourceMessageId: null,
      items: [],
    });
  });

  it("从 ExitPlanMode tool input 的 plan 字段中提取 options", () => {
    const planText =
      "## Plan\n1. Do X\n2. Do Y\n\n<options>\n<option>执行方案</option>\n<option>修改方案</option>\n</options>";
    const messages: Message[] = [
      toolCallMessage("msg-plan", "ExitPlanMode", { plan: planText }),
    ];

    expect(extractLatestOptions(messages)).toEqual({
      sourceMessageId: "msg-plan",
      items: ["执行方案", "修改方案"],
    });
  });

  it("从 exit_plan_mode tool input 的 plan 字段中提取 options", () => {
    const planText =
      "Plan content\n<options>\n<option>Start</option>\n<option>Skip</option>\n</options>";
    const messages: Message[] = [
      toolCallMessage("msg-plan2", "exit_plan_mode", { plan: planText }),
    ];

    expect(extractLatestOptions(messages)).toEqual({
      sourceMessageId: "msg-plan2",
      items: ["Start", "Skip"],
    });
  });

  it("agent-text 优先于 tool-call options", () => {
    const planText =
      "Plan\n<options>\n<option>Plan Option</option>\n</options>";
    const messages: Message[] = [
      agentMessage(
        "msg-agent",
        "Response\n<options>\n<option>Agent Option A</option>\n<option>Agent Option B</option>\n</options>",
      ),
      toolCallMessage("msg-plan", "ExitPlanMode", { plan: planText }),
    ];

    expect(extractLatestOptions(messages)).toEqual({
      sourceMessageId: "msg-agent",
      items: ["Agent Option A", "Agent Option B"],
    });
  });

  it("忽略非 ExitPlanMode 工具的 input", () => {
    const messages: Message[] = [
      toolCallMessage("msg-bash", "Bash", {
        command: "echo '<options><option>Fake</option></options>'",
      }),
    ];

    expect(extractLatestOptions(messages)).toEqual({
      sourceMessageId: null,
      items: [],
    });
  });

  it("ExitPlanMode plan 无 options 时返回空", () => {
    const messages: Message[] = [
      toolCallMessage("msg-plan", "ExitPlanMode", {
        plan: "Just a plan without options",
      }),
    ];

    expect(extractLatestOptions(messages)).toEqual({
      sourceMessageId: null,
      items: [],
    });
  });

  it("anchorIndex 模式下也检测 tool-call options", () => {
    const planText =
      "Plan\n<options>\n<option>Option A</option>\n<option>Option B</option>\n</options>";
    const messages: Message[] = [
      { kind: "user-text", id: "u1", localId: null, createdAt: 1, text: "do it" } as Message,
      toolCallMessage("msg-plan", "ExitPlanMode", { plan: planText }),
      agentMessage("msg-agent", "Here's the plan"),
    ];

    // anchorIndex=0 (user message), scan i=0-1 → should not find (break on user-text at i=0)
    // Actually anchorIndex scans from anchorIndex-1 downward
    // messages[0] = user-text, messages[1] = tool-call, messages[2] = agent-text
    // anchorIndex=2 → scan i=1 (tool-call) then i=0 (user-text → break)
    const result = extractLatestOptions(messages, 2);
    expect(result).toEqual({
      sourceMessageId: "msg-plan",
      items: ["Option A", "Option B"],
    });
  });
});
