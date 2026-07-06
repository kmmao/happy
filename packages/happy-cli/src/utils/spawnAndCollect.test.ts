/**
 * Tests for the spawn-and-collect seam.
 *
 * Uses `node -e` so the lifecycle (stdout/stderr capture, exit-code normalisation,
 * spawn-error rejection) is exercised deterministically without depending on any
 * external binary.
 */

import { describe, it, expect } from 'vitest';
import { spawnAndCollect } from './spawnAndCollect';

const node = process.execPath;

describe('spawnAndCollect', () => {
  it('captures stdout and reports a zero exit code', async () => {
    const result = await spawnAndCollect(node, ['-e', 'process.stdout.write("hello")']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('');
  });

  it('captures stderr independently of stdout', async () => {
    const result = await spawnAndCollect(node, ['-e', 'process.stderr.write("oops")']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('oops');
  });

  it('propagates a non-zero exit code', async () => {
    const result = await spawnAndCollect(node, ['-e', 'process.stdout.write("x"); process.exit(3)']);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe('x');
  });

  it('accumulates output across multiple data chunks', async () => {
    const script = 'let i=0; const t=setInterval(()=>{process.stdout.write(String(i)); if(++i===5){clearInterval(t);}},1);';
    const result = await spawnAndCollect(node, ['-e', script]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('01234');
  });

  it('rejects when the command cannot be spawned', async () => {
    await expect(
      spawnAndCollect('happy-nonexistent-binary-xyz', [])
    ).rejects.toThrow();
  });
});
