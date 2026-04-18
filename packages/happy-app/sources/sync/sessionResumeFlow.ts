import type { SpawnSessionOptions } from "@/sync/ops";

interface HappyErrorLike extends Error {
  readonly canTryAgain?: boolean;
}

interface HandleSessionResumeResultOptions<Result> {
  result: Result;
  onSuccess: () => void;
  requestDirectoryApproval: (directory: string) => Promise<boolean>;
  retryWithApprovedDirectoryCreation?: (directory?: string) => Promise<Result>;
  createError: (message: string) => HappyErrorLike;
  getStartSessionFallbackMessage: () => string;
  mapRetryDirectory?: (directory: string) => string;
}

type SessionResumeResult =
  | { type: "success"; sessionId: string }
  | { type: "requestToApproveDirectoryCreation"; directory: string }
  | { type: "error"; errorMessage: string };

interface ReactivateArchivedSessionOptions {
  sessionId: string;
  mode: "resume" | "unarchive";
  onSuccess: () => void;
  requestDirectoryApproval: (directory: string) => Promise<boolean>;
  createError: (message: string) => HappyErrorLike;
  getStartSessionFallbackMessage: () => string;
  createResumeRequest?: (
    directory?: string,
    approvedNewDirectoryCreation?: boolean,
  ) => SpawnSessionOptions;
  mapRetryDirectory?: (directory: string) => string;
  spawnSession?: (options: SpawnSessionOptions) => Promise<SessionResumeResult>;
  unarchiveSession?: (
    sessionId: string,
  ) => Promise<{ success: boolean; message?: string }>;
}

export async function handleSessionResumeResult(
  options: HandleSessionResumeResultOptions<SessionResumeResult>,
): Promise<void> {
  const {
    result,
    onSuccess,
    requestDirectoryApproval,
    retryWithApprovedDirectoryCreation,
    createError,
    getStartSessionFallbackMessage,
    mapRetryDirectory,
  } = options;

  if (result.type === "error") {
    throw createError(result.errorMessage);
  }

  if (result.type === "success") {
    onSuccess();
    return;
  }

  const approved = await requestDirectoryApproval(result.directory);
  if (!approved) {
    return;
  }

  if (!retryWithApprovedDirectoryCreation) {
    throw createError(getStartSessionFallbackMessage());
  }

  const retried = await retryWithApprovedDirectoryCreation(
    mapRetryDirectory ? mapRetryDirectory(result.directory) : undefined,
  );
  if (retried.type === "error") {
    throw createError(retried.errorMessage);
  }
  if (retried.type === "requestToApproveDirectoryCreation") {
    throw createError(getStartSessionFallbackMessage());
  }

  onSuccess();
}

export async function reactivateArchivedSession(
  options: ReactivateArchivedSessionOptions,
): Promise<void> {
  const {
    sessionId,
    mode,
    onSuccess,
    requestDirectoryApproval,
    createError,
    getStartSessionFallbackMessage,
    createResumeRequest,
    mapRetryDirectory,
    spawnSession,
    unarchiveSession,
  } = options;

  if (mode === "unarchive") {
    const unarchive =
      unarchiveSession
      ?? (await import("@/sync/ops")).sessionUnarchive;
    const result = await unarchive(sessionId);
    if (!result.success) {
      throw createError(
        result.message ?? getStartSessionFallbackMessage(),
      );
    }
    onSuccess();
    return;
  }

  if (!createResumeRequest) {
    throw createError(getStartSessionFallbackMessage());
  }

  const spawn =
    spawnSession
    ?? (await import("@/sync/ops")).machineSpawnNewSession;

  const initialResult = await spawn(
    createResumeRequest(undefined, false),
  );

  await handleSessionResumeResult({
    result: initialResult,
    onSuccess,
    requestDirectoryApproval,
    retryWithApprovedDirectoryCreation: (directory) =>
      spawn(
        createResumeRequest(directory, true),
      ),
    createError,
    getStartSessionFallbackMessage,
    mapRetryDirectory,
  });
}
