// world-engine-storage.js - storage adapter without browser cache dependency
// ============================================================

window.WORLD_ENGINE_STORAGE = (function() {
  'use strict';

  var NAMESPACE = 'world_engine';
  var memoryStore = {};

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

  function saveSettings() {
    try {
      var ctx = getContext();
      if (ctx && typeof ctx.saveSettingsDebounced === 'function') {
        ctx.saveSettingsDebounced();
        return;
      }
      if (ctx && typeof ctx.saveSettings === 'function') {
        ctx.saveSettings();
        return;
      }
      if (typeof window.saveSettingsDebounced === 'function') {
        window.saveSettingsDebounced();
      }
    } catch(e) {
      console.warn('[World Engine] Failed to save extension settings', e);
    }
  }

  function getBucket(create) {
    var root = getExtensionSettingsRoot();
    if (!root) return memoryStore;

    if (!root[NAMESPACE] || typeof root[NAMESPACE] !== 'object') {
      if (!create) return {};
      root[NAMESPACE] = {};
    }

    var ns = root[NAMESPACE];
    if (!ns.kv || typeof ns.kv !== 'object') {
      if (!create) return {};
      ns.kv = {};
    }
    return ns.kv;
  }

  function normalizeValue(value) {
    if (value === undefined || value === null) return '';
    return String(value);
  }

  function createSillyTavernSettingsAdapter() {
    return {
      getItem: function(key) {
        try {
          var bucket = getBucket(false);
          return Object.prototype.hasOwnProperty.call(bucket, key) ? bucket[key] : null;
        } catch(e) {
          return null;
        }
      },
      setItem: function(key, value) {
        try {
          var bucket = getBucket(true);
          bucket[key] = normalizeValue(value);
          saveSettings();
          return true;
        } catch(e) {
          return false;
        }
      },
      removeItem: function(key) {
        try {
          var bucket = getBucket(false);
          if (Object.prototype.hasOwnProperty.call(bucket, key)) {
            delete bucket[key];
            saveSettings();
          }
          return true;
        } catch(e) {
          return false;
        }
      },
      clear: function() {
        try {
          var bucket = getBucket(false);
          Object.keys(bucket).forEach(function(key) {
            if (key.indexOf('engine') === 0) delete bucket[key];
          });
          saveSettings();
          return true;
        } catch(e) {
          return false;
        }
      },
      keys: function() {
        try {
          var bucket = getBucket(false);
          return Object.keys(bucket).filter(function(key) { return key.indexOf('engine') === 0; });
        } catch(e) {
          return [];
        }
      },
      backend: function() {
        return getExtensionSettingsRoot() ? 'sillytavern-extension-settings' : 'memory';
      }
    };
  }

  var adapter = createSillyTavernSettingsAdapter();

  function getAdapter() {
    return adapter;
  }

  function setAdapter(nextAdapter) {
    if (nextAdapter && typeof nextAdapter.getItem === 'function' && typeof nextAdapter.setItem === 'function') {
      adapter = nextAdapter;
      return true;
    }
    return false;
  }

  function getJSON(key) {
    var raw = adapter.getItem(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) { return null; }
  }

  function setJSON(key, data) {
    return adapter.setItem(key, JSON.stringify(data));
  }

  function remove(key) {
    return adapter.removeItem(key);
  }

  function getKeys() {
    return adapter.keys();
  }

  function getKey(prefix, chatId, suffix) {
    var parts = ['engine'];
    if (prefix) parts.push(prefix);
    if (chatId) parts.push(chatId);
    if (suffix) parts.push(suffix);
    return parts.join('_');
  }

  function getBackendName() {
    return typeof adapter.backend === 'function' ? adapter.backend() : 'custom';
  }

  return {
    getAdapter: getAdapter,
    setAdapter: setAdapter,
    getItem: function(key) { return adapter.getItem(key); },
    setItem: function(key, value) { return adapter.setItem(key, value); },
    removeItem: function(key) { return adapter.removeItem(key); },
    clear: function() { return adapter.clear(); },
    getJSON: getJSON,
    setJSON: setJSON,
    remove: remove,
    getKeys: getKeys,
    getKey: getKey,
    getBackendName: getBackendName,
  };
})();
