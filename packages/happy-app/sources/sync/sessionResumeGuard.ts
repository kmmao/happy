import { HappyError } from "@/utils/errors";

const sessionReactivationInFlight = new Set<string>();

export class SessionReactivationInFlightError extends HappyError {
  constructor() {
    super("该会话正在重新激活中，请稍候。", false);
  }
}

export async function runWithSessionReactivationGuard<T>(
  happySessionId: string,
  action: () => Promise<T>,
): Promise<T> {
  if (sessionReactivationInFlight.has(happySessionId)) {
    throw new SessionReactivationInFlightError();
  }

  sessionReactivationInFlight.add(happySessionId);
  try {
    return await action();
  } finally {
    sessionReactivationInFlight.delete(happySessionId);
  }
}

export const SessionResumeInFlightError = SessionReactivationInFlightError;
export const runWithSessionResumeGuard = runWithSessionReactivationGuard;
