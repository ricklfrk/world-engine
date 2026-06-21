# World Engine Architecture and Workflow

World Engine is a SillyTavern roleplay continuity engine. It watches chat events, extracts tags and memories, evolves a structured world state, builds a compact prompt context, and injects that context before generation.

Runtime data is plaintext-first. The browser UI extension calls `WORLD_ENGINE_STORAGE`; the storage adapter hydrates from and writes to the repo `config/` folder through the bundled SillyTavern server plugin. Browser cache and browser `localStorage` are never canonical.

## File Structure

| File | Responsibility |
| --- | --- |
| `manifest.json` | SillyTavern UI extension metadata. |
| `index.js` | SillyTavern server plugin that exposes `/api/plugins/world-engine/*` file APIs scoped to `config/`. |
| `world-engine.js` | UI loader and event orchestration. |
| `world-engine-storage.js` | Config-folder storage adapter with extension-settings fallback only when the server plugin is absent. |
| `world-engine-logger.js` | Lifecycle audit logger that writes structured JSONL records into `config/logs/` and per-chat log files. |
| `world-engine-core.js` | Canonical world state model, migrations, savepoints, achievements, story templates, NPC schedules, plot threads, and combat/lifecycle helpers. |
| `world-engine-memory.js` | Memory extraction, summary generation, and recall ranking. |
| `world-engine-tags.js` | Prediction and extraction of entities, locations, factions, topics, emotions, and trigger tags. |
| `world-engine-presets.js` | Prompt preset model, import/export helpers, context cleanup, and injection style controls. |
| `world-engine-worldbook.js` | SillyTavern worldbook discovery, entry selection, matching, and worldbook analysis. |
| `world-engine-inject.js` | Builds the world-context block injected into SillyTavern prompts. |
| `world-engine-evolution.js` | Calls the configured API, applies world evolution updates, and appends evolution JSONL logs. |
| `world-engine-time.js` | In-world time estimation, formatting, and time-trigger detection. |
| `world-engine-slash.js` | Slash command registration for `/world`, `/memory`, and `/engine`. |
| `world-engine-ui.js` | Main panel UI. |
| `world-engine-24enhance.js` | Progressive enhancement layer. |
| `style.css` | Extension styling. |
| `config/` | Plaintext settings, per-chat state, savepoints, and evolution logs. |

## Boot Workflow

1. SillyTavern loads `world-engine.js` from `manifest.json`.
2. The loader resolves the extension base URL and loads all browser modules in dependency order.
3. Each module attaches a namespaced API to `window`, for example `window.WORLD_ENGINE_CORE`.
4. `WORLD_ENGINE_STORAGE.initConfigFolder()` probes `/api/plugins/world-engine/status`.
5. The server plugin returns its `pluginVersion`, `storageApiVersion`, and `configDir`.
6. If the server plugin is available, storage hydrates cached values from `/api/plugins/world-engine/list` and `/api/plugins/world-engine/file`.
7. The browser loader compares the UI version with the server plugin version and writes a lifecycle warning if `plugins/world-engine` is stale or missing version metadata.
8. The UI is built, slash commands are registered, and SillyTavern chat events are subscribed.

## Update Workflow

SillyTavern's extension updater only updates the UI extension under `extensions/world-engine`. It does not update the server plugin under `plugins/world-engine`.

When updating World Engine:

1. Update or pull `extensions/world-engine` through SillyTavern or Git.
2. Sync code files into `plugins/world-engine` separately.
3. Never overwrite `plugins/world-engine/config`; it contains runtime state, logs, and per-chat files.
4. Restart SillyTavern after changing `plugins/world-engine/index.js` or server-plugin metadata.
5. Confirm `/api/plugins/world-engine/status` reports the same `pluginVersion` as the UI version.

## UI Workflow

1. The main panel is opened from the SillyTavern input bar globe button.
2. The panel header can be dragged in Firefox and Chromium browsers.
3. The bottom-right resize handle adjusts panel size on desktop.
4. Panel position, size, and the active tab are saved to `config/ui/panel-state.json`.
5. Modal windows with a header, including preview and notification windows, can be moved by dragging the header.
6. API, general, storage, preset, world-law, snapshot, and full import/export actions write through `WORLD_ENGINE_STORAGE`.
7. Config-affecting saves dispatch `world-engine:config-saved` or call `WORLD_ENGINE_RUNTIME.scheduleConfigApply()`, which refreshes UI state and rebuilds the active injection context without a page reload.

