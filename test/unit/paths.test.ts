import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ALL_TARGET_SPECS } from '../../src/agents';
import { pathKey, resolveRoot, resolveTargets, type ResolveContext } from '../../src/paths';

function ctx(over: Partial<ResolveContext>): ResolveContext {
  return { platform: 'linux', home: '/home/u', env: {}, workspaceFolders: [], listSubdirs: () => [], ...over };
}

function pathsFor(id: string, c: ResolveContext): string[] {
  return resolveTargets(ALL_TARGET_SPECS, c)
    .filter((t) => t.id === id)
    .map((t) => t.path);
}

describe('paths: per-OS defaults', () => {
  test('Windows: home-relative agent dirs use %USERPROFILE%', () => {
    const c = ctx({ platform: 'win32', home: 'C:\\Users\\u', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' } });
    assert.deepEqual(pathsFor('claude.settings', c), ['C:\\Users\\u\\.claude\\settings.json']);
    assert.deepEqual(pathsFor('claude.state', c), ['C:\\Users\\u\\.claude.json']);
    assert.deepEqual(pathsFor('codex.config', c), ['C:\\Users\\u\\.codex\\config.toml']);
    assert.deepEqual(pathsFor('cursor.mcp', c), ['C:\\Users\\u\\.cursor\\mcp.json']);
    assert.deepEqual(pathsFor('copilot.cliMcp', c), ['C:\\Users\\u\\.copilot\\mcp-config.json']);
    // OpenCode uses ~/.config/opencode on Windows too, not %APPDATA%.
    assert.deepEqual(pathsFor('opencode.config.json', c), ['C:\\Users\\u\\.config\\opencode\\opencode.json']);
    assert.deepEqual(pathsFor('copilot.vscodeSettings', c), [
      'C:\\Users\\u\\AppData\\Roaming\\Code\\User\\settings.json',
      'C:\\Users\\u\\AppData\\Roaming\\Code - Insiders\\User\\settings.json',
    ]);
  });

  test('Windows without APPDATA falls back to AppData\\Roaming', () => {
    const c = ctx({ platform: 'win32', home: 'C:\\Users\\u' });
    assert.equal(pathsFor('copilot.vscodeSettings', c)[0], 'C:\\Users\\u\\AppData\\Roaming\\Code\\User\\settings.json');
  });

  test('macOS: VS Code settings under Library/Application Support', () => {
    const c = ctx({ platform: 'darwin', home: '/Users/u' });
    assert.equal(pathsFor('copilot.vscodeSettings', c)[0], '/Users/u/Library/Application Support/Code/User/settings.json');
    assert.deepEqual(pathsFor('codex.config', c), ['/Users/u/.codex/config.toml']);
  });

  test('Linux: VS Code settings under ~/.config, or $XDG_CONFIG_HOME', () => {
    assert.equal(pathsFor('copilot.vscodeSettings', ctx({}))[0], '/home/u/.config/Code/User/settings.json');
    const xdg = ctx({ env: { XDG_CONFIG_HOME: '/xdg' } });
    assert.equal(pathsFor('copilot.vscodeSettings', xdg)[0], '/xdg/Code/User/settings.json');
  });

  test('VS Code profiles are enumerated', () => {
    const c = ctx({ listSubdirs: (d) => (d === '/home/u/.config/Code/User/profiles' ? ['abc123'] : []) });
    assert.ok(pathsFor('copilot.vscodeSettings', c).includes('/home/u/.config/Code/User/profiles/abc123/settings.json'));
    assert.ok(pathsFor('copilot.vscodeMcp', c).includes('/home/u/.config/Code/User/profiles/abc123/mcp.json'));
  });
});

describe('paths: environment overrides watch both default and override', () => {
  test('CLAUDE_CONFIG_DIR moves ~/.claude and .claude.json', () => {
    const c = ctx({ env: { CLAUDE_CONFIG_DIR: '/cfg/claude' } });
    assert.deepEqual(pathsFor('claude.settings', c), ['/home/u/.claude/settings.json', '/cfg/claude/settings.json']);
    assert.deepEqual(pathsFor('claude.state', c), ['/home/u/.claude.json', '/cfg/claude/.claude.json']);
  });

  test('CODEX_HOME and COPILOT_HOME', () => {
    const c = ctx({ env: { CODEX_HOME: '/x/codex', COPILOT_HOME: '/x/copilot' } });
    assert.deepEqual(pathsFor('codex.config', c), ['/home/u/.codex/config.toml', '/x/codex/config.toml']);
    assert.deepEqual(pathsFor('copilot.cliSettings', c), ['/home/u/.copilot/settings.json', '/x/copilot/settings.json']);
  });

  test('OpenCode: XDG_CONFIG_HOME, OPENCODE_CONFIG_DIR and OPENCODE_CONFIG', () => {
    const c = ctx({ env: { XDG_CONFIG_HOME: '/xdg', OPENCODE_CONFIG_DIR: '/oc', OPENCODE_CONFIG: '/custom/oc.json' } });
    assert.deepEqual(pathsFor('opencode.config.json', c), [
      '/home/u/.config/opencode/opencode.json',
      '/xdg/opencode/opencode.json',
      '/oc/opencode.json',
      '/custom/oc.json',
    ]);
  });

  test('override equal to default is not watched twice (case-insensitive on Windows)', () => {
    const c = ctx({ platform: 'win32', home: 'C:\\Users\\u', env: { CODEX_HOME: 'c:\\users\\U\\.codex' } });
    assert.deepEqual(pathsFor('codex.config', c), ['C:\\Users\\u\\.codex\\config.toml']);
  });

  test('blank env values are ignored', () => {
    assert.deepEqual(resolveRoot('codexHome', ctx({ env: { CODEX_HOME: '  ' } })), ['/home/u/.codex']);
  });
});

describe('paths: workspace targets', () => {
  test('project targets resolve against every workspace folder', () => {
    const c = ctx({ workspaceFolders: ['/w/a', '/w/b'] });
    assert.deepEqual(pathsFor('claude.p.mcp', c), ['/w/a/.mcp.json', '/w/b/.mcp.json']);
    assert.deepEqual(pathsFor('copilot.p.vscodeMcp', c), ['/w/a/.vscode/mcp.json', '/w/b/.vscode/mcp.json']);
  });

  test('no workspace: no project targets', () => {
    const targets = resolveTargets(ALL_TARGET_SPECS, ctx({}));
    assert.equal(targets.filter((t) => t.scope === 'project').length, 0);
  });

  test('pathKey lower-cases only on Windows', () => {
    assert.equal(pathKey('C:\\A\\B', 'win32'), 'c:\\a\\b');
    assert.equal(pathKey('/A/B', 'linux'), '/A/B');
  });
});
