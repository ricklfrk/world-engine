// world-engine-logger.js - lifecycle audit logging
// ============================================================

window.WORLD_ENGINE_LOGGER = (function() {
  'use strict';

  var queue = [];
  var initialized = false;
  var sequence = 0;
  var version = '';
  var maxQueue = 500;
  var sessionId = 'we_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  var REDACT_KEYS = {
    apiKey: true,
    customKey: true,
    token: true,
    accessToken: true,
    authorization: true,
    Authorization: true,
    password: true,
    secret: true
  };

  function getContext() {
    try {
      if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) return SillyTavern.getContext();
    } catch(e) {}
    return null;
  }

  function getChatMeta() {
    var ctx = getContext();
    if (!ctx) return {};
    var meta = {};
    try {
      if (ctx.chatId !== undefined) meta.chatId = ctx.chatId;
      if (ctx.characterId !== undefined) meta.characterId = ctx.characterId;
      if (ctx.groupId !== undefined) meta.groupId = ctx.groupId;
      if (Array.isArray(ctx.chat)) meta.chatLength = ctx.chat.length;
    } catch(e) {}
    return meta;
  }

  function sanitize(value, depth, key) {
    depth = depth || 0;
    if (key && REDACT_KEYS[key]) return '[REDACTED]';
    if (value == null) return value;
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    var type = typeof value;
    if (type === 'string') {
      return value.length > 2000 ? value.slice(0, 2000) + '...[truncated]' : value;
    }
    if (type === 'number' || type === 'boolean') return value;
    if (type === 'function') return '[Function]';
    if (depth >= 5) return '[MaxDepth]';
    if (Array.isArray(value)) {
      var arr = value.slice(0, 50).map(function(item) { return sanitize(item, depth + 1); });
      if (value.length > 50) arr.push('[+' + (value.length - 50) + ' more]');
      return arr;
    }
    if (type === 'object') {
      var out = {};
      var keys = Object.keys(value);
      for (var i = 0; i < keys.length && i < 80; i++) {
        var k = keys[i];
        out[k] = sanitize(value[k], depth + 1, k);
      }
      if (keys.length > 80) out.__truncatedKeys = keys.length - 80;
      return out;
    }
    return String(value);
  }

  function write(entry) {
    var storage = window.WORLD_ENGINE_STORAGE;
    if (!storage || typeof storage.appendLifecycleLog !== 'function') return false;

    var chat = getChatMeta();
    var payload = Object.assign({
      timestamp: new Date().toISOString(),
      sessionId: sessionId,
      sequence: ++sequence,
      version: version || undefined,
      source: 'world-engine'
    }, chat, entry || {});

    return storage.appendLifecycleLog(payload);
  }

  function enqueue(entry) {
    queue.push(entry);
    if (queue.length > maxQueue) queue.shift();
  }

  function emit(type, details, level) {
    var entry = {
      type: type || 'event',
      level: level || 'info',
      details: sanitize(details || {})
    };
    if (!initialized) {
      enqueue(entry);
      return true;
    }
    return write(entry);
  }

  function flush() {
    if (!initialized) return false;
    var pending = queue.slice();
    queue = [];
    for (var i = 0; i < pending.length; i++) write(pending[i]);
    return true;
  }

  function init(options) {
    options = options || {};
    version = options.version || version;
    initialized = true;
    emit('logger.init', {
      backend: options.backend || '',
      queued: queue.length,
      sessionId: sessionId
    });
    flush();
    return true;
  }

  function error(type, err, details) {
    return emit(type || 'error', Object.assign({}, details || {}, { error: sanitize(err) }), 'error');
  }

  try {
    window.addEventListener('world-engine:config-saved', function(event) {
      emit('config.saved', event && event.detail ? event.detail : {});
    });
    window.addEventListener('world-engine:storage-write', function(event) {
      emit('storage.write', event && event.detail ? event.detail : {}, 'debug');
    });
    window.addEventListener('error', function(event) {
      emit('browser.error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      }, 'error');
    });
    window.addEventListener('unhandledrejection', function(event) {
      error('browser.unhandledrejection', event.reason || event);
    });
  } catch(e) {}

  return {
    init: init,
    flush: flush,
    log: emit,
    lifecycle: function(type, details, level) { return emit('lifecycle.' + type, details, level); },
    config: function(type, details, level) { return emit('config.' + type, details, level); },
    ui: function(type, details, level) { return emit('ui.' + type, details, level); },
    message: function(type, details, level) { return emit('message.' + type, details, level); },
    evolution: function(type, details, level) { return emit('evolution.' + type, details, level); },
    error: error,
    getSessionId: function() { return sessionId; }
  };
})();
