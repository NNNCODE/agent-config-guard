// Registry of watched paths, one block per agent. Sources for each path are in the plan
// (docs URLs) and README. confirmed: false = not in official docs, watched as best effort.
import type { AgentId, KeyPattern, TargetSpec } from './core/types';

export interface AgentDef {
  id: AgentId;
  name: string;
  targets: TargetSpec[];
}

const MD = /\.md$/i;
const MD_OR_MDC = /\.(md|mdc)$/i;
const JSON_FILE = /\.json$/i;

/** ~/.claude.json is rewritten constantly by Claude Code; only MCP and trust subtrees count. */
const CLAUDE_STATE_KEYS: KeyPattern[] = [
  ['mcpServers'],
  ['projects', '*', 'mcpServers'],
  ['projects', '*', 'enabledMcpjsonServers'],
  ['projects', '*', 'disabledMcpjsonServers'],
  ['projects', '*', 'enableAllProjectMcpServers'],
  ['projects', '*', 'allowedTools'],
  ['projects', '*', 'hasTrustDialogAccepted'],
];

/** VS Code settings: only Copilot / chat / MCP keys count. */
const VSCODE_SETTINGS_KEYS: KeyPattern[] = [[/^chat\./], [/^github\.copilot/], [/^mcp/]];

type Common = Pick<TargetSpec, 'agent' | 'scope'>;

function file(c: Common, id: string, root: TargetSpec['root'], rel: string, rest: Partial<TargetSpec> & Pick<TargetSpec, 'role'>): TargetSpec {
  const name = rel.split('/').pop() as string;
  return { ...c, id, root, rel, kind: 'file', label: rel, confirmed: true, format: guessFormat(name), ...rest };
}

function dir(c: Common, id: string, root: TargetSpec['root'], rel: string, rest: Partial<TargetSpec> & Pick<TargetSpec, 'role'>): TargetSpec {
  return { ...c, id, root, rel, kind: 'dir', label: `${rel}/`, confirmed: true, depth: 2, ...rest };
}

export function guessFormat(name: string): TargetSpec['format'] {
  const lower = name.toLowerCase();
  if (lower.endsWith('.toml')) return 'toml';
  if (lower.endsWith('.jsonc')) return 'jsonc';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.mdc') || lower === '.cursorrules') return 'markdown';
  return 'text';
}

const U = (agent: AgentId): Common => ({ agent, scope: 'user' });
const P = (agent: AgentId): Common => ({ agent, scope: 'project' });

// ---------------------------------------------------------------- Claude Code
const claude: AgentDef = {
  id: 'claude',
  name: 'Claude Code',
  targets: [
    file(U('claude'), 'claude.settings', 'claudeHome', 'settings.json', { role: 'settings' }),
    file(U('claude'), 'claude.state', 'claudeJsonDir', '.claude.json', { role: 'state', keyFilter: CLAUDE_STATE_KEYS }),
    file(U('claude'), 'claude.plugins.installed', 'claudeHome', 'plugins/installed_plugins.json', { role: 'plugins' }),
    file(U('claude'), 'claude.plugins.marketplaces', 'claudeHome', 'plugins/known_marketplaces.json', { role: 'plugins' }),
    file(U('claude'), 'claude.memory', 'claudeHome', 'CLAUDE.md', { role: 'instructions', alsoReadBy: ['copilot', 'opencode'] }),
    dir(U('claude'), 'claude.rules', 'claudeHome', 'rules', { role: 'instructions', match: MD, alsoReadBy: ['copilot'] }),
    dir(U('claude'), 'claude.agents', 'claudeHome', 'agents', { role: 'agents', match: MD }),
    dir(U('claude'), 'claude.commands', 'claudeHome', 'commands', { role: 'commands', match: MD }),
    dir(U('claude'), 'claude.skills', 'claudeHome', 'skills', { role: 'skills', depth: 3, alsoReadBy: ['cursor', 'copilot'] }),

    file(P('claude'), 'claude.p.settings', 'workspace', '.claude/settings.json', { role: 'settings', alsoReadBy: ['copilot'] }),
    file(P('claude'), 'claude.p.settingsLocal', 'workspace', '.claude/settings.local.json', { role: 'settings', alsoReadBy: ['copilot'] }),
    file(P('claude'), 'claude.p.mcp', 'workspace', '.mcp.json', { role: 'mcp', alsoReadBy: ['copilot'] }),
    file(P('claude'), 'claude.p.memory', 'workspace', 'CLAUDE.md', { role: 'instructions', alsoReadBy: ['cursor', 'copilot', 'opencode'] }),
    file(P('claude'), 'claude.p.memoryDot', 'workspace', '.claude/CLAUDE.md', { role: 'instructions', alsoReadBy: ['copilot'] }),
    file(P('claude'), 'claude.p.memoryLocal', 'workspace', 'CLAUDE.local.md', { role: 'instructions' }),
    dir(P('claude'), 'claude.p.rules', 'workspace', '.claude/rules', { role: 'instructions', match: MD, alsoReadBy: ['copilot'] }),
    dir(P('claude'), 'claude.p.agents', 'workspace', '.claude/agents', { role: 'agents', match: MD, alsoReadBy: ['cursor', 'copilot'] }),
    dir(P('claude'), 'claude.p.commands', 'workspace', '.claude/commands', { role: 'commands', match: MD }),
    dir(P('claude'), 'claude.p.skills', 'workspace', '.claude/skills', { role: 'skills', depth: 3, alsoReadBy: ['cursor', 'copilot'] }),
  ],
};

