import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import {
  authApprove,
  getTerminalAuthRequestStatus,
  type AuthApprovalResponses,
} from "./authApprove";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("@/sync/serverConfig", () => ({
  getServerUrl: () => "https://api.test.com",
}));

const axiosGetMock = vi.mocked(axios.get);
const axiosPostMock = vi.mocked(axios.post);

describe("authApprove", () => {
  const publicKey = new Uint8Array([1, 2, 3, 4]);
  const responseV1 = new Uint8Array([5, 6, 7]);
  const responseV2 = new Uint8Array([8, 9, 10]);
  const token = "test-token";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("读取 terminal auth 请求状态", async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        status: "pending",
        supportsV2: true,
      },
    } as never);

    await expect(getTerminalAuthRequestStatus(publicKey)).resolves.toEqual({
      status: "pending",
      supportsV2: true,
    });
  });

  it("在服务端支持 V2 时发送 V2 响应", async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        status: "pending",
        supportsV2: true,
      },
    } as never);
    axiosPostMock.mockResolvedValue({ data: { success: true } } as never);

    const responses: AuthApprovalResponses = { responseV1, responseV2 };
    await authApprove(token, publicKey, responses);

    expect(axiosPostMock).toHaveBeenCalledOnce();
    expect(axiosPostMock.mock.calls[0]?.[0]).toBe(
      "https://api.test.com/v1/auth/response",
    );
    expect(axiosPostMock.mock.calls[0]?.[2]).toMatchObject({
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(axiosPostMock.mock.calls[0]?.[1]).toMatchObject({
      publicKey: expect.any(String),
      response: expect.any(String),
    });
  });

  it("在服务端不支持 V2 时发送 V1 响应", async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        status: "pending",
        supportsV2: false,
      },
    } as never);
    axiosPostMock.mockResolvedValue({ data: { success: true } } as never);

    const responses: AuthApprovalResponses = { responseV1 };
    await authApprove(token, publicKey, responses);

    expect(axiosPostMock).toHaveBeenCalledOnce();
    expect(axiosPostMock.mock.calls[0]?.[1]).toMatchObject({
      publicKey: expect.any(String),
      response: expect.any(String),
    });
  });

  it("缺少服务端要求的 V2 响应时抛出明确错误", async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        status: "pending",
        supportsV2: true,
      },
    } as never);

    await expect(
      authApprove(token, publicKey, { responseV1 }),
    ).rejects.toThrow("missing V2 response");
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it("缺少服务端要求的 V1 响应时抛出明确错误", async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        status: "pending",
        supportsV2: false,
      },
    } as never);

    await expect(
      authApprove(token, publicKey, { responseV2 }),
    ).rejects.toThrow("missing V1 response");
    expect(axiosPostMock).not.toHaveBeenCalled();
  });
});
