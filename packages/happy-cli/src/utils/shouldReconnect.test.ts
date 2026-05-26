import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockNetworkInterfaces, mockExecFile } = vi.hoisted(() => ({
  mockNetworkInterfaces: vi.fn(),
  mockExecFile: vi.fn(),
}));

vi.mock("node:os", () => ({
  networkInterfaces: mockNetworkInterfaces,
}));

// promisify(execFile) calls execFile(cmd, args, callback); emulate that shape.
vi.mock("node:child_process", () => ({
  execFile: (
    _command: string,
    _args: string[],
    callback: (error: Error | null, result: { stdout: string }) => void,
  ) => {
    mockExecFile(_command, _args)
      .then((stdout: string) => callback(null, { stdout }))
      .catch((error: Error) => callback(error, { stdout: "" }));
  },
}));

import {
  hasExternalDisplay,
  hasNetworkConnectivity,
  isLidClosed,
  shouldReconnect,
} from "./shouldReconnect";

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform });
}

describe("shouldReconnect probes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
  });

  describe("hasNetworkConnectivity", () => {
    it("is true when a non-internal IPv4 interface exists", () => {
      mockNetworkInterfaces.mockReturnValue({
        lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
        en0: [{ family: "IPv4", internal: false, address: "192.168.1.5" }],
      });
      expect(hasNetworkConnectivity()).toBe(true);
    });

    it("is false when only internal / IPv6 interfaces exist", () => {
      mockNetworkInterfaces.mockReturnValue({
        lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
        en0: [{ family: "IPv6", internal: false, address: "fe80::1" }],
      });
      expect(hasNetworkConnectivity()).toBe(false);
    });
  });

  describe("isLidClosed", () => {
    it("returns false on non-darwin without probing", async () => {
      setPlatform("linux");
      expect(await isLidClosed()).toBe(false);
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("parses the clamshell state on darwin", async () => {
      setPlatform("darwin");
      mockExecFile.mockResolvedValue('  "AppleClamshellState" = Yes\n');
      expect(await isLidClosed()).toBe(true);

      mockExecFile.mockResolvedValue('  "AppleClamshellState" = No\n');
      expect(await isLidClosed()).toBe(false);
    });

    it("treats a probe failure as lid-open", async () => {
      setPlatform("darwin");
      mockExecFile.mockRejectedValue(new Error("ioreg missing"));
      expect(await isLidClosed()).toBe(false);
    });
  });

  describe("hasExternalDisplay", () => {
    it("returns false on non-darwin", async () => {
      setPlatform("linux");
      expect(await hasExternalDisplay()).toBe(false);
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("detects a non-built-in display", async () => {
      setPlatform("darwin");
      mockExecFile.mockResolvedValue(
        JSON.stringify({
          SPDisplaysDataType: [
            {
              spdisplays_ndrvs: [
                { spdisplays_connection_type: "spdisplays_internal" },
                { spdisplays_connection_type: "spdisplays_displayport_dongle" },
              ],
            },
          ],
        }),
      );
      expect(await hasExternalDisplay()).toBe(true);
    });

    it("returns false when only the built-in display is attached", async () => {
      setPlatform("darwin");
      mockExecFile.mockResolvedValue(
        JSON.stringify({
          SPDisplaysDataType: [
            {
              spdisplays_ndrvs: [
                { "spdisplays_built-in": "spdisplays_yes" },
              ],
            },
          ],
        }),
      );
      expect(await hasExternalDisplay()).toBe(false);
    });
  });

  describe("shouldReconnect composite", () => {
    it("is false without network regardless of platform", async () => {
      setPlatform("darwin");
      mockNetworkInterfaces.mockReturnValue({});
      expect(await shouldReconnect()).toBe(false);
      // Short-circuits before probing lid / display.
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("is network-only on non-darwin (lid probe disabled)", async () => {
      setPlatform("linux");
      mockNetworkInterfaces.mockReturnValue({
        en0: [{ family: "IPv4", internal: false, address: "10.0.0.2" }],
      });
      expect(await shouldReconnect()).toBe(true);
    });

    it("blocks reconnect when the lid is closed without an external display", async () => {
      setPlatform("darwin");
      mockNetworkInterfaces.mockReturnValue({
        en0: [{ family: "IPv4", internal: false, address: "10.0.0.2" }],
      });
      mockExecFile.mockImplementation(async (command: string) => {
        if (command === "ioreg") {
          return '"AppleClamshellState" = Yes';
        }
        return JSON.stringify({
          SPDisplaysDataType: [
            { spdisplays_ndrvs: [{ "spdisplays_built-in": "spdisplays_yes" }] },
          ],
        });
      });
      expect(await shouldReconnect()).toBe(false);
    });

    it("allows reconnect in clamshell mode (lid closed + external display)", async () => {
      setPlatform("darwin");
      mockNetworkInterfaces.mockReturnValue({
        en0: [{ family: "IPv4", internal: false, address: "10.0.0.2" }],
      });
      mockExecFile.mockImplementation(async (command: string) => {
        if (command === "ioreg") {
          return '"AppleClamshellState" = Yes';
        }
        return JSON.stringify({
          SPDisplaysDataType: [
            {
              spdisplays_ndrvs: [
                { spdisplays_connection_type: "spdisplays_displayport_dongle" },
              ],
            },
          ],
        });
      });
      expect(await shouldReconnect()).toBe(true);
    });
  });
});
