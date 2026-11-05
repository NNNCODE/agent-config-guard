// Text shown in the diff view and in notifications. No 'vscode' import, so it is unit-tested.
import * as path from 'node:path';
import { agentName } from '../agents';
import { t } from '../i18n';
import type { PendingChange } from './monitor';
import { listingText } from './scan';
import type { Snapshot, Target } from './types';

const MAX_DIR_TEXT = 2 * 1024 * 1024;

/** Text for one side of the diff: file content, or a folder listing followed by its stored files. */
export function snapshotText(snap: Snapshot | undefined): string {
  if (!snap || !snap.exists) return `${t('ui.diff.missing')}\n`;
  if (snap.kind === 'file') return snap.content ?? `${t('ui.diff.notStored')}\n`;
  let out = listingText(snap.entries);
  for (const rel of Object.keys(snap.contents).sort()) {
    const block = `\n===== ${rel} =====\n${snap.contents[rel]}`;
    if (out.length + block.length > MAX_DIR_TEXT) {
      out += `\n===== … =====\n`;
      break;
    }
    out += block;
  }
  return out;
}

/** "user" or "project (my-repo)". */
export function scopeLabel(target: Target, workspaceFolders: string[]): string {
  if (target.scope === 'user') return t('ui.scope.user');
  const folder = workspaceFolders.find((f) => target.path.toLowerCase().startsWith(f.toLowerCase()));
  return folder ? `${t('ui.scope.project')} (${path.basename(folder)})` : t('ui.scope.project');
}

/** Single-change notification text: agent, scope, file, top reason, "+N more". */
export function singleMessage(p: PendingChange, workspaceFolders: string[]): string {
  const { target } = p.change;
  const [top, ...rest] = p.assessment.findings;
  const msg = t('ui.single', { agent: agentName(target.agent), scope: scopeLabel(target, workspaceFolders), file: target.label, reason: top?.reason ?? '' });
  return rest.length ? msg + t('ui.more', { more: rest.length }) : msg;
}
