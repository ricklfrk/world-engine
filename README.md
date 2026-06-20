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
- Storage refactor: state is saved through `WORLD_ENGINE_STORAGE`, preferring SillyTavern extension settings instead of browser cache or browser `localStorage`.

## Install

1. Copy this folder into the SillyTavern extensions directory.
2. Restart or reload SillyTavern.
3. Enable `World Engine` from the extensions panel.
4. Open the World Engine panel and configure API settings if AI evolution or analysis is needed.

## Entry Points

- Extension entry: `world-engine.js`
- Stylesheet: `style.css`
- Metadata: `manifest.json`
- Architecture and workflow notes: `WORKFLOW.md`

## Verification

```powershell
Get-ChildItem -Filter *.js | ForEach-Object { node --check $_.FullName }
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
git diff --check
```