// ---------------------------------------------------------------- Codex
const codex: AgentDef = {
  id: 'codex',
  name: 'Codex',
  targets: [
    file(U('codex'), 'codex.config', 'codexHome', 'config.toml', { role: 'settings' }),
    file(U('codex'), 'codex.hooks', 'codexHome', 'hooks.json', { role: 'hooks' }),
    file(U('codex'), 'codex.agentsMd', 'codexHome', 'AGENTS.md', { role: 'instructions' }),
    file(U('codex'), 'codex.agentsOverride', 'codexHome', 'AGENTS.override.md', { role: 'instructions' }),
    dir(U('codex'), 'codex.rules', 'codexHome', 'rules', { role: 'permissions', match: /\.rules$/i, depth: 1, format: 'text' }),
    dir(U('codex'), 'codex.pluginCache', 'codexHome', 'plugins/cache', { role: 'plugin-dir', depth: 2, storeContent: false }),
    dir(U('codex'), 'codex.skills', 'codexHome', 'skills', { role: 'skills', depth: 3, confirmed: false }),
    dir(U('codex'), 'codex.agentsSkills', 'agentsHome', 'skills', { role: 'skills', depth: 3, alsoReadBy: ['cursor', 'copilot'] }),
    file(U('codex'), 'codex.agentsMarketplace', 'agentsHome', 'plugins/marketplace.json', { role: 'plugins' }),

    file(P('codex'), 'codex.p.agentsMd', 'workspace', 'AGENTS.md', { role: 'instructions', alsoReadBy: ['cursor', 'copilot', 'opencode'] }),
    file(P('codex'), 'codex.p.agentsOverride', 'workspace', 'AGENTS.override.md', { role: 'instructions' }),
    file(P('codex'), 'codex.p.config', 'workspace', '.codex/config.toml', { role: 'settings' }),
    file(P('codex'), 'codex.p.hooks', 'workspace', '.codex/hooks.json', { role: 'hooks' }),
    dir(P('codex'), 'codex.p.rules', 'workspace', '.codex/rules', { role: 'permissions', match: /\.rules$/i, depth: 1, format: 'text' }),
    dir(P('codex'), 'codex.p.skills', 'workspace', '.agents/skills', { role: 'skills', depth: 3, alsoReadBy: ['cursor', 'copilot'] }),
    file(P('codex'), 'codex.p.marketplace', 'workspace', '.agents/plugins/marketplace.json', { role: 'plugins' }),
  ],
};

