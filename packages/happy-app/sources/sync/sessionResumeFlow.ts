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
