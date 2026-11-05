// Message catalog, English + Simplified Chinese. No 'vscode' import: risk rules use it too.
// The language is set once at activation from vscode.env.language.
// Parameters in messages ({name}) must only ever receive names, hosts, command names or counts,
// never config values (env values, headers, tokens): reasons end up in the change log.

const en = {
  // ---- risk: hooks
  'hooks.startup': 'New or changed {event} hook: it runs a command automatically every time a session starts, without asking you.',
  'hooks.event': 'New or changed {event} hook: the agent runs this command automatically while it works.',
  'hooks.enabled': 'Hook support turned on ({key}): hook commands will now run.',
  'hooks.unblocked': '{key} removed or turned off: hooks that were blocked can run again.',
  'hooks.location': 'Hook files are now also loaded from another location ({key}).',
  // ---- risk: pre-approval and trust
  'pre.hookTrust': 'Pre-approved the {event} hook of {plugin} ({field}): Codex will run it without asking you.',
  'pre.flag': '{key} turned on: the agent skips a confirmation it would normally ask for.',
  'pre.mcpjson': 'Project MCP servers approved in advance ({key}): they start without asking you.',
  'trust.project': 'Project marked as trusted ({where}): its own config, hooks and MCP servers now take effect.',
  // ---- risk: plugins
  'plugins.marketplace': 'New plugin marketplace {name}{source}: plugins can now be installed from it.',
  'plugins.enabled': 'Plugin {name} installed or enabled: its hooks, skills and MCP servers load with the agent.',
  'plugins.folder': 'New plugin folder {name}.',
  'plugins.folderHooks': 'New plugin folder {name} brings its own hooks: {events}.',
  'plugins.npm': 'New npm plugin {name}: OpenCode installs and runs it automatically at startup.',
  'plugins.code': 'New or changed plugin code {name}: the agent loads and runs it at startup.',
  'plugins.setting': 'Plugin setting {key} changed.',
  // ---- risk: MCP
  'mcp.added': 'New MCP server {name} ({detail}): the agent will start it and let it provide tools.',
  'mcp.changed': 'How MCP server {name} starts was changed ({field}).',
  'mcp.esc.download': ' It downloads and runs code through {cmd}.',
  'mcp.esc.shell': ' It runs a shell command line ({cmd}).',
  'mcp.esc.remote': ' It connects to a remote address ({host}).',
  // ---- risk: permissions
  'perm.broadAllow': 'Broad allow rule {rule} added: matching actions run without asking.',
  'perm.allow': 'Allow rule {rule} added: this action no longer asks for confirmation.',
  'perm.denyRemoved': 'Deny rule {rule} removed: something that was blocked is now allowed.',
  'perm.mode': '{key} set to {value}: the agent stops asking before acting.',
  'perm.modeSoft': '{key} set to {value}.',
  'perm.rulesAllow': 'New allow rule in {file}: matching commands run without asking.',
  'perm.setting': 'Permission setting {key} loosened.',
  // ---- risk: settings that run commands, environment, endpoints
  'cmd.helper': '{key} set: {agent} runs the command {cmd} automatically.',
  'cmd.envRisky': 'Environment variable {name} set for every session: it can change what code runs or where your data goes.',
  'cmd.env': 'Environment variable {name} set for every session.',
  'cmd.endpoint': 'Model endpoint changed ({key} → {host}): your prompts and code would be sent there.',
  // ---- risk: instructions
  'instr.added': '{count} new line(s) in instruction file {file}.',
  'instr.coercive': 'New text in {file} tells the agent to always do something first ("{snippet}").',
  'instr.newEntry': 'New {kind} {name}: the agent may load it and follow it.',
  'instr.location': 'Instruction or agent file locations changed ({key}).',
  'instr.remote': 'Instructions are now also loaded from a URL ({host}).',
  'kind.skill': 'skill',
  'kind.agent': 'agent definition',
  'kind.command': 'command',
  'kind.rule': 'rule file',
  // ---- risk: generic
  'other.changed': 'Other changes: {paths}.',
  'other.text': 'Text changed.',
  'other.deleted': 'File deleted.',
  'other.entries': 'Folder contents changed: {paths}.',
  'parse.error': 'The file can no longer be parsed ({error}), so the rules cannot judge it. Check the diff.',
  'file.tooLarge': 'File is over 5 MB: only its hash is tracked, so it cannot be judged or reverted.',
} as const;

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  'hooks.startup': '新增或修改了 {event} 钩子：每次会话启动时会自动运行命令，不经你确认。',
  'hooks.event': '新增或修改了 {event} 钩子：Agent 工作时会自动运行其中的命令。',
  'hooks.enabled': '打开了钩子功能（{key}）：钩子里的命令从此会运行。',
  'hooks.unblocked': '{key} 被移除或关闭：之前被拦住的钩子又能运行了。',
  'hooks.location': '钩子文件的加载位置被修改（{key}）。',
  'pre.hookTrust': '预先批准了 {plugin} 的 {event} 钩子（{field}）：Codex 不会再请你确认就运行它。',
  'pre.flag': '打开了 {key}：Agent 会跳过本该向你确认的步骤。',
  'pre.mcpjson': '预先批准了项目里的 MCP 服务器（{key}）：它们会不经确认直接启动。',
  'trust.project': '项目被标记为受信任（{where}）：该项目自带的配置、钩子和 MCP 服务器从此生效。',
  'plugins.marketplace': '新增插件市场 {name}{source}：从此可以从它安装插件。',
  'plugins.enabled': '安装或启用了插件 {name}：它带的钩子、技能和 MCP 服务器会随 Agent 一起加载。',
  'plugins.folder': '出现了新的插件目录 {name}。',
  'plugins.folderHooks': '新插件目录 {name} 自带钩子：{events}。',
  'plugins.npm': '新增 npm 插件 {name}：OpenCode 启动时会自动安装并运行它。',
  'plugins.code': '新增或修改了插件代码 {name}：Agent 启动时会加载运行它。',
  'plugins.setting': '插件相关设置 {key} 被修改。',
  'mcp.added': '新增 MCP 服务器 {name}（{detail}）：Agent 会启动它，并让它提供工具。',
  'mcp.changed': 'MCP 服务器 {name} 的启动方式被修改（{field}）。',
  'mcp.esc.download': '它会通过 {cmd} 从网上下载并运行代码。',
  'mcp.esc.shell': '它会运行一段 shell 命令（{cmd}）。',
  'mcp.esc.remote': '它会连接远程地址 {host}。',
  'perm.broadAllow': '新增宽泛的允许规则 {rule}：匹配的操作不再询问就执行。',
  'perm.allow': '新增允许规则 {rule}：这类操作不再请你确认。',
  'perm.denyRemoved': '删除了禁止规则 {rule}：原本被拦住的操作现在放行了。',
  'perm.mode': '{key} 被设为 {value}：Agent 行动前不再询问。',
  'perm.modeSoft': '{key} 被设为 {value}。',
  'perm.rulesAllow': '{file} 新增了允许规则：匹配的命令不再询问就执行。',
  'perm.setting': '权限设置 {key} 被放宽。',
  'cmd.helper': '设置了 {key}：{agent} 会自动运行命令 {cmd}。',
  'cmd.envRisky': '为每个会话设置了环境变量 {name}：它能改变运行的代码或数据的去向。',
  'cmd.env': '为每个会话设置了环境变量 {name}。',
  'cmd.endpoint': '模型地址被修改（{key} → {host}）：你的提示和代码会发到那里。',
  'instr.added': '指令文件 {file} 新增了 {count} 行。',
  'instr.coercive': '{file} 新增的内容要求 Agent 每次都先做某件事（“{snippet}”）。',
  'instr.newEntry': '新增{kind} {name}：Agent 可能会加载并照做。',
  'instr.location': '指令或 Agent 文件的加载位置被修改（{key}）。',
  'instr.remote': '开始从远程地址加载指令（{host}）。',
  'kind.skill': '技能',
  'kind.agent': 'Agent 定义',
  'kind.command': '命令',
  'kind.rule': '规则文件',
  'other.changed': '其他改动：{paths}。',
  'other.text': '文本有改动。',
  'other.deleted': '文件被删除。',
  'other.entries': '目录内容有变化：{paths}。',
  'parse.error': '文件已无法解析（{error}），规则无法判断，请查看差异。',
  'file.tooLarge': '文件超过 5 MB：只跟踪哈希，无法判断，也无法还原。',
};

let current: Record<MessageKey, string> = en;
let currentLang: 'en' | 'zh' = 'en';

/** 'zh-cn', 'zh-tw', 'zh' → Chinese; everything else → English. */
export function setLanguage(vscodeLanguage: string): void {
  currentLang = vscodeLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  current = currentLang === 'zh' ? zh : en;
}

export function language(): 'en' | 'zh' {
  return currentLang;
}

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return current[key].replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