## Message Workflow

### Before User Message Sends

1. Load current chat state from `config/chats/<chat-id>/state.json`.
2. Load settings from `config/settings.json`.
3. Load selected worldbooks on first use.
4. Generate prediction tags from recent chat history.
5. Build the injected context block.
6. Register the context through the best available SillyTavern injection API.

### After Assistant Message Arrives

1. Skip opening messages and duplicate evolution runs.
2. Save a rollback point to `config/chats/<chat-id>/savepoints.json`.
3. Extract memory and tags from the new exchange.
4. Advance in-world time and trigger time events.
5. Evolve the world state when drive mode and interval rules allow it.
6. Apply updates to events, factions, rumors, NPC activity, plot threads, portraits, achievements, and combat stats.
7. Save full state to `config/chats/<chat-id>/state.json`.
8. Append one JSON line to `config/chats/<chat-id>/evolution.jsonl`.
9. Refresh the UI.

## Config Folder Layout

| File | Purpose |
| --- | --- |
| `config/settings.json` | Global extension settings. |
| `config/presets.json` | Prompt preset definitions. |
| `config/active-preset.txt` | Active preset id. |
| `config/inject-style.txt` | Active injection style id. |
| `config/worldbook/entry-selection.json` | Selected worldbook entries. |
| `config/worldbook/books.json` | Selected worldbook names. |
| `config/ui/panel-state.json` | UI panel state. |
| `config/backups.json` | Snapshot metadata. |
| `config/chats/<chat-id>/state.json` | Per-chat world state. |
| `config/chats/<chat-id>/config.json` | Per-chat config subset. |
| `config/chats/<chat-id>/savepoints.json` | Per-chat rollback savepoints. |
| `config/chats/<chat-id>/evolution.jsonl` | Append-only conversation evolution log. |
| `config/logs/lifecycle.jsonl` | Global append-only lifecycle audit log. |
| `config/chats/<chat-id>/lifecycle.jsonl` | Per-chat append-only lifecycle audit log. |
| `config/kv/*.txt` | Fallback key/value files for uncommon keys. |

## Storage Rules

1. All persistent reads and writes go through `window.WORLD_ENGINE_STORAGE`.
2. UI code must not call server file APIs directly.
3. The server plugin only reads/writes inside `config/` and rejects path traversal.
4. Extension settings fallback is not canonical; it only keeps the UI functional when the server plugin is absent.
5. Conversation evolution logs are append-only JSONL so they can be audited with ordinary text tools.
6. Lifecycle logs are append-only JSONL and record boot, module load, config apply, storage metadata, UI panel actions, message injection, chat load, rollback, state save, and error events.

## Verification Workflow

Run these before release:

```powershell
npm test
Get-ChildItem -Filter *.js | ForEach-Object { node --check $_.FullName }
node --check index.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
git diff --check
```

Manual SillyTavern smoke checks:

1. Install the UI extension folder.
2. Install or symlink the same folder as `plugins/world-engine`.
3. Enable `enableServerPlugins: true` and restart SillyTavern.
4. Open a chat and confirm the World Engine panel button appears.
5. Save settings and confirm `config/settings.json` changes.
6. Confirm saved settings update the active injection preview/context without refreshing the browser tab.
7. Drag and resize the panel in Firefox, close/reopen it, and confirm `config/ui/panel-state.json` changes.
8. Create, export, import, activate, and delete a custom preset; confirm `config/presets.json` and `config/active-preset.txt` change.
9. Send/receive one full exchange and confirm `config/chats/<chat-id>/state.json` changes.
10. Confirm `config/chats/<chat-id>/evolution.jsonl` receives one JSON line after a successful evolution.
11. Confirm `config/logs/lifecycle.jsonl` and `config/chats/<chat-id>/lifecycle.jsonl` receive lifecycle JSON lines after opening a chat and saving settings.
