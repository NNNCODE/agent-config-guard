// Entry point. Wiring of watchers, risk rules and UI is added in later steps.
import type * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {
  // Intentionally empty in step 1 (registry + snapshot only).
}

export function deactivate(): void {
  // Nothing to clean up yet.
}
