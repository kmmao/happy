import { describe, expect, it, vi } from "vitest";
import { handleSessionResumeResult } from "./sessionResumeFlow";

describe("handleSessionResumeResult", () => {
  it("navigates immediately when resume succeeds", async () => {
    const navigate = vi.fn();
    const requestDirectoryApproval = vi.fn();

    await handleSessionResumeResult({
      result: { type: "success", sessionId: "session-1" },
      onSuccess: navigate,
      requestDirectoryApproval,
      createError: (message) => new Error(message),
      getStartSessionFallbackMessage: () => "fallback",
    });

    expect(navigate).toHaveBeenCalledOnce();
    expect(requestDirectoryApproval).not.toHaveBeenCalled();
  });

  it("retries with approved directory creation when the user confirms", async () => {
    const retry = vi.fn().mockResolvedValue({ type: "success", sessionId: "session-1" });
    const navigate = vi.fn();
    const requestDirectoryApproval = vi.fn().mockResolvedValue(true);

    await handleSessionResumeResult({
      result: {
        type: "requestToApproveDirectoryCreation",
        directory: "/repo",
      },
      retryWithApprovedDirectoryCreation: retry,
      onSuccess: navigate,
      requestDirectoryApproval,
      createError: (message) => new Error(message),
      getStartSessionFallbackMessage: () => "fallback",
    });

    expect(requestDirectoryApproval).toHaveBeenCalledOnce();
    expect(requestDirectoryApproval).toHaveBeenCalledWith("/repo");
    expect(retry).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("maps the retry directory before retrying", async () => {
    const retry = vi.fn().mockResolvedValue({ type: "success", sessionId: "session-1" });
    const requestDirectoryApproval = vi.fn().mockResolvedValue(true);

    await handleSessionResumeResult({
      result: {
        type: "requestToApproveDirectoryCreation",
        directory: "/worktree",
      },
      retryWithApprovedDirectoryCreation: retry,
      onSuccess: vi.fn(),
      requestDirectoryApproval,
      createError: (message) => new Error(message),
      getStartSessionFallbackMessage: () => "fallback",
      mapRetryDirectory: (directory) => `${directory}-parent`,
    });

    expect(retry).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledWith("/worktree-parent");
  });

  it("throws fallback error when approved retry still requires directory creation", async () => {
    const retry = vi.fn().mockResolvedValue({
      type: "requestToApproveDirectoryCreation",
      directory: "/repo-parent",
    });

    await expect(
      handleSessionResumeResult({
        result: {
          type: "requestToApproveDirectoryCreation",
          directory: "/repo",
        },
        retryWithApprovedDirectoryCreation: retry,
        onSuccess: vi.fn(),
        requestDirectoryApproval: vi.fn().mockResolvedValue(true),
        createError: (message) => new Error(message),
        getStartSessionFallbackMessage: () => "fallback",
      }),
    ).rejects.toThrow("fallback");
  });

  it("stops when the user rejects directory creation approval", async () => {
    const retry = vi.fn();
    const navigate = vi.fn();
    const requestDirectoryApproval = vi.fn().mockResolvedValue(false);

    await handleSessionResumeResult({
      result: {
        type: "requestToApproveDirectoryCreation",
        directory: "/repo",
      },
      retryWithApprovedDirectoryCreation: retry,
      onSuccess: navigate,
      requestDirectoryApproval,
      createError: (message) => new Error(message),
      getStartSessionFallbackMessage: () => "fallback",
    });

    expect(requestDirectoryApproval).toHaveBeenCalledOnce();
    expect(requestDirectoryApproval).toHaveBeenCalledWith("/repo");
    expect(retry).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("throws when the approved retry fails", async () => {
    const retry = vi.fn().mockResolvedValue({
      type: "error",
      errorMessage: "retry failed",
    });

    await expect(
      handleSessionResumeResult({
        result: {
          type: "requestToApproveDirectoryCreation",
          directory: "/repo",
        },
        retryWithApprovedDirectoryCreation: retry,
        onSuccess: vi.fn(),
        requestDirectoryApproval: vi.fn().mockResolvedValue(true),
        createError: (message) => new Error(message),
        getStartSessionFallbackMessage: () => "fallback",
      }),
    ).rejects.toThrow("retry failed");
  });

  it("throws when the initial result is an error", async () => {
    await expect(
      handleSessionResumeResult({
        result: {
          type: "error",
          errorMessage: "resume failed",
        },
        onSuccess: vi.fn(),
        requestDirectoryApproval: vi.fn(),
        createError: (message) => new Error(message),
        getStartSessionFallbackMessage: () => "fallback",
      }),
    ).rejects.toThrow("resume failed");
  });
});
