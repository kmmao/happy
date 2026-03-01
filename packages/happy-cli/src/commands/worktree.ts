import chalk from "chalk";
import { exec } from "child_process";
import { promisify } from "util";
import { generateWorktreeName } from "@/utils/generateWorktreeName";

const execAsync = promisify(exec);

interface WorktreeEntry {
  readonly path: string;
  readonly branch: string;
  readonly commit: string;
  readonly isHappyManaged: boolean;
}

export async function handleWorktreeCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (
    !subcommand ||
    subcommand === "help" ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    showWorktreeHelp();
    return;
  }

  switch (subcommand) {
    case "list":
    case "ls":
      await handleWorktreeList();
      break;
    case "create":
      await handleWorktreeCreate(args[1]);
      break;
    case "remove":
    case "rm":
      await handleWorktreeRemove(args[1]);
      break;
    default:
      console.error(chalk.red(`Unknown worktree subcommand: ${subcommand}`));
      showWorktreeHelp();
      process.exit(1);
  }
}

function showWorktreeHelp(): void {
  console.log(`
${chalk.bold("happy worktree")} - Manage git worktrees for isolated development

${chalk.bold("Usage:")}
  happy worktree <command> [options]

${chalk.bold("Commands:")}
  list, ls              List all Happy-managed worktrees
  create [path]         Create a new worktree and start a session
  remove, rm <name>     Remove a worktree and its branch

${chalk.bold("Examples:")}
  happy worktree list
  happy worktree create
  happy worktree create /path/to/repo
  happy worktree remove clever-ocean
`);
}

async function parseWorktreeList(
  cwd: string,
): Promise<readonly WorktreeEntry[]> {
  const { stdout } = await execAsync("git worktree list --porcelain", {
    cwd,
    timeout: 10000,
  });

  const entries: WorktreeEntry[] = [];
  const blocks = stdout.split("\n\n").filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    let path = "";
    let branch = "";
    let commit = "";

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.substring("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        commit = line.substring("HEAD ".length).substring(0, 8);
      } else if (line.startsWith("branch ")) {
        branch = line.substring("branch refs/heads/".length);
      }
    }

    if (path) {
      entries.push({
        path,
        branch: branch || "(detached)",
        commit,
        isHappyManaged: path.includes(".dev/worktree/"),
      });
    }
  }

  return entries;
}

async function handleWorktreeList(): Promise<void> {
  const cwd = process.cwd();

  try {
    await execAsync("git rev-parse --git-dir", { cwd, timeout: 5000 });
  } catch {
    console.error(chalk.red("Not a git repository"));
    process.exit(1);
  }

  const entries = await parseWorktreeList(cwd);
  const happyEntries = entries.filter((e) => e.isHappyManaged);

  if (happyEntries.length === 0) {
    console.log(chalk.dim("No Happy-managed worktrees found."));
    console.log(chalk.dim("Use `happy worktree create` to create one."));
    return;
  }

  console.log(chalk.bold(`Happy Worktrees (${happyEntries.length}):\n`));
  for (const entry of happyEntries) {
    const name = entry.path.split(".dev/worktree/").pop() || entry.branch;
    console.log(
      `  ${chalk.green(name)}  ${chalk.dim(entry.commit)}  ${chalk.cyan(entry.branch)}`,
    );
    console.log(`    ${chalk.dim(entry.path)}`);
  }
}

