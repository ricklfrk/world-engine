// world-engine-storage.js - plaintext config folder storage adapter
// ============================================================

window.WORLD_ENGINE_STORAGE = (function() {
  'use strict';

  var NAMESPACE = 'world_engine';
  var PLUGIN_BASE = '/api/plugins/world-engine';
  var cache = {};
  var memoryStore = {};
  var configFolderAvailable = false;
  var hydratePromise = null;
  var serverStatus = null;

  var APPLY_CONFIG_KEYS = {
    world_engine_settings: true,
    world_engine_presets: true,
    world_engine_active_preset: true,
    world_engine_inject_style: true,
    world_engine_worldbook_selection: true,
    world_engine_wb_books: true,
    world_engine_wb_autoActivate: true
  };

  var KNOWN_KEY_PATHS = {
    world_engine_settings: 'settings.json',
    world_engine_presets: 'presets.json',
    world_engine_active_preset: 'active-preset.txt',
    world_engine_inject_style: 'inject-style.txt',
    world_engine_worldbook_selection: 'worldbook/entry-selection.json',
    world_engine_wb_books: 'worldbook/books.json',
    world_engine_wb_autoActivate: 'worldbook/auto-activate.txt',
    world_engine_notification_history: 'notifications.json',
    world_engine_ach_sort: 'ui/achievement-sort.txt',
    world_engine_panel_state: 'ui/panel-state.json',
    world_engine_auto_backups: 'backups.json',
    world_engine_config: 'config.json'
  };

  function getContext() {
    try {
      if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        return SillyTavern.getContext();
      }
    } catch(e) {}
    return null;
  }

  function getExtensionSettingsRoot() {
    var ctx = getContext();
    if (ctx) {
      if (ctx.extensionSettings && typeof ctx.extensionSettings === 'object') return ctx.extensionSettings;
      if (ctx.extension_settings && typeof ctx.extension_settings === 'object') return ctx.extension_settings;
    }
    try {
      if (window.extension_settings && typeof window.extension_settings === 'object') {
        return window.extension_settings;
      }
    } catch(e) {}
    return null;
  }

  function getFallbackBucket(create) {
    var root = getExtensionSettingsRoot();
    if (!root) return memoryStore;
    if (!root[NAMESPACE] || typeof root[NAMESPACE] !== 'object') {
      if (!create) return {};
      root[NAMESPACE] = {};
    }
    if (!root[NAMESPACE].kv || typeof root[NAMESPACE].kv !== 'object') {
      if (!create) return {};
      root[NAMESPACE].kv = {};
    }
    return root[NAMESPACE].kv;
  }

  function saveFallbackSettings() {
    try {
      var ctx = getContext();
      if (ctx && typeof ctx.saveSettingsDebounced === 'function') return ctx.saveSettingsDebounced();
      if (ctx && typeof ctx.saveSettings === 'function') return ctx.saveSettings();
      if (typeof window.saveSettingsDebounced === 'function') return window.saveSettingsDebounced();
    } catch(e) {
      console.warn('[World Engine] Failed to save fallback extension settings', e);
    }
  }

  function encodeSegment(value) {
    return encodeURIComponent(String(value || 'default')).replace(/[!'()*]/g, function(ch) {
      return '%' + ch.charCodeAt(0).toString(16).toUpperCase();
    });
  }

  function decodeSegment(value) {
    try { return decodeURIComponent(value); } catch(e) { return value; }
  }

  function keyToPath(key) {
    if (KNOWN_KEY_PATHS[key]) return KNOWN_KEY_PATHS[key];
    if (key.indexOf('world_engine_config_') === 0) {
      return 'chats/' + encodeSegment(key.substring('world_engine_config_'.length)) + '/config.json';
    }
    if (key.indexOf('world_enginesavepoint_') === 0) {
      return 'chats/' + encodeSegment(key.substring('world_enginesavepoint_'.length)) + '/savepoints.json';
    }
    if (key.indexOf('world_engine_') === 0) {
      return 'chats/' + encodeSegment(key.substring('world_engine_'.length)) + '/state.json';
    }
    return 'kv/' + encodeSegment(key) + '.txt';
  }

  function pathToKey(filePath) {
    var path = String(filePath || '').replace(/\\/g, '/');
    var known = Object.keys(KNOWN_KEY_PATHS);
    for (var i = 0; i < known.length; i++) {
      if (KNOWN_KEY_PATHS[known[i]] === path) return known[i];
    }
    var chatMatch = path.match(/^chats\/([^/]+)\/(state|config|savepoints)\.json$/);
    if (chatMatch) {
      var chatId = decodeSegment(chatMatch[1]);
      if (chatMatch[2] === 'state') return 'world_engine_' + chatId;
      if (chatMatch[2] === 'config') return 'world_engine_config_' + chatId;
      if (chatMatch[2] === 'savepoints') return 'world_enginesavepoint_' + chatId;
    }
    var kvMatch = path.match(/^kv\/(.+)\.txt$/);
    if (kvMatch) return decodeSegment(kvMatch[1]);
    return null;
  }

  function normalizeValue(value) {
    if (value === undefined || value === null) return '';
    return String(value);
  }

  function getSillyTavernRequestHeaders() {
    try {
      var ctx = getContext();
      if (ctx && typeof ctx.getRequestHeaders === 'function') {
        return ctx.getRequestHeaders() || {};
      }
    } catch(e) {}
    try {
      if (typeof window.getRequestHeaders === 'function') {
        return window.getRequestHeaders() || {};
      }
    } catch(e) {}
    return {};
  }

  function notifyConfigChanged(key, action) {
    if (!APPLY_CONFIG_KEYS[key]) return;
    try {
      window.dispatchEvent(new CustomEvent('world-engine:config-saved', {
        detail: {
          key: key,
          path: keyToPath(key),
          action: action || 'set',
          backend: getBackendName()
        }
      }));
    } catch(e) {}
  }

  function notifyStorageChanged(key, action, bytes) {
    try {
      window.dispatchEvent(new CustomEvent('world-engine:storage-write', {
        detail: {
          key: key,
          path: keyToPath(key),
          action: action || 'set',
          bytes: bytes || 0,
          backend: getBackendName()
        }
      }));
    } catch(e) {}
  }

  async function pluginRequest(route, options) {
    var requestOptions = Object.assign({}, options || {});
    requestOptions.headers = Object.assign(
      {},
      getSillyTavernRequestHeaders(),
      { 'Content-Type': 'application/json' },
      requestOptions.headers || {}
    );
    var response = await fetch(PLUGIN_BASE + route, requestOptions);
    if (!response.ok) {
      throw new Error('World Engine plugin HTTP ' + response.status + ' for ' + route);
    }
    return response.json();
  }

  async function readConfigFile(path) {
    var data = await pluginRequest('/file?path=' + encodeURIComponent(path), { method: 'GET' });
    return typeof data.content === 'string' ? data.content : null;
  }

  async function writeConfigFile(path, content) {
    return pluginRequest('/file', {
      method: 'PUT',
      body: JSON.stringify({ path: path, content: normalizeValue(content) })
    });
  }

  async function appendConfigFile(path, content) {
    return pluginRequest('/append', {
      method: 'POST',
      body: JSON.stringify({ path: path, content: normalizeValue(content) })
    });
  }

  async function initConfigFolder() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async function() {
      try {
        serverStatus = await pluginRequest('/status', { method: 'GET' });
        configFolderAvailable = true;
        var listed = await pluginRequest('/list', { method: 'GET' });
        var files = Array.isArray(listed.files) ? listed.files : [];
        for (var i = 0; i < files.length; i++) {
          var path = files[i].path || files[i];
          var key = pathToKey(path);
          if (!key) continue;
          try {
            var content = await readConfigFile(path);
            if (content !== null) cache[key] = content;
          } catch(e) {
            console.warn('[World Engine] Failed to hydrate config file:', path, e);
          }
        }
        console.log('[World Engine] Config folder storage ready:', files.length, 'files');
        return true;
      } catch(e) {
        serverStatus = null;
        configFolderAvailable = false;
        console.warn('[World Engine] Config folder server plugin unavailable; using fallback memory/settings store.', e.message || e);
        return false;
      }
    })();
    return hydratePromise;
  }

  function writeThrough(key, value) {
    var content = normalizeValue(value);
    cache[key] = content;

    if (configFolderAvailable) {
      writeConfigFile(keyToPath(key), content).catch(function(e) {
        console.warn('[World Engine] Failed to write config file for key:', key, e);
      });
      notifyStorageChanged(key, 'set', content.length);
      notifyConfigChanged(key, 'set');
      return true;
    }

    var bucket = getFallbackBucket(true);
    bucket[key] = content;
    saveFallbackSettings();
    notifyStorageChanged(key, 'set', content.length);
    notifyConfigChanged(key, 'set');
    return true;
  }

  function removeThrough(key) {
    delete cache[key];
    if (configFolderAvailable) {
      pluginRequest('/file', {
        method: 'DELETE',
        body: JSON.stringify({ path: keyToPath(key) })
      }).catch(function(e) {
        console.warn('[World Engine] Failed to remove config file for key:', key, e);
      });
      notifyStorageChanged(key, 'remove', 0);
      notifyConfigChanged(key, 'remove');
      return true;
    }
    var bucket = getFallbackBucket(false);
    if (Object.prototype.hasOwnProperty.call(bucket, key)) {
      delete bucket[key];
      saveFallbackSettings();
    }
    notifyStorageChanged(key, 'remove', 0);
    notifyConfigChanged(key, 'remove');
    return true;
  }

  function getItem(key) {
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    var bucket = getFallbackBucket(false);
    return Object.prototype.hasOwnProperty.call(bucket, key) ? bucket[key] : null;
  }

  function setItem(key, value) {
    try { return writeThrough(key, value); } catch(e) { return false; }
  }

  function removeItem(key) {
    try { return removeThrough(key); } catch(e) { return false; }
  }

  function clear() {
    Object.keys(cache).forEach(function(key) {
      if (key.indexOf('world_engine') === 0 || key.indexOf('engine') === 0) removeThrough(key);
    });
    return true;
  }

  function keys() {
    var all = {};
    Object.keys(getFallbackBucket(false)).forEach(function(key) { all[key] = true; });
    Object.keys(cache).forEach(function(key) { all[key] = true; });
    return Object.keys(all).filter(function(key) {
      return key.indexOf('world_engine') === 0 || key.indexOf('engine') === 0;
    });
  }

  function getJSON(key) {
    var raw = getItem(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) { return null; }
  }

  function setJSON(key, data) {
    return setItem(key, JSON.stringify(data, null, 2));
  }

  function getKey(prefix, chatId, suffix) {
    var parts = ['engine'];
    if (prefix) parts.push(prefix);
    if (chatId) parts.push(chatId);
    if (suffix) parts.push(suffix);
    return parts.join('_');
  }

  function getChatIdFromState(state) {
    if (state && state.lastUpdated && state.lastUpdated.chatId) return state.lastUpdated.chatId;
    try {
      var ctx = getContext();
      if (ctx && ctx.chatId) return ctx.chatId;
    } catch(e) {}
    return 'default';
  }

  function getActiveChatId() {
    try {
      var ctx = getContext();
      if (ctx && ctx.chatId) return ctx.chatId;
    } catch(e) {}
    return null;
  }

  function appendEvolutionLog(state, entry) {
    var chatId = getChatIdFromState(state);
    var payload = Object.assign({
      timestamp: new Date().toISOString(),
      chatId: chatId
    }, entry || {});
    var line = JSON.stringify(payload);
    if (configFolderAvailable) {
      appendConfigFile('chats/' + encodeSegment(chatId) + '/evolution.jsonl', line + '\n').catch(function(e) {
        console.warn('[World Engine] Failed to append evolution log:', e);
      });
    }
    return true;
  }

  function appendLifecycleLog(entry) {
    var payload = Object.assign({
      timestamp: new Date().toISOString()
    }, entry || {});
    if (!payload.chatId) payload.chatId = getActiveChatId();
    var line = JSON.stringify(payload);
    if (!configFolderAvailable) return false;

    appendConfigFile('logs/lifecycle.jsonl', line + '\n').catch(function(e) {
      console.warn('[World Engine] Failed to append lifecycle log:', e);
    });

    if (payload.chatId && payload.chatId !== 'default') {
      appendConfigFile('chats/' + encodeSegment(payload.chatId) + '/lifecycle.jsonl', line + '\n').catch(function(e) {
        console.warn('[World Engine] Failed to append chat lifecycle log:', e);
      });
    }
    return true;
  }

  function getBackendName() {
    return configFolderAvailable ? 'config-folder' : (getExtensionSettingsRoot() ? 'fallback-extension-settings' : 'fallback-memory');
  }

  function getServerStatus() {
    if (!serverStatus) return null;
    return Object.assign({}, serverStatus);
  }

  function getServerVersion() {
    return serverStatus && serverStatus.pluginVersion ? String(serverStatus.pluginVersion) : '';
  }

  return {
    initConfigFolder: initConfigFolder,
    getBackendName: getBackendName,
    getServerStatus: getServerStatus,
    getServerVersion: getServerVersion,
    getItem: getItem,
    setItem: setItem,
    removeItem: removeItem,
    clear: clear,
    keys: keys,
    getKeys: keys,
    getJSON: getJSON,
    setJSON: setJSON,
    remove: removeItem,
    getKey: getKey,
    keyToPath: keyToPath,
    pathToKey: pathToKey,
    appendEvolutionLog: appendEvolutionLog,
    appendLifecycleLog: appendLifecycleLog,
    getAdapter: function() { return this; },
    setAdapter: function() { return false; }
  };
})();
