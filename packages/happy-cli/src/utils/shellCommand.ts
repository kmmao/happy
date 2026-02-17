import { exec, type ExecOptions } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Format shell command output for display in mobile app.
 * Shows the command in a code block with stdout/stderr and exit code.
 */
export function formatShellOutput(
  command: string,
  stdout: string,
  stderr: string,
  exitCode: number,
): string {
  let output = `\`\`\`bash\n$ ${command}\n`;
  if (stdout) {
    output += stdout;
    if (!stdout.endsWith("\n")) {
      output += "\n";
    }
  }
  if (stderr) {
    output += stderr;
    if (!stderr.endsWith("\n")) {
      output += "\n";
    }
  }
  output += "```";
  if (exitCode !== 0) {
    output += `\n\n*Exit code: ${exitCode}*`;
  }
  return output;
}

/**
 * Execute a shell command and return formatted output.
 * Does not throw — always returns a formatted string.
 */
export async function executeShellCommand(
  command: string,
  cwd: string,
): Promise<string> {
  try {
    const execOptions: ExecOptions = {
      cwd,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    };

    const { stdout, stderr } = await execAsync(command, execOptions);

    const stdoutStr = stdout ? stdout.toString() : "";
    const stderrStr = stderr ? stderr.toString() : "";
    return formatShellOutput(command, stdoutStr, stderrStr, 0);
  } catch (error: unknown) {
    const execError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };

    let errorMessage =
      execError.stderr || execError.message || "Command failed";
    let exitCode =
      typeof execError.code === "number" ? execError.code : 1;

    if (execError.killed || execError.code === "ETIMEDOUT") {
      errorMessage = "Command timed out (30s limit)";
      exitCode = -1;
    }

    const errorStdout = execError.stdout
      ? execError.stdout.toString()
      : "";
    return formatShellOutput(command, errorStdout, errorMessage, exitCode);
  }
}