async function handleWorktreeCreate(repoPath?: string): Promise<void> {
  const cwd = repoPath || process.cwd();

  try {
    await execAsync("git rev-parse --git-dir", { cwd, timeout: 5000 });
  } catch {
    console.error(chalk.red("Not a git repository"));
    process.exit(1);
  }

  // Get current branch (will be the parent)
  const { stdout: parentBranch } = await execAsync(
    "git rev-parse --abbrev-ref HEAD",
    { cwd, timeout: 5000 },
  );

  const name = generateWorktreeName();
  const worktreePath = `.dev/worktree/${name}`;

  console.log(
    chalk.dim(`Creating worktree '${name}' from ${parentBranch.trim()}...`),
  );

  try {
    await execAsync(`git worktree add -b "${name}" "${worktreePath}"`, {
      cwd,
      timeout: 30000,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Only retry on name/path collision errors
    const isCollision =
      errorMsg.includes("already exists") ||
      errorMsg.includes("is already checked out");

    if (isCollision) {
      for (let i = 2; i <= 4; i++) {
        const retryName = `${name}-${i}`;
        const retryPath = `.dev/worktree/${retryName}`;
        try {
          await execAsync(`git worktree add -b "${retryName}" "${retryPath}"`, {
            cwd,
            timeout: 30000,
          });
          console.log(chalk.green(`Worktree created: ${retryName}`));
          console.log(chalk.dim(`  Path: ${cwd}/${retryPath}`));
          console.log(chalk.dim(`  Branch: ${retryName}`));
          console.log(chalk.dim(`  Parent: ${parentBranch.trim()}`));
          console.log(
            `\nTo start a session: ${chalk.cyan(`cd ${cwd}/${retryPath} && happy`)}`,
          );
          return;
        } catch {
          continue;
        }
      }
    }

    console.error(chalk.red(`Failed to create worktree: ${errorMsg}`));
    process.exit(1);
  }

  console.log(chalk.green(`Worktree created: ${name}`));
  console.log(chalk.dim(`  Path: ${cwd}/${worktreePath}`));
  console.log(chalk.dim(`  Branch: ${name}`));
  console.log(chalk.dim(`  Parent: ${parentBranch.trim()}`));
  console.log(
    `\nTo start a session: ${chalk.cyan(`cd ${cwd}/${worktreePath} && happy`)}`,
  );
}

async function handleWorktreeRemove(name?: string): Promise<void> {
  if (!name) {
    console.error(chalk.red("Please specify the worktree name to remove."));
    console.error(chalk.dim("Usage: happy worktree remove <name>"));
    console.error(
      chalk.dim("Use `happy worktree list` to see available worktrees."),
    );
    process.exit(1);
  }

  const cwd = process.cwd();

  try {
    await execAsync("git rev-parse --git-dir", { cwd, timeout: 5000 });
  } catch {
    console.error(chalk.red("Not a git repository"));
    process.exit(1);
  }

  const worktreePath = `.dev/worktree/${name}`;

  // Prune stale worktrees first
  try {
    await execAsync("git worktree prune", { cwd, timeout: 10000 });
  } catch {
    // Non-critical, continue
  }

  // Remove the worktree
  try {
    await execAsync(`git worktree remove "${worktreePath}"`, {
      cwd,
      timeout: 30000,
    });
    console.log(chalk.green(`Worktree removed: ${name}`));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    if (errorMsg.includes("not a working tree")) {
      console.error(chalk.red(`Worktree '${name}' not found.`));
      console.error(
        chalk.dim("Use `happy worktree list` to see available worktrees."),
      );
    } else if (errorMsg.includes("contains modified or untracked files")) {
      console.error(
        chalk.yellow(
          `Worktree '${name}' has uncommitted changes. Use --force to remove anyway.`,
        ),
      );
      // Don't force remove by default — that would destroy work
      process.exit(1);
    } else {
      console.error(chalk.red(`Failed to remove worktree: ${errorMsg}`));
      process.exit(1);
    }
    return;
  }

  // Try to delete the branch (safe delete — fails if not merged)
  try {
    await execAsync(`git branch -d "${name}"`, { cwd, timeout: 10000 });
    console.log(chalk.green(`Branch deleted: ${name}`));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "";
    if (errorMsg.includes("not fully merged")) {
      console.log(
        chalk.yellow(
          `Branch '${name}' not deleted (not fully merged). Use \`git branch -D ${name}\` to force delete.`,
        ),
      );
    } else {
      // Branch might not exist or already deleted
      console.log(chalk.dim(`Branch '${name}' already removed or not found.`));
    }
  }
}
