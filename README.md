# Agent Config Guard

Coding agents load their configuration at startup: hooks, plugins, MCP servers, permission rules and instruction files. Other programs on your machine can rewrite those files without asking. In October 2026, Postman desktop 12.33.4 added itself to Codex and Claude Code and pre-approved its own startup hook ([postmanlabs/postman-app-support#14370](https://github.com/postmanlabs/postman-app-support/issues/14370)).

Agent Config Guard records the state of those files and tells you when something changes them. It explains what the change does, marks risky changes, and lets you accept or revert each one. Every decision is written to a local change log.

It covers **Claude Code, Codex, Cursor, GitHub Copilot and OpenCode**, at user level (your home folder) and project level (the open workspace).

## How it works

1. **Baseline.** On first start it asks before recording anything. It then saves a hash and the content of every watched file that exists.
2. **Detection.** At startup it compares everything with the baseline, so changes made while the editor was closed are caught. While it runs it watches the files (VS Code's file watcher, which can watch folders outside the workspace) and re-checks every 60 seconds as a fallback.
3. **Risk.** Each changed file is parsed (JSON/JSONC with `jsonc-parser`, TOML with `smol-toml`) and checked key by key. Every finding comes with a one-sentence reason.
4. **You decide.** A notification offers **View diff**, **Accept** and **Revert**. Nothing is ever reverted automatically.

### Risk levels

| Level | What triggers it |
|---|---|
| **High** | New or changed hooks (startup hooks such as `SessionStart` are named). Something approved in advance, e.g. Codex `hooks.state.*.trusted_hash` or Claude `skipDangerousModePermissionPrompt`. New plugin marketplaces, plugins or plugin folders (with the hook events they bring). New or re-pointed MCP servers, escalated for `npx`/`uvx`, an inline shell, or a remote URL. Loosened permissions such as `Bash(*)`, `bypassPermissions`, `approval_policy = "never"`, or a removed deny rule. Settings that run a program (`statusLine`, `apiKeyHelper`, Codex `notify`). Risky environment variables and model endpoint changes. |
| **Medium** | New text in instruction files (`CLAUDE.md`, `AGENTS.md`, rules), flagged when it says "before responding to any task…" or similar. New skills, agents or commands. A project marked as trusted. A file that no longer parses or was emptied. |
| **Low** | Anything else, e.g. a model or theme switch. Accepted automatically by default (setting `agentConfigGuard.autoAcceptLowRisk`) and still written to the change log. |

### Accept and revert

- **Accept**: the current state becomes the baseline.
- **Revert**: the changed file is first copied to `<file>.bak-YYYYMMDD-HHmmss`, then the baseline is written back in place.
  - **`~/.claude.json`, VS Code `settings.json` and Copilot `config.json`**: only the watched keys are restored. The agent's own state and your other settings and comments are kept.
  - **Folders** (skills, plugins): new entries are moved into the extension's own backup folder, because a renamed skill folder would still be loaded.

### Change log

`journal.jsonl` in the extension's storage holds one line per event: time, agent, file, change, risk level, rules and a summary. Summaries contain names, hosts and command names only; config values, environment values, headers and tokens are never written. Use **Agent Config Guard: Export change log** to save a copy.

## What it watches

✅ = in the agent's official docs. ⚠ = not in official docs, watched as best effort.

| Agent | User level | Project level |
|---|---|---|
| Claude Code | `~/.claude/settings.json`, `~/.claude.json` (MCP and trust keys only), `~/.claude/plugins/{installed_plugins,known_marketplaces}.json`, `~/.claude/CLAUDE.md`, `~/.claude/{rules,agents,commands,skills}/` | `.claude/settings{,.local}.json`, `.mcp.json`, `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/{rules,agents,commands,skills}/` |
| Codex | `~/.codex/config.toml`, `~/.codex/hooks.json`, `~/.codex/AGENTS{,.override}.md`, `~/.codex/rules/`, `~/.codex/plugins/cache/`, `~/.agents/skills/`, `~/.agents/plugins/marketplace.json`, `~/.codex/skills/` ⚠ | `AGENTS{,.override}.md`, `.codex/{config.toml,hooks.json,rules/}`, `.agents/skills/`, `.agents/plugins/marketplace.json` |
| Cursor | `~/.cursor/{mcp,hooks,permissions,cli-config}.json`, `~/.cursor/{rules,agents,skills}/`, `~/.cursor/commands/` ⚠ | `.cursor/{mcp,hooks,permissions,cli}.json`, `.cursor/{rules,commands,agents,skills}/`, `.cursorrules` |
| GitHub Copilot | VS Code / Insiders user and profile `settings.json` (`chat.*`, `github.copilot*`, `mcp*` keys only) and `mcp.json`; `~/.copilot/{settings,mcp-config,permissions-config}.json`, `config.json` (`trustedFolders`), `copilot-instructions.md`, `{instructions,hooks,agents,skills,installed-plugins,extensions}/` | `.vscode/mcp.json`, `.vscode/settings.json` (same keys), `.github/copilot-instructions.md`, `.github/{instructions,hooks,agents,skills,prompts}/`, `.github/copilot/settings{,.local}.json`, `.github/mcp.json` |
| OpenCode | `~/.config/opencode/opencode.json{,c}`, `AGENTS.md`, `{agents,commands,modes,skills,plugins,tools}/` (singular names too) | `opencode.json{,c}`, `.opencode/…` (same folders) |

- **Windows paths:** `~` is `%USERPROFILE%` and VS Code settings are under `%APPDATA%\Code\User`. OpenCode uses `%USERPROFILE%\.config\opencode`, not `%APPDATA%`. That OpenCode path is confirmed only in OpenCode's development-branch source.
- **Relocated config folders:** `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`, `CURSOR_CONFIG_DIR`, `XDG_CONFIG_HOME`, `OPENCODE_CONFIG` and `OPENCODE_CONFIG_DIR` are honoured. The default locations are watched as well, because an installer may write to the default.

**Not covered in v1:**
- Managed/enterprise policy files and registry policies (they need admin rights to write).
- The contents of plugin caches; only their index files and two-level folder listings are watched.
- Instruction files below the workspace root.
- Remote windows (SSH, WSL, containers).
- Finding out *which program* made a change.

## Privacy

- **No network access and no telemetry.** A test checks that the bundled code loads no network or process-spawning module.
- **Local storage only.** Everything lives in the extension's global storage folder on this computer. On macOS and Linux, files there are owner-only (`0600`, folders `0700`). On Windows the folder is protected by your user profile's permissions.
- **Secrets stay local.** The baseline holds file contents, which can include secrets. It never leaves your machine.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `agentConfigGuard.pollIntervalSeconds` | `60` | Seconds between full re-checks. `0` turns polling off. |
| `agentConfigGuard.autoAcceptLowRisk` | `true` | Accept low-risk changes automatically. |

## Development

```sh
npm install
npm test                  # unit tests; ends with "# fail 0"
npm run test:integration  # starts VS Code 1.100 with a temp home; ends with "1 passing, 0 failing"
npm run package           # builds agent-config-guard-<version>.vsix
```

`engines.vscode` is `^1.100.0`, so the extension also installs in editors built on older VS Code versions, such as Cursor.

---

## 中文说明

编码 Agent 的配置会被别的程序悄悄改写。例如 Postman 12.33.4 给 Codex 和 Claude Code 装了插件，还替自己的 SessionStart 钩子预先签了信任。

这个扩展做五件事：
- **建立基线。** 首次启动时先问你，同意后才记下当前状态。
- **发现改动。** 启动时和基线比对，编辑器关着时的改动也能发现；运行时实时监视。
- **判断风险。** 解析改动后分高、中、低三级，每条附一句原因。
- **让你决定。** 通知里有「查看差异 / 接受 / 还原」，从不自动还原。还原前先把当前文件备份为 `.bak-时间戳`。
- **留下记录。** 本地变更记录可导出，记录里不含任何配置值。

不联网，没有遥测。界面跟随 VS Code 的显示语言，中文环境下显示中文。