// ---------------------------------------------------------------- Cursor
const cursor: AgentDef = {
  id: 'cursor',
  name: 'Cursor',
  targets: [
    file(U('cursor'), 'cursor.mcp', 'cursorHome', 'mcp.json', { role: 'mcp' }),
    file(U('cursor'), 'cursor.hooks', 'cursorHome', 'hooks.json', { role: 'hooks' }),
    file(U('cursor'), 'cursor.permissions', 'cursorHome', 'permissions.json', { role: 'permissions' }),
    file(U('cursor'), 'cursor.cliConfig', 'cursorCli', 'cli-config.json', { role: 'permissions' }),
    dir(U('cursor'), 'cursor.rules', 'cursorHome', 'rules', { role: 'instructions', match: MD_OR_MDC }),
    dir(U('cursor'), 'cursor.agents', 'cursorHome', 'agents', { role: 'agents', match: MD }),
    dir(U('cursor'), 'cursor.skills', 'cursorHome', 'skills', { role: 'skills', depth: 3 }),
    dir(U('cursor'), 'cursor.commands', 'cursorHome', 'commands', { role: 'commands', match: MD, confirmed: false }),

    file(P('cursor'), 'cursor.p.mcp', 'workspace', '.cursor/mcp.json', { role: 'mcp' }),
    file(P('cursor'), 'cursor.p.hooks', 'workspace', '.cursor/hooks.json', { role: 'hooks' }),
    file(P('cursor'), 'cursor.p.permissions', 'workspace', '.cursor/permissions.json', { role: 'permissions' }),
    file(P('cursor'), 'cursor.p.cli', 'workspace', '.cursor/cli.json', { role: 'permissions' }),
    dir(P('cursor'), 'cursor.p.rules', 'workspace', '.cursor/rules', { role: 'instructions', match: MD_OR_MDC }),
    file(P('cursor'), 'cursor.p.cursorrules', 'workspace', '.cursorrules', { role: 'instructions', format: 'markdown' }),
    dir(P('cursor'), 'cursor.p.commands', 'workspace', '.cursor/commands', { role: 'commands', match: MD }),
    dir(P('cursor'), 'cursor.p.agents', 'workspace', '.cursor/agents', { role: 'agents', match: MD }),
    dir(P('cursor'), 'cursor.p.skills', 'workspace', '.cursor/skills', { role: 'skills', depth: 3 }),
  ],
};

// ---------------------------------------------------------------- GitHub Copilot
const copilot: AgentDef = {
  id: 'copilot',
  name: 'GitHub Copilot',
  targets: [
    file(U('copilot'), 'copilot.vscodeSettings', 'vscodeUser', 'settings.json', { role: 'settings', format: 'jsonc', keyFilter: VSCODE_SETTINGS_KEYS }),
    file(U('copilot'), 'copilot.vscodeMcp', 'vscodeUser', 'mcp.json', { role: 'mcp', format: 'jsonc' }),
    file(U('copilot'), 'copilot.cliSettings', 'copilotHome', 'settings.json', { role: 'settings', format: 'jsonc' }),
    file(U('copilot'), 'copilot.cliMcp', 'copilotHome', 'mcp-config.json', { role: 'mcp' }),
    file(U('copilot'), 'copilot.cliConfig', 'copilotHome', 'config.json', { role: 'state', format: 'jsonc', keyFilter: [['trustedFolders']] }),
    file(U('copilot'), 'copilot.cliPermissions', 'copilotHome', 'permissions-config.json', { role: 'permissions' }),
    file(U('copilot'), 'copilot.instructions', 'copilotHome', 'copilot-instructions.md', { role: 'instructions' }),
    dir(U('copilot'), 'copilot.instructionsDir', 'copilotHome', 'instructions', { role: 'instructions', match: MD }),
    dir(U('copilot'), 'copilot.hooks', 'copilotHome', 'hooks', { role: 'hooks', match: JSON_FILE, depth: 1, format: 'json' }),
    dir(U('copilot'), 'copilot.agents', 'copilotHome', 'agents', { role: 'agents', match: MD }),
    dir(U('copilot'), 'copilot.skills', 'copilotHome', 'skills', { role: 'skills', depth: 3 }),
    dir(U('copilot'), 'copilot.plugins', 'copilotHome', 'installed-plugins', { role: 'plugin-dir', depth: 2, storeContent: false }),
    dir(U('copilot'), 'copilot.extensions', 'copilotHome', 'extensions', { role: 'plugin-dir', depth: 2, storeContent: false }),

    file(P('copilot'), 'copilot.p.vscodeMcp', 'workspace', '.vscode/mcp.json', { role: 'mcp', format: 'jsonc' }),
    file(P('copilot'), 'copilot.p.vscodeSettings', 'workspace', '.vscode/settings.json', { role: 'settings', format: 'jsonc', keyFilter: VSCODE_SETTINGS_KEYS }),
    file(P('copilot'), 'copilot.p.instructions', 'workspace', '.github/copilot-instructions.md', { role: 'instructions' }),
    dir(P('copilot'), 'copilot.p.instructionsDir', 'workspace', '.github/instructions', { role: 'instructions', match: MD, depth: 3 }),
    dir(P('copilot'), 'copilot.p.hooks', 'workspace', '.github/hooks', { role: 'hooks', match: JSON_FILE, depth: 1, format: 'json' }),
    file(P('copilot'), 'copilot.p.settings', 'workspace', '.github/copilot/settings.json', { role: 'settings' }),
    file(P('copilot'), 'copilot.p.settingsLocal', 'workspace', '.github/copilot/settings.local.json', { role: 'settings' }),
    file(P('copilot'), 'copilot.p.mcp', 'workspace', '.github/mcp.json', { role: 'mcp' }),
    dir(P('copilot'), 'copilot.p.agents', 'workspace', '.github/agents', { role: 'agents', match: MD }),
    dir(P('copilot'), 'copilot.p.skills', 'workspace', '.github/skills', { role: 'skills', depth: 3 }),
    dir(P('copilot'), 'copilot.p.prompts', 'workspace', '.github/prompts', { role: 'commands', match: MD }),
  ],
};

