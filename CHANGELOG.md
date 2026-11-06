# Changelog

## 0.1.0

First version.

- Watches user-level and project-level configs of Claude Code, Codex, Cursor, GitHub Copilot and OpenCode.
- Baseline created only after the user agrees; changes made while the editor was closed are found at startup.
- Risk rules (high / medium / low) with a one-sentence reason per finding, in English and Simplified Chinese.
- Notifications with View diff / Accept / Revert, sidebar tree, status bar count.
- Revert keeps a `.bak-<timestamp>` copy; key-filtered files restore only the watched keys.
- Local change log (JSONL) with export. No network access, no telemetry.
