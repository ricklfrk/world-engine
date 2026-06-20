# World Engine Config Folder

World Engine stores runtime data here as plaintext files when the companion SillyTavern server plugin is enabled.

Expected files:

- `settings.json`: global World Engine settings.
- `presets.json`: injection presets.
- `active-preset.txt`: active preset id.
- `inject-style.txt`: active injection style id.
- `worldbook/books.json`: selected worldbook names.
- `worldbook/entry-selection.json`: selected worldbook entries.
- `ui/panel-state.json`: panel layout state.
- `notifications.json`: notification history.
- `backups.json`: automatic backup metadata.
- `chats/<chat-id>/state.json`: full per-chat world state.
- `chats/<chat-id>/config.json`: per-chat config subset.
- `chats/<chat-id>/savepoints.json`: rollback savepoints.
- `chats/<chat-id>/evolution.jsonl`: append-only conversation evolution log.
- `logs/lifecycle.jsonl`: append-only global lifecycle audit log.
- `chats/<chat-id>/lifecycle.jsonl`: append-only per-chat lifecycle audit log.

The UI extension cannot write files by itself because it runs in the browser. File writes require the bundled `index.js` server plugin and SillyTavern `enableServerPlugins: true`.
