/**
 * Doctor command implementation
 * 
 * Provides comprehensive diagnostics and troubleshooting information
 * for happy CLI including configuration, daemon status, logs, and links
 */

import chalk from 'chalk'
import { configuration } from '@/configuration'
import { readSettings, readCredentials } from '@/persistence'
import { checkDaemonStatus, getDaemonAutomationStatus } from '@/daemon/controlClient'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { projectPath } from '@/projectPath'
import packageJson from '../../package.json'
import type { AutomationJob } from '@/automation/types'
import { sanitizeProcessArgv } from '@/utils/securityRedaction'

/**
 * Get relevant environment information for debugging
 */
export function getEnvironmentInfo(): Record<string, any> {
    return {
        PWD: process.env.PWD,
        HAPPY_HOME_DIR: process.env.HAPPY_HOME_DIR,
        HAPPY_SERVER_URL: process.env.HAPPY_SERVER_URL,
        HAPPY_PROJECT_ROOT: process.env.HAPPY_PROJECT_ROOT,
        DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING: process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING,
        NODE_ENV: process.env.NODE_ENV,
        DEBUG: process.env.DEBUG,
        workingDirectory: process.cwd(),
        processArgv: sanitizeProcessArgv(process.argv),
        happyDir: configuration?.happyHomeDir,
        serverUrl: configuration?.serverUrl,
        logsDir: configuration?.logsDir,
        processPid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        user: process.env.USER,
        home: process.env.HOME,
        shell: process.env.SHELL,
        terminal: process.env.TERM,
    };
}

