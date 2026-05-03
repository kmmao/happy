import chalk from "chalk";
import { writeFile } from "node:fs/promises";
import { configuration } from "@/configuration";
import { readCredentials } from "@/persistence";
import { logger } from "@/ui/logger";

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return !value || value.startsWith("--") ? undefined : value;
}

export async function handleTranscriptCommand(args: string[]): Promise<void> {
  const sessionId = args[0];

  if (!sessionId || sessionId === "--help" || sessionId === "-h") {
    logger.print(`
${chalk.bold("happy transcript")} - Export session transcript as JSONL

${chalk.bold("Usage:")}
  happy transcript <sessionId> [options]

${chalk.bold("Options:")}
  -o, --out <file>     Write output to file instead of stdout
  --format jsonl|json  Output format (default: jsonl)
  -h, --help           Show this help

${chalk.bold("Examples:")}
  happy transcript abc123                    Print JSONL to stdout
  happy transcript abc123 -o session.jsonl   Save to file
  happy transcript abc123 --format json      JSON array format
`);
    return;
  }

  const outFile = readFlagValue(args, "--out") ?? readFlagValue(args, "-o");
  const format = readFlagValue(args, "--format") ?? "jsonl";

  if (format !== "jsonl" && format !== "json") {
    logger.printError(chalk.red(`Invalid format: ${format}. Must be "jsonl" or "json".`));
    process.exit(1);
  }

  const credentials = await readCredentials();
  if (!credentials) {
    logger.printError(
      chalk.red('Not authenticated. Run "happy auth login" first.'),
    );
    process.exit(1);
  }

  const url = `${configuration.serverUrl}/v1/sessions/${sessionId}/transcript?format=${format}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${credentials.token}` },
    });
  } catch (error) {
    logger.printError(
      chalk.red(`Network error: ${error instanceof Error ? error.message : String(error)}`),
    );
    process.exit(1);
  }

  if (response.status === 404) {
    logger.printError(chalk.red(`Session not found: ${sessionId}`));
    process.exit(1);
  }

  if (!response.ok) {
    logger.printError(chalk.red(`Server error: ${response.status} ${response.statusText}`));
    process.exit(1);
  }

  const text = await response.text();

  if (outFile) {
    await writeFile(outFile, text, "utf8");
    logger.print(chalk.green(`✓ Transcript saved to: ${outFile}`));
  } else {
    process.stdout.write(text);
    if (!text.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
}
