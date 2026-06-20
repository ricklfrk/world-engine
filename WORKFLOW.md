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
5. If the server plugin is available, storage hydrates cached values from `/api/plugins/world-engine/list` and `/api/plugins/world-engine/file`.
6. The UI is built, slash commands are registered, and SillyTavern chat events are subscribed.

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
| `config/kv/*.txt` | Fallback key/value files for uncommon keys. |

## Storage Rules

1. All persistent reads and writes go through `window.WORLD_ENGINE_STORAGE`.
2. UI code must not call server file APIs directly.
3. The server plugin only reads/writes inside `config/` and rejects path traversal.
4. Extension settings fallback is not canonical; it only keeps the UI functional when the server plugin is absent.
5. Conversation evolution logs are append-only JSONL so they can be audited with ordinary text tools.

## Verification Workflow

Run these before release:

```powershell
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
6. Send/receive one full exchange and confirm `config/chats/<chat-id>/state.json` changes.
7. Confirm `config/chats/<chat-id>/evolution.jsonl` receives one JSON line after a successful evolution.
