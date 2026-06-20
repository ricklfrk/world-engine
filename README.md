# World Engine

World Engine is a SillyTavern extension for long-form roleplay continuity. It tracks world state, memories, worldbook entries, NPC emotions, story phases, achievements, combat stats, and in-world time, then injects a compact context block before generation.

## Highlights

- World-state engine for events, factions, rumors, economy, reputation, plot threads, and world laws.
- Memory extraction and recall driven by tags, location, importance, and recency.
- SillyTavern worldbook selection, entry matching, and AI-assisted world analysis.
- OpenAI-compatible evolution API calls for structured world updates.
- Prompt preset and injection style controls.
- UI panel for world state, memory, story, worldbook, settings, snapshots, and achievements.
- Enhancement layer for undo, recycle bin, dashboards, relation graphs, API monitor, weather/season, and scheduled evolution.
- Plaintext config storage: settings, per-chat state, savepoints, and conversation evolution logs are written under `config/`.
- Firefox-friendly UI controls: the main panel and popup windows can be moved by dragging their headers, and panel geometry is saved in `config/ui/panel-state.json`.
- Settings, prompt presets, snapshots, and full config import/export write through the same plaintext storage adapter.
- Saved settings, presets, worldbook selection, story/world state controls, and imports are applied immediately to the active injection context.

## Install

World Engine has a UI extension and a server plugin. The server plugin is required for plaintext `config/` folder writes.

1. Copy this folder into the SillyTavern extensions directory so the UI extension can load `manifest.json`.
2. Copy or symlink the same folder into SillyTavern's `plugins/world-engine` directory.
3. Set `enableServerPlugins: true` in SillyTavern `config.yaml`.
4. Restart SillyTavern so the `World Engine` server plugin loads.
5. Enable `World Engine` from the extensions panel.
6. Open the World Engine panel and configure API settings if AI evolution or analysis is needed.

Firefox is supported. If Firefox keeps an old script after updating, restart SillyTavern and reload the tab; the extension also appends the current World Engine version to loaded script URLs.

## Runtime Data

- Global settings: `config/settings.json`
- Presets: `config/presets.json`
- Worldbook selection: `config/worldbook/*.json`
- UI state: `config/ui/panel-state.json`
- Per-chat world state: `config/chats/<chat-id>/state.json`
- Per-chat config: `config/chats/<chat-id>/config.json`
- Rollback savepoints: `config/chats/<chat-id>/savepoints.json`
- Conversation evolution log: `config/chats/<chat-id>/evolution.jsonl`

## Entry Points

- UI extension entry: `world-engine.js`
- Server plugin entry: `index.js`
- Stylesheet: `style.css`
- Metadata: `manifest.json`
- Plaintext runtime folder: `config/`
- Architecture and workflow notes: `WORKFLOW.md`

## Verification

```powershell
Get-ChildItem -Filter *.js | ForEach-Object { node --check $_.FullName }
node --check index.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
git diff --check
```
