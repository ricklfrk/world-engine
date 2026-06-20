const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function createBrowserSandbox(options = {}) {
  const listeners = {};
  const appends = [];
  const writes = [];
  const deletes = [];
  const requests = [];
  const reads = new Map(Object.entries(options.files || {}));
  const context = Object.assign({
    chatId: 'chat A',
    characterId: 'char-1',
    groupId: null,
    chat: [{ mes: 'hello' }],
    extensionSettings: {},
    saveSettingsDebounced() {}
  }, options.context || {});

  const window = {
    extension_settings: context.extensionSettings,
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    dispatchEvent(event) {
      (listeners[event.type] || []).forEach((fn) => fn(event));
    }
  };

  function CustomEvent(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  }

  async function fetch(url, fetchOptions = {}) {
    requests.push({ url, options: fetchOptions });
    if (url.endsWith('/status')) return jsonResponse({ ok: true });
    if (url.endsWith('/list')) {
      return jsonResponse({ files: Array.from(reads.keys()).map((filePath) => ({ path: filePath })) });
    }
    if (url.includes('/file?path=')) {
      const filePath = decodeURIComponent(url.split('/file?path=')[1]);
      return jsonResponse({ ok: true, content: reads.get(filePath) || '' });
    }
    if (url.endsWith('/file') && fetchOptions.method === 'PUT') {
      const body = JSON.parse(fetchOptions.body || '{}');
      writes.push(body);
      reads.set(body.path, body.content);
      return jsonResponse({ ok: true });
    }
    if (url.endsWith('/file') && fetchOptions.method === 'DELETE') {
      const body = JSON.parse(fetchOptions.body || '{}');
      deletes.push(body);
      reads.delete(body.path);
      return jsonResponse({ ok: true });
    }
    if (url.endsWith('/append')) {
      const body = JSON.parse(fetchOptions.body || '{}');
      appends.push(body);
      reads.set(body.path, (reads.get(body.path) || '') + body.content);
      return jsonResponse({ ok: true });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }

  function jsonResponse(payload) {
    return { ok: true, status: 200, json: async () => payload };
  }

  const sandbox = {
    window,
    CustomEvent,
    fetch,
    console,
    setTimeout,
    clearTimeout,
    SillyTavern: { getContext: () => context }
  };
  window.window = window;

  return { sandbox, window, context, listeners, appends, writes, deletes, reads, requests };
}

function runScript(sandbox, file) {
  vm.runInNewContext(read(file), sandbox, { filename: file });
}

function parseAppendLines(appends) {
  return appends
    .filter((entry) => entry.path.endsWith('.jsonl'))
    .map((entry) => JSON.parse(String(entry.content).trim()));
}

test('lifecycle logger queues, flushes, redacts, and writes global plus chat logs', async () => {
  const env = createBrowserSandbox();
  runScript(env.sandbox, 'world-engine-storage.js');
  runScript(env.sandbox, 'world-engine-logger.js');

  env.window.WORLD_ENGINE_LOGGER.lifecycle('queued.before-init', {
    apiKey: 'secret',
    nested: { password: 'hidden' },
    visible: true
  });

  await env.window.WORLD_ENGINE_STORAGE.initConfigFolder();
  env.window.WORLD_ENGINE_LOGGER.init({
    version: 'test-version',
    backend: env.window.WORLD_ENGINE_STORAGE.getBackendName()
  });
  env.window.WORLD_ENGINE_LOGGER.message('before-send.start', { ok: true });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const paths = env.appends.map((entry) => entry.path);
  assert(paths.includes('logs/lifecycle.jsonl'));
  assert(paths.includes('chats/chat%20A/lifecycle.jsonl'));

  const lines = parseAppendLines(env.appends);
  const globalLines = env.appends
    .filter((entry) => entry.path === 'logs/lifecycle.jsonl')
    .map((entry) => JSON.parse(String(entry.content).trim()));
  const queued = lines.find((line) => line.type === 'lifecycle.queued.before-init');
  assert(queued, 'queued event should be flushed after init');
  assert.equal(queued.details.apiKey, '[REDACTED]');
  assert.equal(queued.details.nested.password, '[REDACTED]');
  assert.equal(queued.version, 'test-version');
  assert.equal(queued.chatId, 'chat A');
  assert(lines.some((line) => line.type === 'message.before-send.start'));
  assert.deepEqual(globalLines.map((line) => line.sequence), globalLines.map((_, index) => index + 1));
});

test('storage emits config and write lifecycle metadata without logging raw content', async () => {
  const env = createBrowserSandbox();
  runScript(env.sandbox, 'world-engine-storage.js');
  runScript(env.sandbox, 'world-engine-logger.js');

  await env.window.WORLD_ENGINE_STORAGE.initConfigFolder();
  env.window.WORLD_ENGINE_LOGGER.init({ version: 'test' });
  env.window.WORLD_ENGINE_STORAGE.setItem('world_engine_settings', '{"apiKey":"secret"}');
  env.window.WORLD_ENGINE_STORAGE.setItem('world_engine_panel_state', '{"x":1}');
  env.window.WORLD_ENGINE_STORAGE.removeItem('world_engine_active_preset');
  await new Promise((resolve) => setTimeout(resolve, 0));

  const lines = parseAppendLines(env.appends);
  const storageWrites = lines.filter((line) => line.type === 'storage.write');
  assert(storageWrites.some((line) => line.details.key === 'world_engine_settings' && line.details.path === 'settings.json'));
  assert(storageWrites.some((line) => line.details.key === 'world_engine_panel_state' && line.details.path === 'ui/panel-state.json'));
  assert(storageWrites.some((line) => line.details.key === 'world_engine_active_preset' && line.details.action === 'remove'));
  assert(lines.some((line) => line.type === 'config.saved' && line.details.key === 'world_engine_settings'));
  assert(lines.some((line) => line.type === 'config.saved' && line.details.key === 'world_engine_active_preset'));
  assert(!lines.some((line) => JSON.stringify(line).includes('secret')), 'raw config content must not enter lifecycle logs');
});

test('storage sends SillyTavern request headers to plugin writes', async () => {
  const env = createBrowserSandbox({
    context: {
      getRequestHeaders() {
        return { 'X-CSRF-Token': 'csrf-token' };
      }
    }
  });
  runScript(env.sandbox, 'world-engine-storage.js');

  await env.window.WORLD_ENGINE_STORAGE.initConfigFolder();
  env.window.WORLD_ENGINE_STORAGE.setItem('world_engine_settings', '{"ok":true}');
  await new Promise((resolve) => setTimeout(resolve, 0));

  const writeRequest = env.requests.find((request) => request.url.endsWith('/file') && request.options.method === 'PUT');
  assert(writeRequest, 'PUT request missing');
  assert.equal(writeRequest.options.headers['X-CSRF-Token'], 'csrf-token');
  assert.equal(writeRequest.options.headers['Content-Type'], 'application/json');
});

test('core saveState produces lifecycle state.save and writes chat files', async () => {
  const env = createBrowserSandbox({ context: { chatId: 'state chat', chat: [{ mes: 'one' }, { mes: 'two' }] } });
  runScript(env.sandbox, 'world-engine-storage.js');
  runScript(env.sandbox, 'world-engine-logger.js');
  runScript(env.sandbox, 'world-engine-core.js');

  await env.window.WORLD_ENGINE_STORAGE.initConfigFolder();
  env.window.WORLD_ENGINE_LOGGER.init({ version: 'test' });

  const state = env.window.WORLD_ENGINE_CORE.loadState();
  state.round = 7;
  state.memories = [{ id: 'm1', summary: 'remembered' }];
  state.events = [{ name: 'event', currentRound: 1, totalRounds: 3 }];
  state.factions = [{ name: 'faction' }];
  state.plotThreads = [{ title: 'thread' }];
  env.window.WORLD_ENGINE_CORE.saveState(state);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(env.writes.some((entry) => entry.path === 'chats/state%20chat/state.json'));
  assert(env.writes.some((entry) => entry.path === 'chats/state%20chat/config.json'));

  const lines = parseAppendLines(env.appends);
  const stateSave = lines.find((line) => line.type === 'lifecycle.state.save');
  assert(stateSave, 'state.save lifecycle log missing');
  assert.equal(stateSave.details.chatId, 'state chat');
  assert.equal(stateSave.details.round, 7);
  assert.equal(stateSave.details.memories, 1);
  assert.equal(stateSave.details.events, 1);
  assert.equal(stateSave.details.factions, 1);
  assert.equal(stateSave.details.plotThreads, 1);
});

test('world-engine loader includes logger and covers major lifecycle event names', () => {
  const source = read('world-engine.js');
  assert(source.indexOf("'world-engine-storage.js'") < source.indexOf("'world-engine-logger.js'"));
  assert(source.indexOf("'world-engine-logger.js'") < source.indexOf("'world-engine-core.js'"));

  [
    'boot.start',
    'module.load.start',
    'module.load.done',
    'storage.init.start',
    'storage.init.done',
    'css.reloaded',
    'ui.build.start',
    'ui.build.done',
    'slash.register.done',
    'config.apply.start',
    'config.apply.done',
    'before-send.start',
    'before-send.done',
    'received.start',
    'received.done',
    'chat.loaded.start',
    'chat.loaded.done',
    'message.swiped.start',
    'message.swiped.rollback',
    'message.deleted.start',
    'message.deleted.rollback',
    'events.subscribed',
    'presets.init.done',
    'boot.done'
  ].forEach((eventName) => {
    assert(source.includes(eventName), `missing lifecycle event: ${eventName}`);
  });
});