// ---------------------------------------------------------------- OpenCode
/** OpenCode accepts plural directory names and, for backwards compatibility, singular ones. */
function opencodeDirs(c: Common, prefix: string, root: TargetSpec['root'], base: string): TargetSpec[] {
  const out: TargetSpec[] = [];
  const kinds: Array<[string, TargetSpec['role'], Partial<TargetSpec>]> = [
    ['agents', 'agents', { match: MD }],
    ['commands', 'commands', { match: MD }],
    ['modes', 'agents', { match: MD }],
    ['skills', 'skills', { depth: 3 }],
    ['plugins', 'code-dir', { depth: 2 }],
    ['tools', 'code-dir', { depth: 2 }],
  ];
  for (const [plural, role, extra] of kinds) {
    const singular = plural.slice(0, -1);
    for (const name of [plural, singular]) {
      out.push(dir(c, `${prefix}.${name}`, root, base ? `${base}/${name}` : name, { role, ...extra }));
    }
  }
  return out;
}

const opencode: AgentDef = {
  id: 'opencode',
  name: 'OpenCode',
  targets: [
    // Windows path (%USERPROFILE%\.config\opencode) is confirmed only in OpenCode's dev-branch source.
    file(U('opencode'), 'opencode.config.json', 'opencodeConfig', 'opencode.json', { role: 'settings', format: 'jsonc' }),
    file(U('opencode'), 'opencode.config.jsonc', 'opencodeConfig', 'opencode.jsonc', { role: 'settings', format: 'jsonc' }),
    file(U('opencode'), 'opencode.agentsMd', 'opencodeConfig', 'AGENTS.md', { role: 'instructions' }),
    ...opencodeDirs(U('opencode'), 'opencode', 'opencodeConfig', ''),

    file(P('opencode'), 'opencode.p.config.json', 'workspace', 'opencode.json', { role: 'settings', format: 'jsonc' }),
    file(P('opencode'), 'opencode.p.config.jsonc', 'workspace', 'opencode.jsonc', { role: 'settings', format: 'jsonc' }),
    ...opencodeDirs(P('opencode'), 'opencode.p', 'workspace', '.opencode'),
  ],
};

export const AGENTS: AgentDef[] = [claude, codex, cursor, copilot, opencode];

export const ALL_TARGET_SPECS: TargetSpec[] = AGENTS.flatMap((a) => a.targets);

export function agentName(id: AgentId): string {
  return AGENTS.find((a) => a.id === id)?.name ?? id;
}
