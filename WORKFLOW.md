# World Engine Architecture and Workflow

World Engine is a SillyTavern extension that keeps a roleplay world alive across chat turns. It watches SillyTavern events, extracts tags and memories, evolves a structured world state, builds a prompt context, and injects that context before generation.

This refactor intentionally does not use browser cache or browser `localStorage` as the source of truth. Runtime data is stored through `WORLD_ENGINE_STORAGE`, which prefers SillyTavern extension settings and falls back to an in-memory store only when SillyTavern is unavailable.

## File Structure

| File | Responsibility |
| --- | --- |
| `manifest.json` | SillyTavern extension metadata and entrypoints. |
| `world-engine.js` | Loader and event orchestration. Loads modules, builds UI, registers slash commands, subscribes to chat events, and manages prompt injection. |
| `world-engine-storage.js` | Storage adapter. Uses SillyTavern extension settings first, with memory fallback. No browser cache dependency. |
| `world-engine-core.js` | Canonical world state model, migrations, savepoints, achievements, story templates, NPC schedules, plot threads, and combat/lifecycle helpers. |
| `world-engine-memory.js` | Memory extraction, summary generation, and recall ranking. |
| `world-engine-tags.js` | Prediction and extraction of entities, locations, factions, topics, emotions, and trigger tags. |
| `world-engine-presets.js` | Prompt preset model, import/export helpers, context cleanup, and injection style controls. |
| `world-engine-worldbook.js` | SillyTavern worldbook discovery, entry selection, matching, and worldbook analysis. |
| `world-engine-inject.js` | Builds the compact world-context block injected into SillyTavern prompts. |
| `world-engine-evolution.js` | Calls the configured OpenAI-compatible API and applies world evolution updates. |
| `world-engine-time.js` | In-world time estimation, formatting, and time-trigger detection. |
| `world-engine-slash.js` | Slash command registration for `/world`, `/memory`, and `/engine`. |
| `world-engine-ui.js` | Main panel UI, settings, world state views, memory management, worldbook controls, snapshots, and help. |
| `world-engine-24enhance.js` | Progressive enhancement layer: undo list, recycle bin, charts, achievement popups, weather/season controls, scheduled evolution, API monitor, and richer tab rendering. |
| `style.css` | Extension styling. |

## Boot Workflow

1. SillyTavern loads `world-engine.js` from `manifest.json`.
2. The loader resolves the extension base URL and loads all module files in dependency order.
3. Each module attaches a namespaced API to `window`, for example `window.WORLD_ENGINE_CORE`.
4. `world-engine.js` initializes the UI and slash commands.
5. The loader subscribes to SillyTavern event source events:
   - `MESSAGE_SENT`
   - `MESSAGE_RECEIVED`
   - `CHAT_LOADED`
   - `MESSAGE_SWIPED`
   - `MESSAGE_EDITED`
   - `MESSAGE_DELETED`
6. The enhancement module waits for the panel to exist, then decorates active tabs without replacing the core UI contract.

## Message Workflow

### Before User Message Sends

1. Load the current world state from `WORLD_ENGINE_CORE`.
2. Load active settings through `WORLD_ENGINE_STORAGE`.
3. Load selected worldbooks on first use.
4. Generate prediction tags from recent chat history.
5. Build an injected context block with:
   - world digest
   - relevant memories
   - active events
   - factions and rumors
   - world laws
   - story template/tone
   - selected worldbook entries
   - achievement echoes
6. Register the context through the best available SillyTavern injection API.

### After Assistant Message Arrives

1. Skip opening messages and duplicate evolution runs.
2. Save a rollback point before mutating state.
3. Extract memory and tags from the new exchange.
4. Advance in-world time and trigger time events.
5. Evolve the world state when drive mode and interval rules allow it.
6. Apply world updates:
   - memories
   - events
   - factions
   - rumors
   - blood feud state
   - NPC activities
   - plot threads
   - character portraits
   - achievements
   - combat statistics
7. Save state and refresh the UI.

## Storage Workflow

All persistent reads and writes must go through `window.WORLD_ENGINE_STORAGE`.

Storage key groups:

| Prefix | Purpose |
| --- | --- |
| `world_engine_state_*` | Per-chat world state. |
| `world_engine_config_*` | Per-chat configuration fields. |
| `world_engine_settings` | Global extension settings. |
| `world_engine_presets` | Prompt preset definitions. |
| `world_engine_worldbook_selection` | Selected worldbook entries. |
| `world_engine_wb_books` | Selected worldbook names. |
| `world_engine_savepoints_*` | Per-chat rollback savepoints. |
| `world_engine_auto_backups` | Snapshot metadata. |

The adapter stores data under one SillyTavern extension-settings namespace. This keeps state portable with SillyTavern settings instead of binding it to one browser profile.

## Refactor Rules

1. Do not read or write browser `localStorage` directly.
2. Do not treat cached browser state as canonical data.
3. Keep public module names stable, because modules communicate through `window.WORLD_ENGINE_*`.
4. Keep `manifest.json` entrypoints stable for SillyTavern compatibility.
5. Prefer additive migrations in `core.ensureArrays` over destructive state rewrites.
6. Keep prompt injection behind `world-engine-inject.js`; other modules should not hand-build final prompt blocks.
7. Keep API calls inside `world-engine-evolution.js` or explicit analysis helpers that delegate to it.

## Verification Workflow

Run these before release:

```powershell
Get-ChildItem -Filter *.js | ForEach-Object { node --check $_.FullName }
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
git diff --check
```

Manual SillyTavern smoke checks:

1. Install the extension folder.
2. Open a chat and confirm the World Engine panel button appears.
3. Open settings and save API settings.
4. Send one user message and confirm injection does not create visible chat spam.
5. Receive one assistant message and confirm world state, memory, and UI refresh.
6. Swipe/delete a message and confirm rollback behavior.
7. Reload SillyTavern and confirm state is restored through extension settings, not browser cache.
