// High: settings that make the agent run a program on its own (same effect as a hook),
// environment variables that change what runs or where data goes, model endpoint changes.
import { agentName } from '../../agents';
import type { Finding, KeyPattern } from '../../core/types';
import { t } from '../../i18n';
import type { DocQuery, Rule } from '../context';
import { commandNameOf, hostOf, keyPath } from '../util';

const CLAUDE_HELPERS = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper', 'statusLine', 'fileSuggestion'];
const CODEX_HELPERS: KeyPattern[] = [['notify'], ['mcp_servers', '*', 'http_headers_helper']];

const RISKY_ENV =
  /^(NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_\w+|PATH|PYTHONPATH|PYTHONSTARTUP|PERL5OPT|RUBYOPT|BASH_ENV|PROMPT_COMMAND|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|REQUESTS_CA_BUNDLE|\w*_PROXY|\w*_API_KEY|\w*_AUTH_TOKEN)$/i;
const ENDPOINT_ENV = /_BASE_URL$/i;

export const commandsRule: Rule = {
  id: 'commands',
  doc(q: DocQuery): Finding[] {
    const out: Finding[] = [];
    if (q.after.value === undefined) return out;
    const agent = agentName(q.agent);

    if (q.role === 'settings') {
      const helpers: KeyPattern[] = q.agent === 'codex' ? CODEX_HELPERS : CLAUDE_HELPERS.map((k) => [k]);
      for (const p of helpers) {
        for (const { path, value } of q.addedOrChanged(p)) {
          const key = keyPath(path);
          out.push({ rule: 'commands', level: 'high', reason: t('cmd.helper', { key, agent, cmd: commandNameOf(value) ?? '?' }), where: key });
        }
      }
    }

    for (const p of [['env', '*'], ['shell_environment_policy', 'set', '*']] as KeyPattern[]) {
      for (const { path, value } of q.addedOrChanged(p)) {
        const name = path[path.length - 1];
        const where = keyPath(path);
        if (ENDPOINT_ENV.test(name)) out.push({ rule: 'commands', level: 'high', reason: t('cmd.endpoint', { key: name, host: hostOf(value) ?? '?' }), where });
        else if (RISKY_ENV.test(name)) out.push({ rule: 'commands', level: 'high', reason: t('cmd.envRisky', { name }), where });
        else out.push({ rule: 'commands', level: 'medium', reason: t('cmd.env', { name }), where });
      }
    }

    for (const p of [['model_providers', '*', 'base_url'], ['openai_base_url'], ['chatgpt_base_url']] as KeyPattern[]) {
      for (const { path, value } of q.addedOrChanged(p)) {
        const key = keyPath(path);
        out.push({ rule: 'commands', level: 'high', reason: t('cmd.endpoint', { key, host: hostOf(value) ?? '?' }), where: key });
      }
    }
    return out;
  },
};
