import chalk from 'chalk';
import { readCredentials, clearCredentials, clearMachineId, readSettings } from '@/persistence';
import { authAndSetupMachineIfNeeded } from '@/ui/auth';
import { configuration } from '@/configuration';
import { existsSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { stopDaemon, checkDaemonStatus } from '@/daemon/controlClient';
import { logger } from '@/ui/logger';
import os from 'node:os';

export async function handleAuthCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    showAuthHelp();
    return;
  }

  switch (subcommand) {
    case 'login':
      await handleAuthLogin(args.slice(1));
      break;
    case 'logout':
      await handleAuthLogout();
      break;
    case 'status':
      await handleAuthStatus();
      break;
    default:
      logger.printError(chalk.red(`Unknown auth subcommand: ${subcommand}`));
      showAuthHelp();
      process.exit(1);
  }
}

function showAuthHelp(): void {
  logger.print(`
${chalk.bold('happy auth')} - Authentication management

${chalk.bold('Usage:')}
  happy auth login [--force]    Authenticate with Happy
  happy auth logout             Remove authentication and machine data
  happy auth status             Show authentication status
  happy auth help               Show this help message

${chalk.bold('Options:')}
  --force    Clear credentials, machine ID, and stop daemon before re-auth

${chalk.gray('PS: Your master secret never leaves your mobile/web device. Each CLI machine')}
${chalk.gray('receives only a derived key for per-machine encryption, so backup codes')}
${chalk.gray('cannot be displayed from the CLI.')}
`);
}

async function handleAuthLogin(args: string[]): Promise<void> {
  const forceAuth = args.includes('--force') || args.includes('-f');

  if (forceAuth) {
    // As per user's request: "--force-auth will clear credentials, clear machine ID, stop daemon"
    logger.print(chalk.yellow('Force authentication requested.'));
    logger.print(chalk.gray('This will:'));
    logger.print(chalk.gray('  • Clear existing credentials'));
    logger.print(chalk.gray('  • Clear machine ID'));
    logger.print(chalk.gray('  • Stop daemon if running'));
    logger.print(chalk.gray('  • Re-authenticate and register machine\n'));

    // Stop daemon if running
    try {
      logger.debug('Stopping daemon for force auth...');
      await stopDaemon();
      logger.print(chalk.gray('✓ Stopped daemon'));
    } catch (error) {
      logger.debug('Daemon was not running or failed to stop:', error);
    }

    // Clear credentials
    await clearCredentials();
    logger.print(chalk.gray('✓ Cleared credentials'));

    // Clear machine ID
    await clearMachineId();
    logger.print(chalk.gray('✓ Cleared machine ID'));

    logger.print('');
  }

  // Check if already authenticated (if not forcing)
  if (!forceAuth) {
    const existingCreds = await readCredentials();
    const settings = await readSettings();

    if (existingCreds && settings?.machineId) {
      logger.print(chalk.green('✓ Already authenticated'));
      logger.print(chalk.gray(`  Machine ID: ${settings.machineId}`));
      logger.print(chalk.gray(`  Host: ${os.hostname()}`));
      logger.print(chalk.gray(`  Use 'happy auth login --force' to re-authenticate`));
      return;
    } else if (existingCreds && !settings?.machineId) {
      logger.print(chalk.yellow('⚠️  Credentials exist but machine ID is missing'));
      logger.print(chalk.gray('  This can happen if --auth flag was used previously'));
      logger.print(chalk.gray('  Fixing by setting up machine...\n'));
    }
  }

  // Perform authentication and machine setup
  // "Finally we'll run the auth and setup machine if needed"
  try {
    const result = await authAndSetupMachineIfNeeded();
    logger.print(chalk.green('\n✓ Authentication successful'));
    logger.print(chalk.gray(`  Machine ID: ${result.machineId}`));
  } catch (error) {
    logger.printError(chalk.red('Authentication failed:'), error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

async function handleAuthLogout(): Promise<void> {
  // "auth logout will essentially clear the private key that originally came from the phone"
  const happyDir = configuration.happyHomeDir;

  // Check if authenticated
  const credentials = await readCredentials();
  if (!credentials) {
    logger.print(chalk.yellow('Not currently authenticated'));
    return;
  }

  logger.print(chalk.blue('This will log you out of Happy'));
  logger.print(chalk.yellow('⚠️  You will need to re-authenticate to use Happy again'));

  // Ask for confirmation
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.yellow('Are you sure you want to log out? (y/N): '), resolve);
  });

  rl.close();

  if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
    try {
      // Stop daemon if running
      try {
        await stopDaemon();
        logger.print(chalk.gray('Stopped daemon'));
      } catch { }

      // Remove entire happy directory (as current logout does)
      if (existsSync(happyDir)) {
        rmSync(happyDir, { recursive: true, force: true });
      }

      logger.print(chalk.green('✓ Successfully logged out'));
      logger.print(chalk.gray('  Run "happy auth login" to authenticate again'));
    } catch (error) {
      throw new Error(`Failed to logout: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else {
    logger.print(chalk.blue('Logout cancelled'));
  }
}

async function handleAuthStatus(): Promise<void> {
  const credentials = await readCredentials();
  const settings = await readSettings();

  logger.print(chalk.bold('\nAuthentication Status\n'));

  if (!credentials) {
    logger.print(chalk.red('✗ Not authenticated'));
    logger.print(chalk.gray('  Run "happy auth login" to authenticate'));
    return;
  }

  logger.print(chalk.green('✓ Authenticated'));

  // Token preview (first few chars for security)
  const tokenPreview = credentials.token.substring(0, 30) + '...';
  logger.print(chalk.gray(`  Token: ${tokenPreview}`));

  // Machine status
  if (settings?.machineId) {
    logger.print(chalk.green('✓ Machine registered'));
    logger.print(chalk.gray(`  Machine ID: ${settings.machineId}`));
    logger.print(chalk.gray(`  Host: ${os.hostname()}`));
  } else {
    logger.print(chalk.yellow('⚠️  Machine not registered'));
    logger.print(chalk.gray('  Run "happy auth login --force" to fix this'));
  }

  // Data location
  logger.print(chalk.gray(`\n  Data directory: ${configuration.happyHomeDir}`));

  // Daemon status
  try {
    const running = (await checkDaemonStatus()).status === 'running';
    if (running) {
      logger.print(chalk.green('✓ Daemon running'));
    } else {
      logger.print(chalk.gray('✗ Daemon not running'));
    }
  } catch {
    logger.print(chalk.gray('✗ Daemon not running'));
  }
}