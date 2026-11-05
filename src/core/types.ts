// Shared types. Nothing in this file may import 'vscode': core/ and risk/ must run in plain Node.

export type AgentId = 'claude' | 'codex' | 'cursor' | 'copilot' | 'opencode';
export type Scope = 'user' | 'project';
export type Format = 'json' | 'jsonc' | 'toml' | 'markdown' | 'text';

/** What a watched path is for. Risk rules use this to decide which checks apply. */
export type Role =
  | 'settings' // general settings file (may contain hooks, permissions, plugins, MCP)
  | 'state' // file the agent rewrites itself; always used with a keyFilter
  | 'mcp' // MCP server list
  | 'hooks' // hook definitions
  | 'permissions' // allow/deny lists, approval modes
  | 'plugins' // plugin / marketplace index file
  | 'instructions' // CLAUDE.md, AGENTS.md, rules
  | 'skills' // directory of skills
  | 'agents' // directory of sub-agent definitions
  | 'commands' // directory of slash-command definitions
  | 'plugin-dir' // directory whose entries are installed plugins
  | 'code-dir'; // directory of code the agent loads at startup (OpenCode plugins/tools)

/**
 * A key path pattern for JSON projection. Each segment is an exact key, '*' (any key),
 * or a RegExp tested against the key.
 */
export type KeyPattern = Array<string | RegExp>;

/** Roots that registry entries are relative to. Each root can resolve to several directories. */
export type RootId =
  | 'home'
  | 'claudeHome'
  | 'claudeJsonDir'
  | 'codexHome'
  | 'agentsHome'
  | 'cursorHome'
  | 'cursorCli'
  | 'copilotHome'
  | 'opencodeConfig'
  | 'vscodeUser'
  | 'workspace';

/** One entry in the registry (src/agents.ts), before paths are resolved. */
export interface TargetSpec {
  id: string;
  agent: AgentId;
  scope: Scope;
  kind: 'file' | 'dir';
  root: RootId;
  /** Path relative to the root, with '/' separators. */
  rel: string;
  /** File format. For directories: format of the files inside (defaults by extension). */
  format?: Format;
  role: Role;
  /** Short human label shown in the tree, e.g. "settings.json". */
  label: string;
  /** Only these subtrees count for change detection and revert (JSON/JSONC files only). */
  keyFilter?: KeyPattern[];
  /** Directories: how many levels to list (1 = direct children only). */
  depth?: number;
  /** Directories: only files whose name matches are listed. */
  match?: RegExp;
  /** Directories: store file contents so they can be restored (default true). */
  storeContent?: boolean;
  /** false = path not in official docs; watched as best effort. */
  confirmed: boolean;
  /** Other agents that also read this path. */
  alsoReadBy?: AgentId[];
}

/** A registry entry resolved to one absolute path. */
export interface Target extends TargetSpec {
  path: string;
  /** Unique, normalised key (lower-cased on Windows). */
  key: string;
}

export interface FileSnapshot {
  kind: 'file';
  exists: boolean;
  /** sha256 hex of the stored content (projection text for keyFilter files). */
  hash?: string;
  size?: number;
  /** Stored content as UTF-8 text. Absent when tooLarge. */
  content?: string;
  tooLarge?: boolean;
  /** True when a keyFilter file could not be parsed; content is then the raw file. */
  unfiltered?: boolean;
}

export interface DirEntry {
  /** Path relative to the directory target, '/' separators. */
  rel: string;
  type: 'file' | 'dir' | 'link';
  hash?: string;
  size?: number;
}

export interface DirSnapshot {
  kind: 'dir';
  exists: boolean;
  /** sha256 of the listing (rel, type, hash of every entry). */
  hash?: string;
  entries: DirEntry[];
  /** Contents of files that were small enough to store, keyed by rel. */
  contents: Record<string, string>;
  truncated?: boolean;
}

export type Snapshot = FileSnapshot | DirSnapshot;