function getLogFiles(logDir: string): { file: string, path: string, modified: Date }[] {
    if (!existsSync(logDir)) {
        return [];
    }

    try {
        return readdirSync(logDir, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.log'))
            .map(entry => {
                const fullPath = join(logDir, entry.name);
                const stats = statSync(fullPath);
                return { file: entry.name, path: fullPath, modified: stats.mtime };
            })
            .sort((a, b) => b.modified.getTime() - a.modified.getTime());
    } catch {
        return [];
    }
}

/**
 * Run doctor command specifically for daemon diagnostics
 */
export async function runDoctorDaemon(): Promise<void> {
    return runDoctorCommand('daemon');
}

export async function runDoctorCommand(filter?: 'all' | 'daemon'): Promise<void> {
    // Default to 'all' if no filter specified
    if (!filter) {
        filter = 'all';
    }
    
    logger.print(chalk.bold.cyan('\n🩺 Happy CLI Doctor\n'));

    // For 'all' filter, show everything. For 'daemon', only show daemon-related info
    if (filter === 'all') {
        // Version and basic info
        logger.print(chalk.bold('📋 Basic Information'));
        logger.print(`Happy CLI Version: ${chalk.green(packageJson.version)}`);
        logger.print(`Platform: ${chalk.green(process.platform)} ${process.arch}`);
        logger.print(`Node.js Version: ${chalk.green(process.version)}`);
        logger.print('');

        // Daemon spawn diagnostics
        logger.print(chalk.bold('🔧 Daemon Spawn Diagnostics'));
        const projectRoot = projectPath();
        const wrapperPath = join(projectRoot, 'bin', 'happy.mjs');
        const cliEntrypoint = join(projectRoot, 'dist', 'index.mjs');
        
        logger.print(`Project Root: ${chalk.blue(projectRoot)}`);
        logger.print(`Wrapper Script: ${chalk.blue(wrapperPath)}`);
        logger.print(`CLI Entrypoint: ${chalk.blue(cliEntrypoint)}`);
        logger.print(`Wrapper Exists: ${existsSync(wrapperPath) ? chalk.green('✓ Yes') : chalk.red('❌ No')}`);
        logger.print(`CLI Exists: ${existsSync(cliEntrypoint) ? chalk.green('✓ Yes') : chalk.red('❌ No')}`);
        logger.print('');

        // Configuration
        logger.print(chalk.bold('⚙️  Configuration'));
        logger.print(`Happy Home: ${chalk.blue(configuration.happyHomeDir)}`);
        logger.print(`Server URL: ${chalk.blue(configuration.serverUrl)}`);
        logger.print(`Logs Dir: ${chalk.blue(configuration.logsDir)}`);

        // Environment
        logger.print(chalk.bold('\n🌍 Environment Variables'));
        const env = getEnvironmentInfo();
        logger.print(`HAPPY_HOME_DIR: ${env.HAPPY_HOME_DIR ? chalk.green(env.HAPPY_HOME_DIR) : chalk.gray('not set')}`);
        logger.print(`HAPPY_SERVER_URL: ${env.HAPPY_SERVER_URL ? chalk.green(env.HAPPY_SERVER_URL) : chalk.gray('not set')}`);
        logger.print(`DANGEROUSLY_LOG_TO_SERVER: ${env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING ? chalk.yellow('ENABLED') : chalk.gray('not set')}`);
        logger.print(`DEBUG: ${env.DEBUG ? chalk.green(env.DEBUG) : chalk.gray('not set')}`);
        logger.print(`NODE_ENV: ${env.NODE_ENV ? chalk.green(env.NODE_ENV) : chalk.gray('not set')}`);

        // Settings
        try {
            const settings = await readSettings();
            logger.print(chalk.bold('\n📄 Settings (settings.json):'));
            logger.print(chalk.gray(JSON.stringify(settings, null, 2)));
        } catch (error) {
            logger.print(chalk.bold('\n📄 Settings:'));
            logger.print(chalk.red('❌ Failed to read settings'));
        }

        // Authentication status
        logger.print(chalk.bold('\n🔐 Authentication'));
        try {
            const credentials = await readCredentials();
            if (credentials) {
                logger.print(chalk.green('✓ Authenticated (credentials found)'));
            } else {
                logger.print(chalk.yellow('⚠️  Not authenticated (no credentials)'));
            }
        } catch (error) {
            logger.print(chalk.red('❌ Error reading credentials'));
        }
    }

    // Daemon status - shown for both 'all' and 'daemon' filters
    logger.print(chalk.bold('\n🤖 Daemon Status'));
    try {
        const result = await checkDaemonStatus();

        if (result.status === 'running') {
            const state = result.state;
            logger.print(chalk.green('✓ Daemon is running'));
            logger.print(`  PID: ${state.pid}`);
            logger.print(`  Started: ${new Date(state.startTime).toLocaleString()}`);
            logger.print(`  CLI Version: ${state.startedWithCliVersion}`);
            if (state.httpPort) {
                logger.print(`  HTTP Port: ${state.httpPort}`);
            }
        } else if (result.status === 'stale-cleaned') {
            logger.print(chalk.yellow('⚠️  Daemon state exists but process not running (stale)'));
        } else {
            logger.print(chalk.red('❌ Daemon is not running'));
        }

        const state = await readDaemonState();

        const automationStatus = await getDaemonAutomationStatus();
        if (automationStatus && (automationStatus.jobs.length > 0 || (automationStatus.guardians?.length ?? 0) > 0)) {
            logger.print(chalk.bold('\n⚙️  Automation Jobs'));
            const countEntries = Object.entries(automationStatus.counts).sort(([a], [b]) => a.localeCompare(b));
            if (countEntries.length > 0) {
                logger.print(`  Counts: ${countEntries.map(([key, value]) => `${key}=${value}`).join(', ')}`);
            }
            if ((automationStatus.guardians?.length ?? 0) > 0) {
                logger.print(`  Guardians: ${automationStatus.guardians!.map((guardian) => `${guardian.key}→${guardian.sessionId}`).join(', ')}`);
            }
            automationStatus.jobs.slice(0, 10).forEach((job: AutomationJob) => {
                logger.print(`  - ${job.kind} ${job.status} ${job.priority} attempt=${job.attempt}/${job.maxAttempts} id=${job.id} label=${job.label ?? job.dedupeKey}${job.projectId ? ` project=${job.projectId}` : ""}${job.loopId ? ` loop=${job.loopId}` : ""}${job.sessionId ? ` session=${job.sessionId}` : ""}`);
            });
            if (automationStatus.jobs.length > 10) {
                logger.print(chalk.gray(`  ... and ${automationStatus.jobs.length - 10} more jobs`));
            }
        }

        // Show daemon state file
        if (state) {
            logger.print(chalk.bold('\n📄 Daemon State:'));
            logger.print(chalk.blue(`Location: ${configuration.daemonStateFile}`));
            logger.print(chalk.gray(JSON.stringify(state, null, 2)));
        }

        // All Happy processes
        const allProcesses = await findAllHappyProcesses();
        if (allProcesses.length > 0) {
            logger.print(chalk.bold('\n🔍 All Happy CLI Processes'));

            // Group by type
            const grouped = allProcesses.reduce((groups, process) => {
                if (!groups[process.type]) groups[process.type] = [];
                groups[process.type].push(process);
                return groups;
            }, {} as Record<string, typeof allProcesses>);

            // Display each group
            Object.entries(grouped).forEach(([type, processes]) => {
                const typeLabels: Record<string, string> = {
                    'current': '📍 Current Process',
                    'daemon': '🤖 Daemon',
                    'daemon-version-check': '🔍 Daemon Version Check (stuck)',
                    'daemon-spawned-session': '🔗 Daemon-Spawned Sessions',
                    'user-session': '👤 User Sessions',
                    'dev-daemon': '🛠️  Dev Daemon',
                    'dev-daemon-version-check': '🛠️  Dev Daemon Version Check (stuck)',
                    'dev-session': '🛠️  Dev Sessions',
                    'dev-doctor': '🛠️  Dev Doctor',
                    'dev-related': '🛠️  Dev Related',
                    'doctor': '🩺 Doctor',
                    'unknown': '❓ Unknown'
                };

                logger.print(chalk.blue(`\n${typeLabels[type] || type}:`));
                processes.forEach(({ pid, command }) => {
                    const color = type === 'current' ? chalk.green :
                        type.startsWith('dev') ? chalk.cyan :
                            type.includes('daemon') ? chalk.blue : chalk.gray;
                    logger.print(`  ${color(`PID ${pid}`)}: ${chalk.gray(command)}`);
                });
            });
        } else {
            logger.print(chalk.red('❌ No happy processes found'));
        }

        if (filter === 'all' && allProcesses.length > 1) { // More than just current process
            logger.print(chalk.bold('\n💡 Process Management'));
            logger.print(chalk.gray('To clean up runaway processes: happy doctor clean'));
        }
    } catch (error) {
        logger.print(chalk.red('❌ Error checking daemon status'));
    }

    // Log files - only show for 'all' filter
    if (filter === 'all') {
        logger.print(chalk.bold('\n📝 Log Files'));

        // Get ALL log files
        const allLogs = getLogFiles(configuration.logsDir);
        
        if (allLogs.length > 0) {
            // Separate daemon and regular logs
            const daemonLogs = allLogs.filter(({ file }) => file.includes('daemon'));
            const regularLogs = allLogs.filter(({ file }) => !file.includes('daemon'));

            // Show regular logs (max 10)
            if (regularLogs.length > 0) {
                logger.print(chalk.blue('\nRecent Logs:'));
                const logsToShow = regularLogs.slice(0, 10);
                logsToShow.forEach(({ file, path, modified }) => {
                    logger.print(`  ${chalk.green(file)} - ${modified.toLocaleString()}`);
                    logger.print(chalk.gray(`    ${path}`));
                });
                if (regularLogs.length > 10) {
                    logger.print(chalk.gray(`  ... and ${regularLogs.length - 10} more log files`));
                }
            }

            // Show daemon logs (max 5)
            if (daemonLogs.length > 0) {
                logger.print(chalk.blue('\nDaemon Logs:'));
                const daemonLogsToShow = daemonLogs.slice(0, 5);
                daemonLogsToShow.forEach(({ file, path, modified }) => {
                    logger.print(`  ${chalk.green(file)} - ${modified.toLocaleString()}`);
                    logger.print(chalk.gray(`    ${path}`));
                });
                if (daemonLogs.length > 5) {
                    logger.print(chalk.gray(`  ... and ${daemonLogs.length - 5} more daemon log files`));
                }
            } else {
                logger.print(chalk.yellow('\nNo daemon log files found'));
            }
        } else {
            logger.print(chalk.yellow('No log files found'));
        }

        // Support and bug reports
        logger.print(chalk.bold('\n🐛 Support & Bug Reports'));
        logger.print(`Report issues: ${chalk.blue('https://github.com/slopus/happy-cli/issues')}`);
        logger.print(`Documentation: ${chalk.blue('https://happy.engineering/')}`);
    }

    logger.print(chalk.green('\n✅ Doctor diagnosis complete!\n'));
}
