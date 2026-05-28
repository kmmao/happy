import { logger } from "@/ui/logger";
import { run as runRipgrep } from "@/modules/ripgrep/index";
import { run as runDifftastic } from "@/modules/difftastic/index";
import { RpcHandlerManager } from "../../api/rpc/RpcHandlerManager";
import { validatePath } from "./pathSecurity";

interface RipgrepRequest {
  args: string[];
  cwd?: string;
}

interface RipgrepResponse {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

interface DifftasticRequest {
  args: string[];
  cwd?: string;
}

interface DifftasticResponse {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

/**
 * Register raw search-tool RPC handlers: ripgrep and difftastic. Each is a thin
 * pass-through to the bundled binary, with cwd validated against workingDirectory.
 */
export function registerSearchHandlers(
  rpcHandlerManager: RpcHandlerManager,
  workingDirectory: string,
) {
  // Ripgrep handler - raw interface to ripgrep
  rpcHandlerManager.registerHandler<RipgrepRequest, RipgrepResponse>(
    "ripgrep",
    async (data) => {
      logger.debug("Ripgrep request with args:", data.args, "cwd:", data.cwd);

      // Validate cwd if provided
      if (data.cwd) {
        const validation = validatePath(data.cwd, workingDirectory);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
      }

      try {
        const result = await runRipgrep(data.args, { cwd: data.cwd });
        return {
          success: true,
          exitCode: result.exitCode,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        };
      } catch (error) {
        logger.debug("Failed to run ripgrep:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to run ripgrep",
        };
      }
    },
  );

  // Difftastic handler - raw interface to difftastic
  rpcHandlerManager.registerHandler<DifftasticRequest, DifftasticResponse>(
    "difftastic",
    async (data) => {
      logger.debug(
        "Difftastic request with args:",
        data.args,
        "cwd:",
        data.cwd,
      );

      // Validate cwd if provided
      if (data.cwd) {
        const validation = validatePath(data.cwd, workingDirectory);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
      }

      try {
        const result = await runDifftastic(data.args, { cwd: data.cwd });
        return {
          success: true,
          exitCode: result.exitCode,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        };
      } catch (error) {
        logger.debug("Failed to run difftastic:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to run difftastic",
        };
      }
    },
  );
}
