import { beforeEach, describe, expect, it, vi } from "vitest";

const { psListMock, spawnSyncMock } = vi.hoisted(() => ({
  psListMock: vi.fn(),
  spawnSyncMock: vi.fn(),
}));

vi.mock("ps-list", () => ({
  default: psListMock,
}));

vi.mock("cross-spawn", () => ({
  default: {
    sync: spawnSyncMock,
  },
}));

import {
  findRunawayHappyProcesses,
  killRunawayHappyProcesses,
} from "@/daemon/doctor";

describe("daemon doctor cleanup", () => {
  beforeEach(() => {
    psListMock.mockReset();
    spawnSyncMock.mockReset();
  });

  it("doctor clean 子进程会把 daemon 视为 runaway 目标", async () => {
    psListMock.mockResolvedValue([
      {
        pid: process.pid,
        name: "node",
        cmd: "node dist/index.mjs doctor clean",
      },
      {
        pid: 20001,
        name: "node",
        cmd: "node dist/index.mjs daemon start-sync",
      },
      {
        pid: 20002,
        name: "node",
        cmd: "node dist/index.mjs --started-by daemon",
      },
    ]);

    const result = await findRunawayHappyProcesses();

    expect(result).toEqual([
      {
        pid: 20001,
        command: "node dist/index.mjs daemon start-sync",
      },
      {
        pid: 20002,
        command: "node dist/index.mjs --started-by daemon",
      },
    ]);
  });

  it("在 daemon 进程内执行 cleanup 不会杀掉当前 daemon", async () => {
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((() => true) as typeof process.kill);

    psListMock
      .mockResolvedValueOnce([
        {
          pid: process.pid,
          name: "node",
          cmd: "node dist/index.mjs daemon start-sync",
        },
        {
          pid: 21001,
          name: "node",
          cmd: "node dist/index.mjs daemon start-sync",
        },
        {
          pid: 21002,
          name: "node",
          cmd: "node dist/index.mjs --started-by daemon",
        },
      ])
      .mockResolvedValueOnce([
        {
          pid: process.pid,
          name: "node",
          cmd: "node dist/index.mjs daemon start-sync",
        },
        {
          pid: 21002,
          name: "node",
          cmd: "node dist/index.mjs --started-by daemon",
        },
      ])
      .mockResolvedValueOnce([
        {
          pid: process.pid,
          name: "node",
          cmd: "node dist/index.mjs daemon start-sync",
        },
      ]);

    try {
      const result = await killRunawayHappyProcesses();

      expect(result).toEqual({
        killed: 2,
        errors: [],
      });
      expect(killSpy).toHaveBeenCalledWith(21001, "SIGTERM");
      expect(killSpy).toHaveBeenCalledWith(21002, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalledWith(process.pid, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalledWith(process.pid, "SIGKILL");
    } finally {
      killSpy.mockRestore();
    }
  });
});
