import * as React from "react";
import type { OpenClawChatEvent, OpenClawChatMessage } from "./openclawTypes";

// ── Display block types ─────────────────────────────────────────────

export type DisplayBlock =
  | {
      kind: "user";
      id: string;
      content: string;
      timestamp?: number;
      imageCount?: number;
    }
  | { kind: "assistant"; id: string; content: string; timestamp?: number }
  | { kind: "thinking"; id: string; content: string }
  | { kind: "error"; id: string; message: string };

export type ChatPhase = "idle" | "thinking" | "streaming" | "tool";

export interface ChatState {
  blocks: readonly DisplayBlock[];
  streamingContent: string;
  thinkingContent: string;
  phase: ChatPhase;
}

// ── Actions ─────────────────────────────────────────────────────────

type ChatAction =
  | { type: "LOAD_HISTORY"; messages: OpenClawChatMessage[] }
  | {
      type: "ADD_USER_MESSAGE";
      id: string;
      content: string;
      timestamp: number;
      imageCount?: number;
    }
  | { type: "PROCESS_EVENT"; event: OpenClawChatEvent }
  | { type: "RESET" };

// ── Helpers ─────────────────────────────────────────────────────────

function extractTextContent(content: OpenClawChatMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        block.type === "text" && !!block.text,
    )
    .map((block) => block.text)
    .join("\n");
}

let idSeq = 0;

const INITIAL_STATE: ChatState = {
  blocks: [],
  streamingContent: "",
  thinkingContent: "",
  phase: "idle",
};

// ── Reducer ─────────────────────────────────────────────────────────

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "LOAD_HISTORY": {
      const blocks: DisplayBlock[] = action.messages.map((msg, idx) =>
        msg.role === "user"
          ? {
              kind: "user" as const,
              id: `history-${idx}`,
              content: extractTextContent(msg.content),
              timestamp: msg.timestamp,
            }
          : {
              kind: "assistant" as const,
              id: `history-${idx}`,
              content: extractTextContent(msg.content),
              timestamp: msg.timestamp,
            },
      );
      return { ...INITIAL_STATE, blocks };
    }

    case "ADD_USER_MESSAGE": {
      const userBlock: DisplayBlock = {
        kind: "user",
        id: action.id,
        content: action.content,
        timestamp: action.timestamp,
        imageCount: action.imageCount,
      };
      return {
        ...state,
        blocks: [...state.blocks, userBlock],
      };
    }

    case "PROCESS_EVENT": {
      const { event } = action;

      switch (event.state) {
        case "started":
          return {
            ...state,
            streamingContent: "",
            thinkingContent: "",
            phase: "idle",
          };

        case "thinking": {
          const newThinking = event.delta
            ? state.thinkingContent + event.delta
            : state.thinkingContent;
          return {
            ...state,
            thinkingContent: newThinking,
            phase: "thinking",
          };
        }

        case "delta": {
          // If we had accumulated thinking content, freeze it as a block
          const thinkingBlocks: DisplayBlock[] = state.thinkingContent
            ? [
                {
                  kind: "thinking" as const,
                  id: `thinking-${Date.now()}-${++idSeq}`,
                  content: state.thinkingContent,
                },
              ]
            : [];
          return {
            ...state,
            blocks: [...state.blocks, ...thinkingBlocks],
            thinkingContent: "",
            streamingContent: state.streamingContent + (event.delta ?? ""),
            phase: "streaming",
          };
        }

        case "tool":
          return { ...state, phase: "tool" };

        case "final": {
          const finalContent = event.message
            ? extractTextContent(event.message.content)
            : state.streamingContent;

          const pendingThinking: DisplayBlock[] = state.thinkingContent
            ? [
                {
                  kind: "thinking" as const,
                  id: `thinking-${Date.now()}-${++idSeq}`,
                  content: state.thinkingContent,
                },
              ]
            : [];
          const assistantBlocks: DisplayBlock[] = finalContent
            ? [
                {
                  kind: "assistant" as const,
                  id: `msg-${Date.now()}-${++idSeq}`,
                  content: finalContent,
                  timestamp: Date.now(),
                },
              ]
            : [];

          return {
            ...state,
            blocks: [...state.blocks, ...pendingThinking, ...assistantBlocks],
            streamingContent: "",
            thinkingContent: "",
            phase: "idle",
          };
        }

        case "error": {
          const errorBlock: DisplayBlock = {
            kind: "error",
            id: `error-${Date.now()}-${++idSeq}`,
            message: event.errorMessage ?? "An error occurred",
          };
          return {
            ...state,
            blocks: [...state.blocks, errorBlock],
            streamingContent: "",
            thinkingContent: "",
            phase: "idle",
          };
        }

        default:
          return state;
      }
    }

    case "RESET":
      return INITIAL_STATE;

    default:
      return state;
  }
}

// ── Hook ────────────────────────────────────────────────────────────

export function useOpenClawChatReducer() {
  return React.useReducer(chatReducer, INITIAL_STATE);
}
