/**
 * Tests for Claude settings reading functionality
 *
 * Tests reading Claude's settings.json file,
 * plus the dual-source MCP server resolution (`~/.claude.json` + `~/.claude/settings.json`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  readClaudeSettings,
  readClaudeRootConfig,
  readClaudeMcpServers,
  readClaudeDisabledMcpServers,
  readClaudePluginMcpServers,
  markDisabledMcpServers,
  writeClaudeDisabledMcpServers,
} from './claudeSettings';

describe('Claude Settings', () => {
  let testClaudeDir: string;
  let testRootConfigPath: string;
  let originalClaudeConfigDir: string | undefined;

  beforeEach(() => {
    // Create a temporary directory for testing. `CLAUDE_CONFIG_DIR` points
    // here (the equivalent of `~/.claude`), while the root config file
    // (~/.claude.json) lives as a sibling inside the same tmpdir parent.
    testClaudeDir = join(tmpdir(), `test-claude-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testClaudeDir, { recursive: true });
    testRootConfigPath = join(dirname(testClaudeDir), '.claude.json');

    // Set environment variable to point to test directory
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = testClaudeDir;
  });

  afterEach(() => {
    // Restore original environment variable
    if (originalClaudeConfigDir !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }

    // Clean up test directory
    if (existsSync(testClaudeDir)) {
      rmSync(testClaudeDir, { recursive: true, force: true });
    }
    if (existsSync(testRootConfigPath)) {
      rmSync(testRootConfigPath, { force: true });
    }
  });

  describe('readClaudeSettings', () => {
    it('returns null when settings file does not exist', () => {
      const settings = readClaudeSettings();
      expect(settings).toBe(null);
    });

    it('reads settings when file exists', () => {
      const settingsPath = join(testClaudeDir, 'settings.json');
      const testSettings = { otherSetting: 'value' };
      writeFileSync(settingsPath, JSON.stringify(testSettings));

      const settings = readClaudeSettings();
      expect(settings).toEqual(testSettings);
    });

    it('returns null when settings file is invalid JSON', () => {
      const settingsPath = join(testClaudeDir, 'settings.json');
      writeFileSync(settingsPath, 'invalid json');

      const settings = readClaudeSettings();
      expect(settings).toBe(null);
    });
  });


  describe('readClaudeRootConfig', () => {
    it('returns null when ~/.claude.json does not exist', () => {
      expect(readClaudeRootConfig()).toBe(null);
    });

    it('reads ~/.claude.json when present', () => {
      const payload = {
        mcpServers: {
          'chrome-devtools': { type: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp'] },
        },
        unrelatedField: 'ignored',
      };
      writeFileSync(testRootConfigPath, JSON.stringify(payload));

      expect(readClaudeRootConfig()).toEqual(payload);
    });

    it('returns null when ~/.claude.json is invalid JSON', () => {
      writeFileSync(testRootConfigPath, '{ not valid');
      expect(readClaudeRootConfig()).toBe(null);
    });
  });

  describe('readClaudeMcpServers', () => {
    it('returns {} when neither source provides mcpServers', () => {
      expect(readClaudeMcpServers()).toEqual({});
    });

    it('reads mcpServers from ~/.claude.json (the /mcp source-of-truth)', () => {
      writeFileSync(
        testRootConfigPath,
        JSON.stringify({
          mcpServers: {
            'chrome-devtools': { type: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp'] },
          },
        }),
      );

      expect(readClaudeMcpServers()).toEqual({
        'chrome-devtools': { type: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp'] },
      });
    });

    it('falls back to ~/.claude/settings.json when root config has none', () => {
      writeFileSync(
        join(testClaudeDir, 'settings.json'),
        JSON.stringify({
          mcpServers: {
            legacy: { type: 'stdio', command: 'node', args: ['legacy.js'] },
          },
        }),
      );

      expect(readClaudeMcpServers()).toEqual({
        legacy: { type: 'stdio', command: 'node', args: ['legacy.js'] },
      });
    });

    it('merges both sources with ~/.claude.json winning on name conflict', () => {
      writeFileSync(
        join(testClaudeDir, 'settings.json'),
        JSON.stringify({
          mcpServers: {
            shared: { type: 'stdio', command: 'old-bin' },
            settings_only: { type: 'stdio', command: 'one' },
          },
        }),
      );
      writeFileSync(
        testRootConfigPath,
        JSON.stringify({
          mcpServers: {
            shared: { type: 'stdio', command: 'new-bin' },
            root_only: { type: 'stdio', command: 'two' },
          },
        }),
      );

      expect(readClaudeMcpServers()).toEqual({
        // Root config wins on conflict
        shared: { type: 'stdio', command: 'new-bin' },
        settings_only: { type: 'stdio', command: 'one' },
        root_only: { type: 'stdio', command: 'two' },
      });
    });

    it('ignores malformed mcpServers (array instead of object)', () => {
      writeFileSync(
        testRootConfigPath,
        JSON.stringify({ mcpServers: ['not', 'an', 'object'] }),
      );

      expect(readClaudeMcpServers()).toEqual({});
    });

    it('survives invalid JSON in either source without throwing', () => {
      writeFileSync(testRootConfigPath, '{ this is not json');
      writeFileSync(join(testClaudeDir, 'settings.json'), 'also not json');

      expect(readClaudeMcpServers()).toEqual({});
    });
  });

  describe('readClaudeDisabledMcpServers', () => {
    const cwd = '/Users/test/project';

    it('returns [] when ~/.claude.json is missing', () => {
      expect(readClaudeDisabledMcpServers(cwd)).toEqual([]);
    });

    it('returns [] when projects map is missing', () => {
      writeFileSync(testRootConfigPath, JSON.stringify({ mcpServers: {} }));
      expect(readClaudeDisabledMcpServers(cwd)).toEqual([]);
    });

    it('returns [] when the project slot does not exist', () => {
      writeFileSync(
        testRootConfigPath,
        JSON.stringify({ projects: { '/some/other/path': { disabledMcpServers: ['x'] } } }),
      );
      expect(readClaudeDisabledMcpServers(cwd)).toEqual([]);
    });

    it('returns [] when disabledMcpServers field is missing', () => {
      writeFileSync(
        testRootConfigPath,
        JSON.stringify({ projects: { [cwd]: { allowedTools: [] } } }),
      );
      expect(readClaudeDisabledMcpServers(cwd)).toEqual([]);
    });

    it('returns the disabled names when present', () => {
      writeFileSync(
        testRootConfigPath,
        JSON.stringify({
          projects: {
            [cwd]: { disabledMcpServers: ['chrome-devtools', 'figma'] },
          },
        }),
      );
      expect(readClaudeDisabledMcpServers(cwd)).toEqual(['chrome-devtools', 'figma']);
    });

    it('filters out non-string and empty entries defensively', () => {
      writeFileSync(
        testRootConfigPath,
        JSON.stringify({
          projects: {
            [cwd]: { disabledMcpServers: ['ok', '', 42, null, 'also-ok'] },
          },
        }),
      );
      expect(readClaudeDisabledMcpServers(cwd)).toEqual(['ok', 'also-ok']);
    });

    it('returns [] when disabledMcpServers is malformed (object, not array)', () => {
      writeFileSync(
        testRootConfigPath,
        JSON.stringify({
          projects: { [cwd]: { disabledMcpServers: { not: 'an array' } } },
        }),
      );
      expect(readClaudeDisabledMcpServers(cwd)).toEqual([]);
    });

    it('returns [] when ~/.claude.json itself is invalid JSON', () => {
      writeFileSync(testRootConfigPath, '{ not json');
      expect(readClaudeDisabledMcpServers(cwd)).toEqual([]);
    });
  });

  describe('markDisabledMcpServers', () => {
    const servers = {
      'chrome-devtools': { type: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp'] },
      figma: { type: 'http', url: 'https://figma.example' },
      happy: { type: 'http', url: 'http://localhost/happy' },
    };

    it('returns the input unchanged when no names are disabled', () => {
      expect(markDisabledMcpServers(servers, [])).toBe(servers);
    });

    it('annotates `disabled: true` on matching entries (only)', () => {
      const result = markDisabledMcpServers(servers, ['chrome-devtools']);
      expect(result).toEqual({
        'chrome-devtools': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp'],
          disabled: true,
        },
        figma: { type: 'http', url: 'https://figma.example' },
        happy: { type: 'http', url: 'http://localhost/happy' },
      });
    });

    it('does not mutate the original map or its entries', () => {
      const input = {
        a: { type: 'stdio', command: 'x' },
        b: { type: 'http', url: 'u' },
      };
      markDisabledMcpServers(input, ['a']);
      expect(input).toEqual({
        a: { type: 'stdio', command: 'x' },
        b: { type: 'http', url: 'u' },
      });
    });

    it('ignores names that are disabled but not present in the map', () => {
      const result = markDisabledMcpServers(servers, ['ghost']);
      expect(result).toEqual(servers);
      // Same values, but a fresh outer object because disabledNames was non-empty.
      expect(result).not.toBe(servers);
    });

    it('leaves non-object entries untouched (defensive)', () => {
      const input: Record<string, unknown> = {
        a: { type: 'stdio', command: 'x' },
        b: 'not an object',
        c: null,
        d: ['array'],
      };
      const result = markDisabledMcpServers(input, ['a', 'b', 'c', 'd']);
      expect(result).toEqual({
        a: { type: 'stdio', command: 'x', disabled: true },
        b: 'not an object',
        c: null,
        d: ['array'],
      });
    });
  });

  describe('writeClaudeDisabledMcpServers', () => {
    const cwd = '/Users/test/project';

    function readBack(): any {
      return JSON.parse(readFileSync(testRootConfigPath, 'utf-8'));
    }

    it('creates ~/.claude.json from scratch when it does not exist', () => {
      expect(existsSync(testRootConfigPath)).toBe(false);

      const ok = writeClaudeDisabledMcpServers(cwd, ['chrome-devtools']);
      expect(ok).toBe(true);

      const written = readBack();
      expect(written).toEqual({
        projects: {
          [cwd]: { disabledMcpServers: ['chrome-devtools'] },
        },
      });
    });

    it('writes an empty array (not undefined) when names is empty', () => {
      writeClaudeDisabledMcpServers(cwd, ['x']);
      const ok = writeClaudeDisabledMcpServers(cwd, []);
      expect(ok).toBe(true);
      expect(readBack().projects[cwd].disabledMcpServers).toEqual([]);
    });

    it('preserves every untouched top-level field', () => {
      writeFileSync(
        testRootConfigPath,
        JSON.stringify({
          mcpServers: { keep: { type: 'stdio', command: 'keep' } },
          customField: 'hi',
          numericField: 42,
          projects: {
            '/some/other': { disabledMcpServers: ['leave-me'] },
          },
        }),
      );

      writeClaudeDisabledMcpServers(cwd, ['figma']);

      const written = readBack();
      expect(written.mcpServers).toEqual({
        keep: { type: 'stdio', command: 'keep' },
      });
      expect(written.customField).toBe('hi');
      expect(written.numericField).toBe(42);
      expect(written.projects['/some/other']).toEqual({
        disabledMcpServers: ['leave-me'],
      });
      expect(written.projects[cwd]).toEqual({
        disabledMcpServers: ['figma'],
      });
    });

    it('preserves untouched fields on the same project slot', () => {
      writeFileSync(
        testRootConfigPath,
        JSON.stringify({
          projects: {
            [cwd]: {
              disabledMcpServers: ['old'],
              allowedTools: ['Bash'],
              history: { lastPrompt: 'hi' },
            },
          },
        }),
      );

      writeClaudeDisabledMcpServers(cwd, ['new']);

      const written = readBack();
      expect(written.projects[cwd]).toEqual({
        disabledMcpServers: ['new'],
        allowedTools: ['Bash'],
        history: { lastPrompt: 'hi' },
      });
    });

    it('deduplicates and drops empty / non-string entries before persisting', () => {
      // Caller could pass garbage in pure-JS land; cast through unknown so the
      // defensive filter is exercised without poisoning the rest of the file
      // with @ts-expect-error directives.
      const ok = writeClaudeDisabledMcpServers(
        cwd,
        (['a', 'a', '', 42, null, 'b'] as unknown) as readonly string[],
      );
      expect(ok).toBe(true);
      expect(readBack().projects[cwd].disabledMcpServers).toEqual(['a', 'b']);
    });

    it('does not leave a stray temp file behind on success', () => {
      writeClaudeDisabledMcpServers(cwd, ['x']);
      // Temp files share the rootPath prefix + `.tmp` suffix.
      const dir = dirname(testRootConfigPath);
      const entries = readdirSync(dir);
      const strays = entries.filter((e) => e.startsWith('.claude.json.') && e.endsWith('.tmp'));
      expect(strays).toEqual([]);
    });

    it('refuses to overwrite when ~/.claude.json is unreadable JSON', () => {
      writeFileSync(testRootConfigPath, '{ not json');
      const before = readFileSync(testRootConfigPath, 'utf-8');

      const ok = writeClaudeDisabledMcpServers(cwd, ['x']);
      expect(ok).toBe(false);

      // File untouched — operator can still repair it by hand.
      const after = readFileSync(testRootConfigPath, 'utf-8');
      expect(after).toBe(before);
    });

    it('refuses to overwrite when ~/.claude.json is a JSON array (not an object)', () => {
      writeFileSync(testRootConfigPath, JSON.stringify(['nope']));
      const ok = writeClaudeDisabledMcpServers(cwd, ['x']);
      expect(ok).toBe(false);
      expect(readBack()).toEqual(['nope']);
    });

    it('round-trips through readClaudeDisabledMcpServers', () => {
      writeClaudeDisabledMcpServers(cwd, ['alpha', 'beta']);
      expect(readClaudeDisabledMcpServers(cwd)).toEqual(['alpha', 'beta']);
    });
  });

  describe('readClaudePluginMcpServers', () => {
    // Each test seeds plugin install dirs + a manifest that points at them.
    // The install dir layout mirrors what Claude Code writes to
    // `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/.mcp.json`.

    function seedPlugin(opts: {
      key: string; // "<plugin>@<marketplace>"
      mcpJson?: unknown; // contents to write at <installPath>/.mcp.json
      omitMcpJson?: boolean;
      installPathOverride?: string; // for malformed-path tests
    }): { installPath: string } {
      const [pluginName, marketplace] = opts.key.split('@');
      const installPath =
        opts.installPathOverride ??
        join(testClaudeDir, 'plugins', 'cache', marketplace, pluginName, 'unknown');
      mkdirSync(installPath, { recursive: true });
      if (!opts.omitMcpJson) {
        writeFileSync(join(installPath, '.mcp.json'), JSON.stringify(opts.mcpJson));
      }
      return { installPath };
    }

    function seedManifest(plugins: Record<string, { installPath: string }[]>): void {
      const manifestDir = join(testClaudeDir, 'plugins');
      mkdirSync(manifestDir, { recursive: true });
      writeFileSync(
        join(manifestDir, 'installed_plugins.json'),
        JSON.stringify({ version: 2, plugins }),
      );
    }

    it('returns {} when the manifest is missing', () => {
      expect(readClaudePluginMcpServers()).toEqual({});
    });

    it('returns {} when the manifest is malformed JSON', () => {
      const manifestDir = join(testClaudeDir, 'plugins');
      mkdirSync(manifestDir, { recursive: true });
      writeFileSync(join(manifestDir, 'installed_plugins.json'), '{ not json');
      expect(readClaudePluginMcpServers()).toEqual({});
    });

    it('returns {} when the manifest has no plugins map', () => {
      const manifestDir = join(testClaudeDir, 'plugins');
      mkdirSync(manifestDir, { recursive: true });
      writeFileSync(
        join(manifestDir, 'installed_plugins.json'),
        JSON.stringify({ version: 2 }),
      );
      expect(readClaudePluginMcpServers()).toEqual({});
    });

    it('reads a plugin with the flat .mcp.json shape (no `mcpServers` wrapper)', () => {
      const { installPath } = seedPlugin({
        key: 'context7@claude-plugins-official',
        mcpJson: {
          context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
        },
      });
      seedManifest({
        'context7@claude-plugins-official': [{ installPath }],
      });

      expect(readClaudePluginMcpServers()).toEqual({
        'plugin:context7:context7': {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
        },
      });
    });

    it('reads a plugin with the wrapped `mcpServers` shape', () => {
      const { installPath } = seedPlugin({
        key: 'my-plugin@marketplace-x',
        mcpJson: {
          mcpServers: {
            primary: { type: 'http', url: 'https://example.org/mcp' },
          },
        },
      });
      seedManifest({
        'my-plugin@marketplace-x': [{ installPath }],
      });

      expect(readClaudePluginMcpServers()).toEqual({
        'plugin:my-plugin:primary': { type: 'http', url: 'https://example.org/mcp' },
      });
    });

    it('emits one entry per server when a plugin contributes multiple', () => {
      const { installPath } = seedPlugin({
        key: 'multi@mp',
        mcpJson: {
          alpha: { type: 'stdio', command: 'a' },
          beta: { type: 'stdio', command: 'b' },
        },
      });
      seedManifest({
        'multi@mp': [{ installPath }],
      });

      expect(readClaudePluginMcpServers()).toEqual({
        'plugin:multi:alpha': { type: 'stdio', command: 'a' },
        'plugin:multi:beta': { type: 'stdio', command: 'b' },
      });
    });

    it('merges entries from several plugins', () => {
      const a = seedPlugin({
        key: 'context7@claude-plugins-official',
        mcpJson: { context7: { command: 'npx', args: ['-y', 'pkg'] } },
      });
      const b = seedPlugin({
        key: 'codex@openai-codex',
        mcpJson: { codex: { type: 'stdio', command: 'codex' } },
      });
      seedManifest({
        'context7@claude-plugins-official': [{ installPath: a.installPath }],
        'codex@openai-codex': [{ installPath: b.installPath }],
      });

      expect(readClaudePluginMcpServers()).toEqual({
        'plugin:context7:context7': { command: 'npx', args: ['-y', 'pkg'] },
        'plugin:codex:codex': { type: 'stdio', command: 'codex' },
      });
    });

    it('silently skips a plugin install that has no .mcp.json', () => {
      const empty = seedPlugin({
        key: 'frontend-design@claude-plugins-official',
        omitMcpJson: true,
      });
      const real = seedPlugin({
        key: 'context7@claude-plugins-official',
        mcpJson: { context7: { command: 'npx', args: ['-y', 'pkg'] } },
      });
      seedManifest({
        'frontend-design@claude-plugins-official': [{ installPath: empty.installPath }],
        'context7@claude-plugins-official': [{ installPath: real.installPath }],
      });

      // Only context7 contributes; frontend-design (no .mcp.json) is silently skipped.
      expect(readClaudePluginMcpServers()).toEqual({
        'plugin:context7:context7': { command: 'npx', args: ['-y', 'pkg'] },
      });
    });

    it('silently skips a plugin whose .mcp.json is malformed JSON', () => {
      const broken = seedPlugin({ key: 'bad@mp', mcpJson: 'placeholder' });
      // Overwrite with junk.
      writeFileSync(join(broken.installPath, '.mcp.json'), '{ this is not json');

      const good = seedPlugin({
        key: 'context7@claude-plugins-official',
        mcpJson: { context7: { command: 'x' } },
      });
      seedManifest({
        'bad@mp': [{ installPath: broken.installPath }],
        'context7@claude-plugins-official': [{ installPath: good.installPath }],
      });

      expect(readClaudePluginMcpServers()).toEqual({
        'plugin:context7:context7': { command: 'x' },
      });
    });

    it('uses the first install record when multiple scopes are present', () => {
      const userInstall = seedPlugin({
        key: 'shared@mp',
        mcpJson: { shared: { command: 'user-bin' } },
      });
      const projectInstall = seedPlugin({
        key: 'shared@mp',
        installPathOverride: join(testClaudeDir, 'plugins', 'project-scope'),
        mcpJson: { shared: { command: 'project-bin' } },
      });
      seedManifest({
        'shared@mp': [
          { installPath: userInstall.installPath },
          { installPath: projectInstall.installPath },
        ],
      });

      expect(readClaudePluginMcpServers()).toEqual({
        'plugin:shared:shared': { command: 'user-bin' },
      });
    });

    it('ignores plugin entries with no install records and bad keys', () => {
      seedManifest({
        '': [{ installPath: '/nonexistent' }],
        'plugin@with-no-installs': [],
      });
      expect(readClaudePluginMcpServers()).toEqual({});
    });

    it('respects CLAUDE_CONFIG_DIR (manifest is read from the overridden dir)', () => {
      // CLAUDE_CONFIG_DIR is already pointed at `testClaudeDir` by beforeEach,
      // so this is implicitly covered — but we make it explicit by also
      // confirming nothing is read from the real home dir.
      const { installPath } = seedPlugin({
        key: 'context7@claude-plugins-official',
        mcpJson: { context7: { command: 'x' } },
      });
      seedManifest({
        'context7@claude-plugins-official': [{ installPath }],
      });

      // The install path lives inside testClaudeDir, so the override is honoured.
      expect(installPath.startsWith(testClaudeDir)).toBe(true);
      expect(readClaudePluginMcpServers()).toHaveProperty('plugin:context7:context7');
    });
  });
});