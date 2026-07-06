/**
 * Low-level ripgrep wrapper - just arguments in, string out
 */

import { projectPath } from '@/projectPath';
import { join, resolve } from 'path';
import { spawnAndCollect } from '@/utils/spawnAndCollect';

export interface RipgrepResult {
    exitCode: number
    stdout: string
    stderr: string
}

export interface RipgrepOptions {
    cwd?: string
}

/**
 * Run ripgrep with the given arguments
 * @param args - Array of command line arguments to pass to ripgrep
 * @param options - Options for ripgrep execution
 * @returns Promise with exit code, stdout and stderr
 */
export function run(args: string[], options?: RipgrepOptions): Promise<RipgrepResult> {
    const RUNNER_PATH = resolve(join(projectPath(), 'scripts', 'ripgrep_launcher.cjs'));
    return spawnAndCollect('node', [RUNNER_PATH, JSON.stringify(args)], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: options?.cwd
    });
}