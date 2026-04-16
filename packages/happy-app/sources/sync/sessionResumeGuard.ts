import { HappyError } from "@/utils/errors";

const sessionResumeInFlight = new Set<string>();

export class SessionResumeInFlightError extends HappyError {
  constructor() {
    super("该会话正在恢复中，请稍候。", false);
  }
}

export async function runWithSessionResumeGuard<T>(
  happySessionId: string,
  action: () => Promise<T>,
): Promise<T> {
  if (sessionResumeInFlight.has(happySessionId)) {
    throw new SessionResumeInFlightError();
  }

  sessionResumeInFlight.add(happySessionId);
  try {
    return await action();
  } finally {
    sessionResumeInFlight.delete(happySessionId);
  }
}
