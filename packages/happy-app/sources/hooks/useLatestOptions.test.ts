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
});
