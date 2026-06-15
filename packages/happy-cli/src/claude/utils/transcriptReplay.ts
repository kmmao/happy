import { createHash } from "node:crypto";

import type { ApiSessionClient } from "@/api/apiSession";
import type { RawJSONLines } from "@/claude/types";
import { readRawSessionRecords } from "@/claude/rpc/sessionStoreRpc";
import {
  interleaveSubagentMessages,
  messageKey,
} from "@/claude/utils/sessionScanner";
import { getProjectPath } from "@/claude/utils/path";
import { logger } from "@/ui/logger";
import type { SessionTurnEndStatus } from "@kmmao/happy-wire";

export interface ReplayClaudeTranscriptOptions {
  sourceSessionId: string;
  workingDirectory: string;
  client: ApiSessionClient;
}

export interface ReplayClaudeTranscriptResult {
  records: number;
  replayed: number;
  closedTurns: number;
}

type ReplayLocalIdScope = {
  sourceSessionId: string;
  recordKey: string;
};

export function replayLocalId(
  scope: ReplayLocalIdScope,
  envelopeIndex: number,
): string {
  const hash = createHash("sha256")
    .update(
      `claude-replay:${scope.sourceSessionId}:${scope.recordKey}:${envelopeIndex}`,
    )
    .digest("hex")
    .slice(0, 32);
  return `claude-replay:${hash}`;
}

function resultStatus(record: RawJSONLines): SessionTurnEndStatus | null {
  if (record.type !== "result") {
    return null;
  }
  return record.subtype === "success" ? "completed" : "failed";
}

function turnDurationStatus(record: RawJSONLines): SessionTurnEndStatus | null {
  if (record.type !== "system") {
    return null;
  }
  const subtype = (record as Record<string, unknown>).subtype;
  return subtype === "turn_duration" ? "completed" : null;
}

function closeTurnResultData(record: RawJSONLines) {
  if (record.type !== "result") {
    return undefined;
  }
  return {
    totalCostUsd: record.total_cost_usd ?? 0,
    numTurns: record.num_turns ?? 0,
    modelUsage: (record as { modelUsage?: Record<string, any> }).modelUsage ?? {},
  };
}

export async function replayClaudeTranscriptToHappySession(
  options: ReplayClaudeTranscriptOptions,
): Promise<ReplayClaudeTranscriptResult> {
  const rawRecords = await readRawSessionRecords(options.sourceSessionId, {
    dir: options.workingDirectory,
  });
  if (rawRecords.length === 0) {
    return { records: 0, replayed: 0, closedTurns: 0 };
  }

  const records = await interleaveSubagentMessages(
    getProjectPath(options.workingDirectory),
    options.sourceSessionId,
    rawRecords,
    new Map(),
  );

  let replayed = 0;
  let closedTurns = 0;
  for (const record of records) {
    const recordKey = messageKey(record);
    // Defense in depth — the JSONL scanner created later by `claudeRemote`
    // re-reads the rewritten resume file. If Claude does NOT preserve message
    // UUIDs across `--resume`, the scanner's `messageKey` dedup would not
    // recognise these records. Recording the key on the client lets
    // `sendClaudeSessionMessage` drop the scanner's forward of the same row.
    options.client.markClaudeMessageReplayed(recordKey);
    const scope = {
      sourceSessionId: options.sourceSessionId,
      recordKey,
    };
    const closeStatus = resultStatus(record) ?? turnDurationStatus(record);
    if (closeStatus) {
      options.client.closeClaudeSessionTurn(
        closeStatus,
        closeTurnResultData(record),
        {
          invalidate: false,
          replay: true,
          localIdForEnvelope: ({ envelopeIndex }) =>
            replayLocalId(scope, envelopeIndex),
        },
      );
      closedTurns += 1;
      continue;
    }

    options.client.sendClaudeSessionMessage(record, {
      invalidate: false,
      replay: true,
      localIdForEnvelope: ({ envelopeIndex }) =>
        replayLocalId(scope, envelopeIndex),
    });
    replayed += 1;
  }

  // Truncated histories (history ended mid-turn — last record is an
  // assistant without a terminal `result`) would otherwise leak
  // `currentTurnUsage` / `accumulatedTurnUsage` into the first real turn.
  // Force-close as `cancelled` if a turn is still open, then wipe per-turn
  // tracking so the live session starts from a clean state.
  if (options.client.currentTurnId) {
    const scope = {
      sourceSessionId: options.sourceSessionId,
      recordKey: "replay-cancel-tail",
    };
    options.client.closeClaudeSessionTurn(
      "cancelled",
      undefined,
      {
        invalidate: false,
        replay: true,
        localIdForEnvelope: ({ envelopeIndex }) =>
          replayLocalId(scope, envelopeIndex),
      },
    );
    closedTurns += 1;
  }
  options.client.resetCurrentTurnTracking();

  await options.client.flush();
  logger.debug(
    `[TRANSCRIPT_REPLAY] Replayed ${replayed}/${records.length} records from ${options.sourceSessionId} into Happy session ${options.client.sessionId}`,
  );
  return { records: records.length, replayed, closedTurns };
}
