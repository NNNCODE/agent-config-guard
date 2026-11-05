// Launches VS Code (the oldest version we support) with a throwaway home folder and runs the suite.
// HOME / USERPROFILE / APPDATA / XDG_CONFIG_HOME all point into the temp folder, so the real
// agent configs on this machine are never read or written.
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

const VSCODE_VERSION = process.env.ACG_TEST_VSCODE_VERSION ?? '1.100.0';

async function main(): Promise<void> {
  // When this script is started from a terminal inside VS Code (or an extension host), this
  // variable is inherited and would make the test VS Code start as plain Node instead.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const root = path.resolve(__dirname, '..', '..', '..');
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'acg-home-'));
  const workspace = path.join(home, 'workspace');
  await fs.mkdir(path.join(home, '.codex'), { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.copyFile(path.join(root, 'test', 'fixtures', 'codex', 'postman-before.toml'), path.join(home, '.codex', 'config.toml'));

  try {
    const code = await runTests({
      version: VSCODE_VERSION,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.resolve(__dirname, 'suite', 'index'),
      // A fresh user-data dir per run, so a baseline from a previous run never carries over.
      launchArgs: [workspace, `--user-data-dir=${path.join(home, 'vscode-user-data')}`, '--disable-extensions', '--locale=en', '--skip-welcome', '--skip-release-notes'],
      extensionTestsEnv: {
        AGENT_CONFIG_GUARD_TEST: '1',
        ACG_FIXTURES: path.join(root, 'test', 'fixtures'),
        HOME: home,
        USERPROFILE: home,
        APPDATA: path.join(home, 'AppData', 'Roaming'),
        XDG_CONFIG_HOME: path.join(home, '.config'),
        CLAUDE_CONFIG_DIR: undefined,
        CODEX_HOME: undefined,
        COPILOT_HOME: undefined,
      },
    });
    process.exitCode = code;
  } finally {
    await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
