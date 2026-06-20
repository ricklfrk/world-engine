/* world-engine-ui.js — 全面 UI 重写 v3.0.0
 * 基于预览设计，替换全部 ?? 占位符，全 emoji 化，数据驱动
 * ────────────────────────────────────────────────────── */
window.WORLD_ENGINE_UI = (function() {
  'use strict';

  var core = window.WORLD_ENGINE_CORE;
  var memory = window.WORLD_ENGINE_MEMORY;
  var evolution = window.WORLD_ENGINE_EVOLUTION;
  var worldbook = window.WORLD_ENGINE_WORLDBOOK;
  var timeModule = window.WORLD_ENGINE_TIME;

  var panelVisible = false;
  var currentTab = 'overview';
  var panelElement = null;
  var PANEL_STATE_KEY = 'world_engine_panel_state';

  /* ── helpers ── */
  function esc(s) { return String(s).replace(/[&<>"']/g, function(m) {
    return m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '>' ? '&gt;' : m === '"' ? '&quot;' : '&#39;'; }); }

  function readJSON(raw, fallback) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch(e) { return fallback; }
  }

  function readSettings() {
    return readJSON(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings'), {});
  }

  function saveSettings(settings) {
    window.WORLD_ENGINE_STORAGE.setItem('world_engine_settings', JSON.stringify(settings || {}, null, 2));
  }

  function logUi(event, detail, level) {
    try {
      if (window.WORLD_ENGINE_LOGGER && typeof window.WORLD_ENGINE_LOGGER.ui === 'function') {
        window.WORLD_ENGINE_LOGGER.ui(event, detail || {}, level || 'info');
      }
    } catch(e) {}
  }

  function readPanelState() {
    return readJSON(window.WORLD_ENGINE_STORAGE.getItem(PANEL_STATE_KEY), {});
  }

  function savePanelStatePatch(patch) {
    var state = readPanelState();
    for (var key in patch) state[key] = patch[key];
    try { window.WORLD_ENGINE_STORAGE.setItem(PANEL_STATE_KEY, JSON.stringify(state, null, 2)); } catch(e) {}
    logUi('panel.state.save', { patch: patch }, 'debug');
  }

  function downloadJson(filename, data) {
    var blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    options = options || {};
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, timeoutMs || 5000);
    var opts = Object.assign({}, options, { signal: controller.signal });
    return fetch(url, opts).finally(function() { clearTimeout(timer); });
  }

  function viewport() {
    return {
      w: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
      h: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
    };
  }

  function clamp(value, min, max) {
    if (max < min) max = min;
    return Math.min(Math.max(value, min), max);
  }

  function getPoint(e) {
    var src = e;
    if (e.touches && e.touches.length) src = e.touches[0];
    else if (e.changedTouches && e.changedTouches.length) src = e.changedTouches[0];
    return { x: src.clientX || 0, y: src.clientY || 0 };
  }

  function isInteractiveTarget(target) {
    return !!(target && target.closest && target.closest('button,input,select,textarea,a,label,.tab-btn,.hdr-close,.world-engine-resize-handle'));
  }

  function clampBoxToViewport(width, height, left, top) {
    var vp = viewport();
    var margin = 8;
    return {
      left: clamp(left, margin, vp.w - Math.min(width, vp.w - margin * 2) - margin),
      top: clamp(top, margin, vp.h - Math.min(height, vp.h - margin * 2) - margin)
    };
  }

  function savePanelGeometry(panel) {
    if (!panel) return;
    var rect = panel.getBoundingClientRect();
    savePanelStatePatch({
      left: Math.round(rect.left) + 'px',
      top: Math.round(rect.top) + 'px',
      width: Math.round(rect.width) + 'px',
      height: Math.round(rect.height) + 'px',
      tab: currentTab
    });
  }

  function applyPanelState(panel) {
    if (!panel) return;
    var state = readPanelState();
    if (state.width) panel.style.width = state.width;
    if (state.height) panel.style.height = state.height;
    if (state.left || state.top) {
      panel.style.left = state.left || panel.style.left || '20px';
      panel.style.top = state.top || panel.style.top || '80px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }
    if (state.tab && document.getElementById('tab-' + state.tab)) currentTab = state.tab;
    if (panel.style.display !== 'none') {
      var rect = panel.getBoundingClientRect();
      if (rect.width && rect.height) {
        var pos = clampBoxToViewport(rect.width, rect.height, rect.left, rect.top);
        panel.style.left = Math.round(pos.left) + 'px';
        panel.style.top = Math.round(pos.top) + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
    }
  }

  function bindDrag(handle, target, options) {
    if (!handle || !target || handle.__worldEngineDragBound) return;
    handle.__worldEngineDragBound = true;
    options = options || {};
    var dragging = false;
    var start = null;
    var startRect = null;

    function begin(e) {
      if (dragging) return;
      if (e.button !== undefined && e.button !== 0) return;
      if (options.ignoreInteractive !== false && isInteractiveTarget(e.target)) return;
      start = getPoint(e);
      startRect = target.getBoundingClientRect();
      dragging = true;
      document.documentElement.classList.add('world-engine-dragging');
      if (options.prepare) options.prepare(target, startRect);
      if (e.cancelable) e.preventDefault();
      addMoveListeners();
    }

    function move(e) {
      if (!dragging) return;
      var p = getPoint(e);
      if (options.onMove) options.onMove(target, startRect, p.x - start.x, p.y - start.y);
      if (e.cancelable) e.preventDefault();
    }

    function end() {
      if (!dragging) return;
      dragging = false;
      document.documentElement.classList.remove('world-engine-dragging');
      removeMoveListeners();
      if (options.onEnd) options.onEnd(target);
    }

    function addMoveListeners() {
      document.addEventListener('mousemove', move, false);
      document.addEventListener('mouseup', end, false);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', end, false);
      document.addEventListener('touchcancel', end, false);
      document.addEventListener('pointermove', move, false);
      document.addEventListener('pointerup', end, false);
      document.addEventListener('pointercancel', end, false);
    }

    function removeMoveListeners() {
      document.removeEventListener('mousemove', move, false);
      document.removeEventListener('mouseup', end, false);
      document.removeEventListener('touchmove', move, false);
      document.removeEventListener('touchend', end, false);
      document.removeEventListener('touchcancel', end, false);
      document.removeEventListener('pointermove', move, false);
      document.removeEventListener('pointerup', end, false);
      document.removeEventListener('pointercancel', end, false);
    }

    handle.addEventListener('mousedown', begin, false);
    handle.addEventListener('touchstart', begin, { passive: false });
    handle.addEventListener('pointerdown', begin, false);
  }

  function enablePanelWindow(panel) {
    if (!panel || panel.__worldEngineWindowBound) return;
    panel.__worldEngineWindowBound = true;
    bindDrag(panel.querySelector('.hdr'), panel, {
      onMove: function(el, rect, dx, dy) {
        var pos = clampBoxToViewport(rect.width, rect.height, rect.left + dx, rect.top + dy);
        el.style.left = Math.round(pos.left) + 'px';
        el.style.top = Math.round(pos.top) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      },
      onEnd: savePanelGeometry
    });
  }

  function enablePanelResize(panel, handle) {
    bindDrag(handle, panel, {
      ignoreInteractive: false,
      onMove: function(el, rect, dx, dy) {
        var vp = viewport();
        var minW = Math.min(360, vp.w - 16);
        var minH = Math.min(300, vp.h - 16);
        var maxW = Math.max(minW, vp.w - rect.left - 8);
        var maxH = Math.max(minH, vp.h - rect.top - 8);
        el.style.width = Math.round(clamp(rect.width + dx, minW, maxW)) + 'px';
        el.style.height = Math.round(clamp(rect.height + dy, minH, maxH)) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      },
      onEnd: savePanelGeometry
    });
  }

  function makeDraggableModal(root, options) {
    if (!root || root.__worldEngineModalDragBound) return;
    options = options || {};
    var box = root.querySelector(options.boxSelector || '.world-engine-modal-box');
    var handle = root.querySelector(options.handleSelector || '.world-engine-modal-hdr');
    if (!box || !handle) return;
    root.__worldEngineModalDragBound = true;
    bindDrag(handle, box, {
      prepare: function(el, rect) {
        el.style.position = 'fixed';
        el.style.left = Math.round(rect.left) + 'px';
        el.style.top = Math.round(rect.top) + 'px';
        el.style.width = Math.round(rect.width) + 'px';
        el.style.margin = '0';
      },
      onMove: function(el, rect, dx, dy) {
        var pos = clampBoxToViewport(rect.width, rect.height, rect.left + dx, rect.top + dy);
        el.style.left = Math.round(pos.left) + 'px';
        el.style.top = Math.round(pos.top) + 'px';
      }
    });
  }

  function applyConfig(reason) {
    if (panelElement) applyPanelState(panelElement);
    refresh();
    logUi('config.apply', { reason: reason || 'ui' }, 'debug');
    return true;
  }

  function requestConfigApply(reason) {
    logUi('config.apply.request', { reason: reason || 'ui' });
    applyConfig(reason || 'ui');
    if (window.WORLD_ENGINE_RUNTIME && typeof window.WORLD_ENGINE_RUNTIME.scheduleConfigApply === 'function') {
      window.WORLD_ENGINE_RUNTIME.scheduleConfigApply(reason || 'ui');
    } else if (window.WORLD_ENGINE_RUNTIME && typeof window.WORLD_ENGINE_RUNTIME.applyConfig === 'function') {
      window.WORLD_ENGINE_RUNTIME.applyConfig(reason || 'ui');
    }
  }

  function activeChat() { try {
    var c = SillyTavern.getContext();
    return c && c.characterId != null;
  } catch(e) { return false; }}

  function toast(msg, err, dur) {
    var el = document.createElement('div');
    el.className = 'world-engine-toast' + (err ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function(){ el.remove(); }, dur || 3000);
  }

  function showPersistToast(msg, err) {
    var id = 'world-engine-persist-toast';
    var el = document.getElementById(id); if (el) el.remove();
    el = document.createElement('div');
    el.id = id;
    el.className = 'world-engine-toast' + (err ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    return el;
  }
  function removePersistToast() { var el = document.getElementById('world-engine-persist-toast'); if (el) el.remove(); }

  function recentMemories(state, limit) {
    return (state.memories || []).slice().sort(function(a,b){return b.round-a.round;}).slice(0, limit || 20);
  }

    function relativeTime(mem, state) {
    var diff = (state.round || 0) - (mem.round || 0);
    if (diff <= 0) return '\u521a\u521a';
    var mins = diff * 2;
    if (mins < 60) return mins + ' \u5206\u949f\u524d';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' \u5c0f\u65f6\u524d';
    var days = Math.floor(hours / 24);
    return days + ' \u5929\u524d';
  }

  function tagType(tag) {
    if (!tag) return 'ent';
    if (/^location:/.test(tag)) return 'loc';
    if (/^faction:/.test(tag)) return 'fac';
    if (/^(topic:|rumor:)/.test(tag)) return 'top';
    if (/^(emotion:)/.test(tag)) return 'emo';
    if (/^(event:|bloodfeud|state)/.test(tag)) return 'sta';
    return 'ent';
  }

  function tagHtml(tag) {
    var t = tagType(tag);
    var v = tag.indexOf(':') >= 0 ? tag.split(':')[1] : tag;
    return '<span class="tag tag-' + t + '">' + esc(v) + '</span>';
  }

  function tagsHtml(tags) {
    if (!tags || !tags.length) return '';
    return tags.map(function(t){ return tagHtml(t); }).join('');
  }

  /* ── timeline helpers ── */
  function eventType(desc) {
    if (!desc) return 'n';
    if (/\u2694|\u2620|\u6218|\u51b2|\u6740|\u5251/.test(desc)) return 'c';
    if (/\ud83d\udcac|\ud83d\udc8c|\u804a|\u8bf4/.test(desc)) return 'n';
    if (/\ud83c\udf0d|\ud83c\udfe0|\u4e16\u754c|\u57ce/.test(desc)) return 'w';
    if (/\ud83d\udcd6|\u6545\u4e8b|\u53d1\u73b0/.test(desc)) return 's';
    return 'n';
  }

  function tlIcon(desc) {
    if (!desc) return '\ud83d\udccc';
    if (/\u2694|\u6218|\u51b2|\u6740|\u5251/.test(desc)) return '\u2694\ufe0f';
    if (/\ud83d\udcac|\u804a|\u8bf4/.test(desc)) return '\ud83d\udcac';
    if (/\ud83c\udf0d|\u4e16\u754c|\u57ce/.test(desc)) return '\ud83c\udf0d';
    if (/\ud83d\udcd6|\u6545\u4e8b/.test(desc)) return '\ud83d\udcd6';
    if (/\ud83d\udca1|\u53d1\u73b0/.test(desc)) return '\ud83d\udca1';
    return '\ud83d\udccc';
  }

  /* ── v3.0.1: 半自动确认弹窗 ── */
  function showSemiAutoConfirmDialog(evolvePreviewText, onConfirm, onSkip) {
    var overlay = document.createElement('div');
    overlay.className = 'world-engine-modal-overlay';
    overlay.innerHTML = '<div class="world-engine-modal-box"><div class="world-engine-modal-hdr">⚠️ 半自动模式预览</div><div class="world-engine-modal-body"><p style="margin-bottom:8px;color:#8b949e;font-size:11px;">以下是本轮推演的预览结果，请确认是否执行：</p><div style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px;font-size:12px;color:#e6edf3;max-height:200px;overflow-y:auto;line-height:1.7;">'+esc(evolvePreviewText)+'</div></div><div class="world-engine-modal-actions"><button class="btn btn-success" id="world-engine-semi-confirm">✅ 确认执行</button><button class="btn" id="world-engine-semi-skip">⏭ 跳过此轮</button><button class="btn btn-danger" id="world-engine-semi-cancel">✖ 取消</button></div></div>';
    document.body.appendChild(overlay);
    makeDraggableModal(overlay);
    document.getElementById('world-engine-semi-confirm').addEventListener('click', function(){ overlay.remove(); if (onConfirm) onConfirm(); });
    document.getElementById('world-engine-semi-skip').addEventListener('click', function(){ overlay.remove(); if (onSkip) onSkip(); });
    document.getElementById('world-engine-semi-cancel').addEventListener('click', function(){ overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  /* ── v3.0.1: 通知历史 ── */
  var _notificationHistory = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_notification_history') || '[]');
  function addNotification(msg, err) {
    _notificationHistory.unshift({ msg: msg, err: !!err, time: Date.now() });
    if (_notificationHistory.length > 50) _notificationHistory = _notificationHistory.slice(0, 50);
    try { window.WORLD_ENGINE_STORAGE.setItem('world_engine_notification_history', JSON.stringify(_notificationHistory)); } catch(e) {}
  }
  function getNotificationHistory() { return _notificationHistory.slice(); }
  function showNotificationPanel() {
    var overlay = document.createElement('div');
    overlay.className = 'world-engine-modal-overlay';
    var items = _notificationHistory.slice(0, 30);
    var listHtml = items.length ? items.map(function(n) {
      var t = new Date(n.time).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
      return '<div style="padding:4px 0;border-bottom:1px solid #21262d;font-size:11px;"><span style="color:#8b949e;margin-right:6px;">'+t+'</span><span style="color:'+(n.err?'#f85149':'#e6edf3')+';">'+esc(n.msg)+'</span></div>';
    }).join('') : '<div style="padding:8px;color:#8b949e;font-size:11px;">暂无通知</div>';
    overlay.innerHTML = '<div class="world-engine-modal-box" style="max-width:420px;"><div class="world-engine-modal-hdr">🔔 通知历史 <span style="font-size:11px;color:#8b949e;font-weight:400;">最近 '+items.length+'条</span></div><div class="world-engine-modal-body" style="max-height:320px;overflow-y:auto;">'+listHtml+'</div><div class="world-engine-modal-actions"><button class="btn btn-sm" id="world-engine-notif-close" style="margin-left:auto;">✖ 关闭</button></div></div>';
    document.body.appendChild(overlay);
    makeDraggableModal(overlay);
    document.getElementById('world-engine-notif-close').addEventListener('click', function(){ overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  /* ── v3.0.1: 批量操作工具栏 ── */
  function renderBatchActionBar(containerId, onSelectAll, onBatchDelete, onBatchImportance) {
    var html = '<div class="world-engine-batch-bar" id="world-engine-batch-bar">';
    html += '<label class="tw" style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="world-engine-batch-select-all" style="accent-color:#238636;"><span class="sm" style="font-size:11px;">全选</span></label>';
    html += '<span class="sm gray" id="world-engine-batch-count">已选 0 条</span>';
    html += '<button class="btn btn-sm btn-danger" id="world-engine-batch-delete" disabled style="font-size:10px;padding:2px 8px;">🗑️ 批量删除</button>';
    if (onBatchImportance) html += '<button class="btn btn-sm" id="world-engine-batch-importance" disabled style="font-size:10px;padding:2px 8px;">🔥 标记重要性</button>';
    html += '</div>';
    var cont = document.getElementById(containerId);
    if (!cont) return;
    var existing = document.getElementById('world-engine-batch-bar');
    if (existing) existing.remove();
    cont.insertAdjacentHTML('afterbegin', html);
    setTimeout(function(){
      var selAll = document.getElementById('world-engine-batch-select-all');
      if (selAll) selAll.addEventListener('change', function(){
        var checked = this.checked;
        document.querySelectorAll('.world-engine-mem-select').forEach(function(cb) { cb.checked = checked; });
        if (onSelectAll) onSelectAll(checked);
        updateBatchCount();
      });
      document.getElementById('world-engine-batch-delete').addEventListener('click', function(){ if (onBatchDelete) onBatchDelete(); });
      if (onBatchImportance) document.getElementById('world-engine-batch-importance').addEventListener('click', function(){ if (onBatchImportance) onBatchImportance(); });
    }, 50);
  }
  function updateBatchCount() {
    var checked = document.querySelectorAll('.world-engine-mem-select:checked').length;
    var countEl = document.getElementById('world-engine-batch-count');
    var delBtn = document.getElementById('world-engine-batch-delete');
    var impBtn = document.getElementById('world-engine-batch-importance');
    if (countEl) countEl.textContent = '已选 '+checked+' 条';
    if (delBtn) delBtn.disabled = checked === 0;
    if (impBtn) impBtn.disabled = checked === 0;
  }

  /* ── v3.0.1: 成就排序 ── */
  function sortAchievements(list, sortBy) {
    if (sortBy === 'rarity') {
      list.sort(function(a,b){
        var ra = core.getAchievementRarity(core.ACHIEVEMENT_DEFS[a.id]);
        var rb = core.getAchievementRarity(core.ACHIEVEMENT_DEFS[b.id]);
        return rb - ra;
      });
    } else if (sortBy === 'name') {
      list.sort(function(a,b){ return (a.name||a.id).localeCompare(b.name||b.id); });
    } else if (sortBy === 'unlocked') {
      list.sort(function(a,b){
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
        return 0;
      });
    } else {
      list.sort(function(a,b){
        var oa = core.ACHIEVEMENT_DEFS[a.id] ? core.ACHIEVEMENT_DEFS[a.id].order || 999 : 999;
        var ob = core.ACHIEVEMENT_DEFS[b.id] ? core.ACHIEVEMENT_DEFS[b.id].order || 999 : 999;
        return oa - ob;
      });
    }
    return list;
  }

  /* ── v3.0.1: 搜索过滤 ── */
  function filterBySearch(list, query) {
    if (!query) return list;
    var q = query.toLowerCase();
    return list.filter(function(item){
      var name = (item.name || item.id || '').toLowerCase();
      var desc = (item.description || '').toLowerCase();
      return name.indexOf(q) >= 0 || desc.indexOf(q) >= 0;
    });
  }

  /* ── v3.0.1: Token 用量估算 ── */
  function estimateTokenUsage(state) {
    if (!state) return { used: 0, total: 4096, pct: 0 };
    var total = 4096;
    var used = 0;
    if (state.memories) used += state.memories.length * 35;
    if (state.events) used += state.events.length * 20;
    if (state.npcActivities) used += Object.keys(state.npcActivities).length * 15;
    if (state.factions) used += Object.keys(state.factions).length * 25;
    if (state.plotThreads) used += state.plotThreads.length * 40;
    if (state.portraits) used += Object.keys(state.portraits).length * 60;
    if (state.characterLifecycles) used += Object.keys(state.characterLifecycles).length * 20;
    if (state.rumors) used += state.rumors.length * 15;
    used = Math.min(used, total);
    var pct = Math.round((used / total) * 100);
    return { used: used, total: total, pct: pct };
  }

  /* ──────────────── BUILD UI ──────────────── */
  function buildUI() {
    logUi('build.start');
    if (document.getElementById('world-engine-panel')) return;
    var panel = document.createElement('div');
    panel.id = 'world-engine-panel';
    panel.className = 'world-engine-panel';
    panel.style.display = 'none';

    var ids = ['overview','achievements','world','memory','engine','story','worldbook','settings','help'];
    var icons = ['\ud83d\udcca','\ud83c\udfc6','\ud83c\udf0d','\ud83e\udde0','\u2699\ufe0f','\ud83d\udcd6','\ud83d\udcda','\ud83d\udd27','\u2753'];
    var labels = ['\u603b\u89c8','\u6210\u5c31','\u4e16\u754c','\u8bb0\u5fc6','\u5f15\u64ce','\u6545\u4e8b','\u4e16\u754c\u4e66','\u8bbe\u7f6e','\u5e2e\u52a9'];

    var html = '';
    // header
    html += '<div class="hdr"><h1>\u25c8 World Engine</h1><span class="v">v3.4.2</span><span class="hdr-info">\u6d3b\u4f53\u5f15\u64ce \u00b7 \u5168\u5458\u6295\u7968\u96c6\u6210\u7248</span><button class="btn btn-sm" id="world-engine-refresh-btn" style="margin-left:auto;">\ud83d\udd04</button><button class="btn btn-sm" id="world-engine-notif-bell" title="\u901a\u77e5\u5386\u53f2" style="font-size:14px;padding:2px 6px;margin-left:4px;">\ud83d\udd14</button><button class="hdr-close">\u2716</button></div>';
    // tab bar
    html += '<nav class="tab-bar">';
    for (var i = 0; i < ids.length; i++) {
      html += '<button class="tab-btn' + (i === 0 ? ' active' : '') + '" data-tab="' + ids[i] + '">' + icons[i] + ' ' + labels[i] + '</button>';
    }
    html += '</nav>';
    // content sections
    for (var i = 0; i < ids.length; i++) {
      html += '<section class="tab-content' + (i === 0 ? ' active' : '') + '" id="tab-' + ids[i] + '"></section>';
    }
    panel.innerHTML = html;
    /* \u2605 v3.0.1: \u62d6\u62fd\u7f29\u653e\u624b\u67c4 */
    (function(){
      var rh = document.createElement('div');
      rh.className = 'world-engine-resize-handle';
      panel.appendChild(rh);
      enablePanelResize(panel, rh);
    })();
    document.body.appendChild(panel);
    panelElement = panel;
    enablePanelWindow(panel);
    applyPanelState(panel);

    // events
    panel.addEventListener('click', function(e) {
      var btn = e.target.closest('.tab-btn');
      if (btn && btn.dataset.tab) { switchTab(btn.dataset.tab); return; }
      if (e.target.closest('.hdr-close')) { hidePanel(); return; }
      if (e.target.id === 'world-engine-refresh-btn') { refresh(); toast('\ud83d\udd04 \u5df2\u5237\u65b0'); return; }
      if (e.target.id === 'world-engine-notif-bell') { showNotificationPanel(); return; }
    });

    // add toggle button to input bar (wait for DOM if needed)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', addInputBarButton);
    } else {
      addInputBarButton();
    }

    panelVisible = false;
    refresh();

    /* ★ v3.1.3: 设备检测 — 防桌面端误触手机布局 */
    (function() {
      var dd = function() {
        var htm = document.documentElement;
        htm.classList.remove('world-engine-desktop', 'world-engine-mobile', 'world-engine-tablet');
        var hasMouse = matchMedia('(pointer: fine)').matches;
        var hasTouch = matchMedia('(pointer: coarse)').matches;
        var canHover = matchMedia('(hover: hover)').matches;
        if (hasMouse && !hasTouch) {
          htm.classList.add('world-engine-desktop');
        } else if (!hasMouse && hasTouch && !canHover) {
          htm.classList.add(screen.width < 600 ? 'world-engine-mobile' : 'world-engine-tablet');
        } else {
          htm.classList.add('world-engine-desktop');
        }
      };
      dd();
      window.addEventListener('resize', dd);
    })();
    logUi('build.done');
  }

  function addInputBarButton() {
    var existing = document.getElementById('world-engine-toggle-btn');
    if (existing) return;
    // SillyTavern send_form structure: #leftSendForm for extension buttons
    var bar = document.getElementById('leftSendForm') || document.getElementById('rightSendForm') || document.getElementById('send_form');
    if (!bar) {
      // fallback: try jQuery-like selectors
      bar = document.querySelector('#send_form .alignContentCenter, #form_sheld > div:first-child');
      if (!bar) return;
    }
    var btn = document.createElement('div');
    btn.id = 'world-engine-toggle-btn';
    btn.className = 'fa-solid fa-globe interactable';
    btn.style.cssText = 'display:flex;';
    btn.innerHTML = '';
    btn.title = '\u6253\u5f00 World Engine \u4e16\u754c\u9762\u677f';
    btn.addEventListener('click', function(e) { e.stopPropagation(); togglePanel(); });
    bar.appendChild(btn);
  }

  /* ──────────────── PANEL CONTROL ──────────────── */
  function togglePanel() {
    logUi('panel.toggle', { visible: !panelVisible }, 'debug');
    if (panelVisible) { hidePanel(); } else { showPanel(); }
  }
  function showPanel() {
    if (!panelElement) return;
    panelElement.style.display = 'flex';
    panelElement.classList.add('show');
    panelVisible = true;
    applyPanelState(panelElement);
    switchTab(currentTab);
    refresh();
    logUi('panel.show', { tab: currentTab }, 'debug');
  }
  function hidePanel() {
    if (!panelElement) return;
    panelElement.style.display = 'none';
    panelElement.classList.remove('show');
    panelVisible = false;
    savePanelGeometry(panelElement);
    logUi('panel.hide', { tab: currentTab }, 'debug');
  }
  function resetUI() {
    panelVisible = false;
    currentTab = 'overview';
    if (panelElement) panelElement.style.display = 'none';
    if (panelElement) panelElement.classList.remove('show');
  }

  function switchTab(tabId) {
    currentTab = tabId;
    savePanelStatePatch({ tab: currentTab });
    logUi('panel.tab', { tab: currentTab }, 'debug');
    if (!panelElement) return;
    panelElement.querySelectorAll('.tab-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.tab === tabId);
    });
    panelElement.querySelectorAll('.tab-content').forEach(function(t) {
      t.classList.remove('active');
    });
    var target = document.getElementById('tab-' + tabId);
    if (target) target.classList.add('active');
    refresh();
  }

  function refresh() {
    if (!panelElement || !panelVisible) return;
    var state = core.loadState();
    var target = document.getElementById('tab-' + currentTab);
    if (!target) return;

    switch (currentTab) {
      case 'overview': renderOverview(target, state); break;
      case 'achievements': renderAchievements(target, state); break;
      case 'world': renderWorld(target, state); break;
      case 'memory': renderMemory(target, state); break;
      case 'engine': renderEngine(target, state); break;
      case 'story': renderStory(target, state); break;
      case 'worldbook': renderWorldbook(target); break;
      case 'settings': renderSettings(target); break;
      case 'help': renderHelp(target, state); break;
    }
  }

  /* ═══════════════════ OVERVIEW ═══════════════════ */
  function renderOverview(cont, state) {
    if (!activeChat()) {
      cont.innerHTML = '<div class="guide-box"><div class="gt">\ud83d\udcca \u4e16\u754c\u603b\u89c8</div><div class="gd">\u8bf7\u5148\u9009\u62e9\u4e00\u4e2a\u89d2\u8272\u5f00\u59cb\u804a\u5929</div></div>';
      return;
    }
    var s = state;
    var r = s.round || 0;
    var emC = Object.keys(s.emotionMap || {}).length;
    var memC = (s.memories || []).length;
    var achC = (s.achievements && s.achievements.totalUnlocked) || 0;
    var rumC = (s.rumors || []).length;
    var evtC = (s.events || []).length;
    var facC = (s.factions || []).length;
    var comboC = s.combo || (s.combat && s.combat.combo) || 0;

    var timeStr = timeModule && typeof timeModule.formatWorldTime === 'function'
      ? timeModule.formatWorldTime(s.inWorldMinutes || 0)
      : (s.inWorldMinutes || 0) + '\u5206\u949f';

    var eco = s.economy || {};
    var storyDesc = s.worldDigest || '\u6682\u65e0\u6545\u4e8b\u6570\u636e';
    var storyTemplate = s.storyTemplate || s.storyArc || '\u82f1\u96c4\u4e4b\u65c5';
    var storyTone = s.storyTone || s.tone || '\u53f2\u8bd7\u58ee\u9614';

    var html = '';
    // guide
    html += '<div class="guide-box"><div class="gt">\ud83d\udcca \u4e16\u754c\u603b\u89c8</div><div class="gd">\u4e00\u952e\u67e5\u770b\u6545\u4e8b\u8fdb\u5ea6\u3001\u4e16\u754c\u6f14\u5316\u3001\u89d2\u8272\u7f81\u7eca\u3001\u6210\u5c31\u89e3\u9501\u3002\u6240\u6709\u6570\u636e\u81ea\u52a8\u540c\u6b65\u3002</div></div>';

    // core stats
    html += '<div class="card"><div class="card-title">\ud83d\udcc8 \u6838\u5fc3\u6307\u6807</div><div class="stats-grid">';
    html += '<div class="stat-item"><div class="v">'+r+'</div><div class="l">\u5f53\u524d\u8f6e\u6570</div></div>';
    html += '<div class="stat-item"><div class="v">'+emC+'</div><div class="l">\u6d3b\u8dc3\u89d2\u8272</div></div>';
    html += '<div class="stat-item"><div class="v">'+memC+'</div><div class="l">\u603b\u8bb0\u5fc6</div></div>';
    html += '<div class="stat-item"><div class="v">'+achC+'</div><div class="l">\u6210\u5c31\u89e3\u9501</div></div>';
    html += '<div class="stat-item"><div class="v">'+rumC+'</div><div class="l">\u5267\u60c5\u7ebf\u7d22</div></div>';
    html += '<div class="stat-item"><div class="v">'+evtC+'</div><div class="l">\u4e16\u754c\u4e8b\u4ef6</div></div>';
    html += '<div class="stat-item"><div class="v">'+facC+'</div><div class="l">\u52bf\u529b\u5173\u7cfb</div></div>';
    html += '<div class="stat-item"><div class="v">'+comboC+'</div><div class="l">\u8fde\u51fb</div></div>';
    html += '</div>';
    html += '<div class="fa mt-8" style="margin-top:-4px;"><button class="btn btn-success" id="world-engine-quick-evolve">\u26a1 \u5feb\u901f\u63a8\u6f14\u4e00\u8f6e</button><span class="sm gray" style="margin-left:8px;">\u4e0d\u7528\u5207\u9875\uff0c\u968f\u65f6\u89e6\u53d1<\/span><\/div><\/div>';

    // ★ v3.0.1: Token 用量
    var tok = (typeof estimateTokenUsage === 'function') ? estimateTokenUsage(state) : { used: 0, total: 4096, pct: 0 };
    html += '<div class="card"><div class="card-title">📊 Token 用量 <span class="bdg">资源监控</span></div>';
    html += '<div class="world-engine-token-bar"><span>已用 '+tok.used+' / '+tok.total+'</span><div class="world-engine-token-track"><div class="world-engine-token-fill" style="width:'+tok.pct+'%;"></div></div><span style="color:'+(tok.pct>80?'#f85149':tok.pct>50?'#d29922':'#7ee787')+'">'+tok.pct+'%</span></div>';
    html += '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;"><span class="sm gray">记忆: '+(state.memories?state.memories.length+'条':'0')+'</span><span class="sm gray">事件: '+(state.events?state.events.length+'个':'0')+'</span><span class="sm gray">NPC: '+(state.npcActivities?Object.keys(state.npcActivities).length+'名':'0')+'</span><span class="sm gray">势力: '+(state.factions?state.factions.length+'个':'0')+'</span><span class="sm gray">剧情线: '+(state.plotThreads?state.plotThreads.length:'0')+'</span></div></div>';

    // ★ v3.0.1: 注入预览
    html += '<div class="card"><div class="card-title">💉 完整注入预览 <span class="bdg">上下文构成</span></div>';
    html += '<div style="background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:8px;max-height:160px;overflow-y:auto;font-size:11px;color:#8b949e;line-height:1.6;white-space:pre-wrap;">';
    var injectParts = [];
    if (state.era) injectParts.push('[纪元] '+state.era);
    if (state.timeText || state.inWorldMinutes) injectParts.push('[时间] '+(state.timeText || (state.inWorldMinutes||0)+'分钟'));
    if (state.worldDescription) injectParts.push('[世界背景] '+state.worldDescription.substring(0,200));
    if (state.emotionMap) { var emKeys = Object.keys(state.emotionMap).slice(0,5); if(emKeys.length) injectParts.push('[活跃角色] '+emKeys.join(', ')+(Object.keys(state.emotionMap).length>5?'...':'')); }
    if (state.memories && state.memories.length) injectParts.push('[近期记忆] '+(state.memories.slice(-3).map(function(m){return m.summary||m.text||'';}).join(' | ')));
    if (state.eventLog && state.eventLog.length) injectParts.push('[最新事件] '+(state.eventLog.slice(-2).map(function(e){return e.desc||e.event||'';}).join(' | ')));
    html += esc(injectParts.join('\n\n')) || '（暂无可显示的注入内容）';
    html += '</div></div>';

    // -- computed overview variables --
    var eraText = s.era || '\u7eaa\u5143\u7eaa\u5e74';
    var timePeriod = '\u4e0a\u5348';
    var dayCycleEmoji = '\u2600\ufe0f';
    var season = '\u6625\u5b63';
    var dayCycle = '\u767d\u5929';
    var phaseIdx = (s.storyType && s.storyType.currentPhase) || 0;
    var totalPhases = 7;
    var nextPhaseText = '';
    var characterName = '';
    try { var ctx = SillyTavern.getContext(); if (ctx) characterName = ctx.name2 || ctx.charId || '\u6545\u4e8b\u4e3b\u89d2'; } catch(e) {}
    var legendText = (typeof core.getLegend === 'function') ? core.getLegend(s, characterName) : '';
    var storyPhase = (s.storyType && s.storyType.currentPhaseName) || s.storyPhase || '';
    if (s.inWorldMinutes !== undefined) {
      var totalMins = s.inWorldMinutes;
      var hour = Math.floor(totalMins / 60) % 24;
      var minute = totalMins % 60;
      timePeriod = hour < 6 ? '\u51cc\u6668' : hour < 12 ? '\u4e0a\u5348' : hour < 13 ? '\u4e2d\u5348' : hour < 18 ? '\u4e0b\u5348' : '\u591c\u665a';
      dayCycleEmoji = (hour >= 6 && hour < 18) ? '\u2600\ufe0f' : '\ud83c\udf19';
      dayCycle = (hour >= 6 && hour < 18) ? '\u767d\u5929' : '\u591c\u665a';
    }
    if (s.season) season = s.season;
    var tmpl = null;
    if (core.STORY_TEMPLATES && s.storyType && s.storyType.template) {
      for (var ti = 0; ti < core.STORY_TEMPLATES.length; ti++) {
        if (core.STORY_TEMPLATES[ti].id === s.storyType.template) { tmpl = core.STORY_TEMPLATES[ti]; break; }
      }
      if (tmpl) {
        totalPhases = tmpl.phases.length;
        nextPhaseText = (phaseIdx < totalPhases - 1) ? tmpl.phases[phaseIdx + 1] : '\u6700\u7ec8\u9636\u6bb5';
      }
    }

    // world time + recent evolution
    html += '<div class="card-row">';
    html += '<div class="card" style="flex:1;"><div class="card-title">\u23f0 \u4e16\u754c\u65f6\u95f4</div>';
    html += '<div style="text-align:center;padding:8px;"><div style="font-size:26px;font-weight:700;color:#f0c040;">'+esc(timeStr)+'</div>';
    html += '<div style="font-size:12px;color:#8b949e;margin-top:2px;">'+esc(eraText)+' \u00b7 '+esc(timePeriod)+' '+dayCycleEmoji+'</div>';
    html += '<div style="margin-top:6px;display:flex;justify-content:center;gap:6px;"><span class="tag tag-ent">\u5b63\u8282\uff1a'+esc(season)+'</span><span class="tag tag-top">\u663c\u591c\uff1a'+esc(dayCycle)+'</span></div></div></div>';

    html += '<div class="card" style="flex:1;"><div class="card-title">\ud83e\uddec \u6700\u8fd1\u6f14\u5316</div>';
    var evLog = s.eventLog || [];
    if (evLog.length > 0) {
      for (var ei = Math.max(0, evLog.length-2); ei < evLog.length; ei++) {
        var ev = evLog[ei];
        var evDesc = ev.desc || ev.event || ev.message || '';
        var evRound = ev.round || ev.currentRound || '?';
        html += '<div class="tl-i"><div class="rnd">#'+evRound+'</div><div class="txt">'+tlIcon(evDesc)+' '+esc(evDesc)+'</div></div>';
      }
    } else {
      html += '<div class="tl-i"><div class="txt">\u6682\u65e0\u6f14\u5316\u8bb0\u5f55</div></div>';
    }
    html += '</div></div>';

    // story
    html += '<div class="card"><div class="card-title">\ud83d\udcd6 \u5f53\u524d\u6545\u4e8b <span class="bdg">'+esc(storyTemplate)+' \u00b7 \u7b2c '+(phaseIdx+1)+'/'+totalPhases+' \u9636\u6bb5</span></div>';
    html += '<div class="flex" style="gap:16px;"><div><span class="sm gray">\u6a21\u677f\uff1a</span><span>'+esc(storyTemplate)+'</span></div>';
    html += '<div><span class="sm gray">\u57fa\u8c03\uff1a</span><span>'+esc(storyTone)+'</span></div>';
    html += '<div><span class="sm gray">\u5f53\u524d\u9636\u6bb5\uff1a</span><span>'+esc(storyPhase)+'</span></div>';
    html += '<div><span class="sm gray">'+(nextPhaseText ? '\u4e0b\u4e00\u9636\u6bb5\uff1a'+esc(nextPhaseText) : '')+'</span></div></div>';
    html += '<div class="mt-8" style="background:#0d1117;border-radius:6px;padding:8px;border:1px solid #21262d;font-size:12px;color:#e6edf3;line-height:1.6;">\u300e'+esc(storyDesc)+'\u300f</div></div>';

    // timeline
    html += '<div class="card"><div class="card-title">\ud83d\udcdc \u4e16\u754c\u4e8b\u4ef6\u65f6\u95f4\u8f74 <span class="bdg">\u6700\u65b0 5 \u6761</span></div><div class="tl">';
    var logs = evLog.slice().sort(function(a,b){return (b.round||0)-(a.round||0);}).slice(0,5);
    if (logs.length) {
      for (var li = 0; li < logs.length; li++) {
        var l = logs[li];
        var d = l.desc || l.event || l.message || '';
        var cls = 'tl-'+eventType(d);
        html += '<div class="tl-i '+cls+'"><div class="rnd">#'+(l.round||l.currentRound||'?')+'</div><div class="txt">'+tlIcon(d)+' '+esc(d)+'</div></div>';
      }
    } else {
      html += '<div class="sm gray">\u6682\u65e0\u4e8b\u4ef6</div>';
    }
    html += '</div></div>';

    // \u4e2a\u4eba\u4f20\u5947
    html += '<div class="card"><div class="card-title">\ud83c\udfc5 \u4e2a\u4eba\u4f20\u5947</div>';
    html += '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:8px;padding:12px;border:1px solid #30363d;">';
    html += '<p style="font-size:12.5px;color:#e6edf3;line-height:1.8;font-style:italic;">\u300c'+(legendText ? esc(legendText) : '\u6682\u65e0\u4f20\u5947\u53d9\u4e8b\uff0c\u8ba9\u6545\u4e8b\u7ee7\u7eed\u53d1\u5c55...')+'\u300d</p></div></div>';

    // achievements echo
    html += '<div class="card"><div class="card-title">\ud83d\udd0a \u6210\u5c31\u56de\u54cd <span class="bdg">\u6700\u65b0 3 \u6761</span></div><div class="echo-l">';
    var echoes = (typeof core.getAchievementEchoes === 'function') ? core.getAchievementEchoes(s, 3) : [];
    if (echoes.length) {
      for (var echi = 0; echi < echoes.length; echi++) {
        html += '<div class="echo-i">\ud83c\udfc6 <span class="gold">'+esc(echoes[echi].name)+'</span> <span class="gray">| #'+(echoes[echi].round||'?')+'</span></div>';
      }
    } else {
      html += '<div class="echo-i">\u6682\u65e0\u6210\u5c31\u56de\u54cd</div>';
    }
    html += '</div></div>';

    // world description editor
    html += '<div class="card"><div class="card-title">\ud83d\udcdd \u4e16\u754c\u7b80\u8ff0</div>';
    html += '<div id="world-engine-wdesc-display-ov" style="background:#0d1117;border-radius:6px;padding:8px;border:1px solid #21262d;font-size:11px;color:#e6edf3;line-height:1.6;">';
    html += '<div>'+(s.worldDescription ? esc(s.worldDescription) : '<span class="gray">(\u6682\u65e0\u7b80\u8ff0)</span>')+'</div></div>';
    html += '<div class="flex mt-8"><button class="btn btn-sm" id="world-engine-wdesc-edit-ov">\u270f\ufe0f \u7f16\u8f91\u4e16\u754c\u7b80\u8ff0</button>';
    html += '<button class="btn btn-sm btn-primary" id="world-engine-wdesc-save-ov" style="display:none">\ud83d\udcbe \u4fdd\u5b58</button></div>';
    html += '<textarea id="world-engine-wdesc-editor-ov" style="display:none;width:100%;min-height:50px;padding:6px;border-radius:6px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;font-size:11px;resize:vertical;box-sizing:border-box;margin-top:4px">'+esc(s.worldDescription||'')+'</textarea></div>';

    // injection preview
    var inj = s.lastInjection;
    html += '<div class="card"><div class="card-title">\ud83d\udc89 \u6ce8\u5165\u9884\u89c8 <span class="bdg">'+(inj?'\u6210\u529f\u6ce8\u5165 1 \u6761':'\u6682\u65e0\u6ce8\u5165')+'</span></div>';
    html += '<div style="background:#0d1117;border-radius:6px;padding:10px;border:1px solid #21262d;">';
    if (inj) {
      html += '<div class="sm gray">\u98ce\u683c\uff1a'+esc(inj.style||'\u6c89\u6d78\u5f0f')+' \u00b7 Token \u9884\u7b97\uff1a'+(inj.budget||4096)+' \u00b7 \u4f18\u5148\u7ea7\uff1a'+esc(inj.priority||'\u4e8b\u4ef6 > \u60c5\u611f > \u8bb0\u5fc6')+'</div>';
      html += '<div class="sm gray mt-8">\u4e0a\u6b21\u6ce8\u5165\uff1a\u7b2c '+(inj.round||s.round||'?')+' \u8f6e \u00b7 '+esc(inj.summary||'')+'</div>';
    } else {
      html += '<div class="sm gray">\u6682\u65e0\u6ce8\u5165\u8bb0\u5f55</div>';
    }
    html += '</div></div>';

    // NPC Activities
    var npcLog = s.npcActivityLog || [];
    html += '<div class="card"><div class="card-title">\ud83d\udc64 NPC \u52a8\u6001 <span class="bdg">\u6700\u8fd1\u6d3b\u52a8</span></div>';
    if (npcLog.length) {
      html += '<div class="tl">';
      var nshown = 0;
      for (var ni = npcLog.length - 1; ni >= 0 && nshown < 6; ni--) {
        var n = npcLog[ni];
        if (!n || !n.npc) continue;
        nshown++;
        html += '<div class="tl-i"><div class="rnd">#' + (n.round || '?') + '</div><div class="txt">' + esc(n.npc) + '\uff1a' + esc(n.activity || '') + (n.location ? '\uff08' + esc(n.location) + '\uff09' : '') + '</div></div>';
      }
      html += '</div>';
    } else {
      html += '<div class="sm gray">\u6682\u65e0NPC\u6d3b\u52a8\u8bb0\u5f55</div>';
    }
    html += '</div>';

    // bond tree
    html += '<div class="card"><div class="card-title">\ud83d\udd17 \u7f81\u7eca\u4e4b\u6811 <span class="bdg">\u89d2\u8272\u5173\u7cfb\u7f51\u7edc</span></div>';
    html += '<div class="bond-box"><div style="text-align:center;">';
    var emNames = Object.keys(s.emotionMap || {});
    if (emNames.length > 0) {
      html += '<div style="font-size:12px;color:#8b949e;margin-bottom:8px;">\u5173\u7cfb\u7f51\u7edc\u53ef\u89c6\u5316</div>';
      html += '<div class="flex" style="justify-content:center;gap:6px;">';
      for (var bni = 0; bni < Math.min(emNames.length, 8); bni++) {
        var clr = '#8b949e'; var at = s.emotionMap[emNames[bni]];
        if (at) {
          var att = parseInt(at.attitude) || 0;
          clr = att > 3 ? '#7ee787' : att < -3 ? '#f85149' : att > 0 ? '#f0c040' : '#8b949e';
        }
        var bondEmoji = clr === '#7ee787' ? '\ud83d\udfe2' : clr === '#f85149' ? '\ud83d\udd34' : clr === '#f0c040' ? '\ud83d\udfe1' : clr === '#58a6ff' ? '\ud83d\udd35' : '\u26aa';
        html += '<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:'+clr+';">'+bondEmoji+' '+esc(emNames[bni])+'</span>';
      }
      html += '</div><div style="font-size:10px;color:#484f58;margin-top:6px;">\ud83d\udfe2\u2014\u53cb\u597d | \ud83d\udd34\u2014\u654c\u5bf9 | \u26aa\u2014\u4e2d\u7acb</div>';
    } else {
      html += '<div style="font-size:12px;color:#8b949e;">\u6682\u65e0\u7f81\u7eca\u6570\u636e</div>';
    }
    html += '</div></div></div>';

    cont.innerHTML = html;

    // bind world desc editor in overview
    setTimeout(function(){
      var edBtn = document.getElementById('world-engine-wdesc-edit-ov');
      var svBtn = document.getElementById('world-engine-wdesc-save-ov');
      var ed = document.getElementById('world-engine-wdesc-editor-ov');
      if (!edBtn || !svBtn || !ed) return;
      edBtn.addEventListener('click', function(){
        ed.style.display = 'block'; edBtn.style.display = 'none'; svBtn.style.display = 'inline-block'; ed.focus();
      });
      svBtn.addEventListener('click', function(){
        var v = ed.value.trim();
        var st = core.loadState();
        st.worldDescription = v;
        core.saveState(st);
        ed.style.display = 'none'; edBtn.style.display = 'inline-block'; svBtn.style.display = 'none';
        toast('\u2705 \u4e16\u754c\u7b80\u8ff0\u5df2\u4fdd\u5b58');
        requestConfigApply('world-description');
      });
      // quick evolve button
      var qeBtn = document.getElementById('world-engine-quick-evolve');
      if (qeBtn) {
        qeBtn.addEventListener('click', async function(){
          if (!evolution || typeof evolution.evolve !== 'function') { toast('\u26a0\ufe0f \u6f14\u5316\u6a21\u5757\u672a\u52a0\u8f7d', true); return; }
          this.disabled = true; this.innerHTML = '\u23f3 \u63a8\u6f14\u4e2d...';
          try {
            var st = core.loadState();
            var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
            var lastMsg = ctx && ctx.chat ? ctx.chat[ctx.chat.length - 1] : null;
            var userMsg = lastMsg && lastMsg.is_user ? (lastMsg.mes||'') : '';
            var aiMsg = lastMsg && !lastMsg.is_user ? (lastMsg.mes||'') : '';
            var success = await evolution.evolve(st, userMsg, aiMsg);
            toast(success ? '\u2705 \u5feb\u901f\u63a8\u6f14\u5b8c\u6210' : '\u26a0\ufe0f \u63a8\u6f14\u5931\u8d25', !success);
            if (success) refresh();
          } catch(e) {
            toast('\u63a8\u6f14\u5f02\u5e38: '+e.message, true);
          }
          this.disabled = false; this.innerHTML = '\u26a1 \u5feb\u901f\u63a8\u6f14\u4e00\u8f6e';
        });
      }
    }, 50);
  }

  /* ═══════════════════ ACHIEVEMENTS ═══════════════════ */
  function renderAchievements(cont, state) {
    var ach = state.achievements || {};
    var unlocked = ach.unlocked || {};
    var totalUnlocked = ach.totalUnlocked || Object.keys(unlocked).length;
    var allDefs = (typeof core.ACHIEVEMENT_DEFS === 'object' && core.ACHIEVEMENT_DEFS) ? core.ACHIEVEMENT_DEFS : {};
    var allKeys = Object.keys(allDefs);
    var totalDefs = Math.max(allKeys.length, totalUnlocked + 10, 86);
    var showHidden = state.achievements && state.achievements.showNSFW === true;
    var autoGen = ach.autoGenEnabled !== false;

    var html = '';
    html += '<div class="guide-box"><div class="gt">\ud83c\udfc6 \u6210\u5c31\u7cfb\u7edf</div><div class="gd">AI \u6839\u636e\u6545\u4e8b\u8d70\u5411\u81ea\u52a8\u5224\u5b9a\u6210\u5c31\u89e3\u9501 \u2014\u2014 \u4e0d\u662f\u9760\u8f6e\u8be2\uff0c\u505a\u4e86\u5c31\u6709\uff01\u6bcf\u8f6e\u6f14\u5316\u7ed3\u679c\u81ea\u52a8\u89e3\u6790\u6210\u5c31 JSON\u3002</div></div>';

    // save bar
        // \u7a00\u6709\u5ea6\u5206\u5e03\u7edf\u8ba1
    var rarityCounts = {1:0,2:0,3:0,4:0,5:0};
    for (var ak2 in allDefs) {
      var def2 = allDefs[ak2];
      var r2 = def2.rarity || 1;
      rarityCounts[r2] = (rarityCounts[r2]||0) + 1;
    }
    var starLabels = ['','\u2605','\u2605\u2605','\u2605\u2605\u2605','\u2605\u2605\u2605\u2605','\u2605\u2605\u2605\u2605\u2605'];
    html += '<div class="save-bar"><div class="hint"><b>\u6210\u5c31\u8fdb\u5ea6</b><span style="margin-left:10px;">'+totalUnlocked+' / '+totalDefs+' \u89e3\u9501</span>';
    for (var ri2 = 1; ri2 <= 4; ri2++) {
      html += '<span style="margin-left:10px;">'+starLabels[ri2]+' '+rarityCounts[ri2]+'</span>';
    }
    html += '</div>';
    html += '<div class="flex"><span class="tw"><label class="tg"><input type="checkbox" id="world-engine-ach-show-hidden" '+(showHidden?'checked':'')+'><span class="s"></span></label><span class="sm gray">\u663e\u793a\u9690\u85cf</span></span>';
    html += '<span class="tw"><label class="tg"><input type="checkbox" id="world-engine-ach-auto-gen" '+(autoGen?'checked':'')+'><span class="s"></span></label><span class="sm gray">AI \u81ea\u52a8\u751f\u6210</span></span></div></div>';

    // milestones (dynamic from actual achievements)
    html += '<div class="card"><div class="card-title">\ud83d\uddfa\ufe0f \u91cc\u7a0b\u7891\u4e4b\u8def <span class="bdg">\u8ff7\u96fe\u4e2d\u85cf\u7740\u672a\u77e5\u6210\u5c31</span></div><div class="m-grid">';
    var milestoneKeys = Object.keys(allDefs).slice(0, 15);
    while (milestoneKeys.length < 15) { milestoneKeys.push(''); }
    for (var mi = 0; mi < milestoneKeys.length; mi++) {
      var mKey = milestoneKeys[mi];
      var mDef = mKey ? allDefs[mKey] : null;
      var isUnlocked = mKey ? !!unlocked[mKey] : false;
      var isRevealed = mKey && !isUnlocked && (unlocked[mKey] !== undefined);
      var mLabel = mDef ? (mDef.title || mDef.label || mDef.id || mKey) : '';
      var mStatus = isUnlocked ? 'unlocked' : (isRevealed ? 'revealed' : 'locked');
      var display = mStatus === 'locked' ? '\ud83c\udf2b' : mStatus === 'revealed' ? '\u2753' : '\ud83c\udfc6';
      html += '<div class="c '+mStatus+'" title="'+esc(mLabel||'\u672a\u77e5')+'">'+display;
      if (mLabel && mLabel.length <= 4) html += '<br>'+esc(mLabel);
      else if (mLabel) html += '<br>'+esc(mLabel.substring(0,4));
      html += '</div>';
    }
    html += '</div><div class="flex mt-8" style="justify-content:center;gap:20px;">';
    html += '<span class="sm gray">\ud83c\udfc6 \u5df2\u89e3\u9501</span>';
    html += '<span class="sm gray">\u2753 \u5df2\u63ed\u793a</span>';
    html += '<span class="sm gray">\ud83c\udf2b \u8ff7\u96fe\u672a\u77e5</span>';
    html += '</div></div>';

    // achievement cards
    html += '<div class="card"><div class="flex-sb"><div class="card-title">\ud83c\udfc5 \u6210\u5c31\u5217\u8868</div>';
    html += '<div class="flex"><select id="world-engine-ach-sort" style="padding:4px 8px;background:#21262d;border:1px solid #30363d;border-radius:4px;color:#e6edf3;font-size:11px;margin-right:4px;"><option value="order">\u9ed8\u8ba4</option><option value="rarity">\u7a00\u6709\u5ea6</option><option value="name">\u540d\u79f0</option><option value="unlocked">\u89e3\u9501\u72b6\u6001</option></select><select id="world-engine-ach-filter" style="padding:4px 8px;background:#21262d;border:1px solid #30363d;border-radius:4px;color:#e6edf3;font-size:11px;"><option>\u5168\u90e8</option><option>\u5df2\u89e3\u9501</option><option>\u672a\u89e3\u9501</option><option>\u5df2\u63ed\u793a</option><option>\u751f\u5b58</option><option>\u6218\u6597</option><option>\u4eb2\u5bc6</option><option>\u5947\u8469</option><option>\u63a2\u7d22</option><option>\u793e\u4ea4</option><option>\u6545\u4e8b</option><option>\u6210\u957f</option><option>\u4e16\u754c</option><option>\u5143</option><option>\u9690\u85cf</option></select>';
    html += '<input type="text" id="world-engine-ach-search" placeholder="\u641c\u7d22\u6210\u5c31..." style="padding:4px 8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;color:#e6edf3;font-size:11px;width:120px;"></div></div>';
    html += '<div class="ach-grid" id="world-engine-ach-grid">';

    var TYPE_ICONS = {survival:'\ud83d\udee1\ufe0f',combat:'\u2694\ufe0f',intimate:'\ud83d\udc95',quirky:'\ud83e\udd23',exploration:'\ud83d\uddfa\ufe0f',social:'\u00f0\u0178\u00a4\u0178',story:'\ud83d\udcd6',growth:'\ud83c\udf31',world:'\ud83c\udf0d',meta:'\ud83c\udfae'};
    var RARITY_KEYS = {1:'rk-c',2:'rk-r',3:'rk-e',4:'rk-l',5:'rk-h'};
    var RARITY_STARS = {1:'\u2605',2:'\u2605\u2605',3:'\u2605\u2605\u2605',4:'\u2605\u2605\u2605\u2605',5:'\u2605\u2605\u2605\u2605\u2605'};

    var shown = 0;
    for (var ak in allDefs) {
      var def = allDefs[ak];
      var isUnlocked = !!unlocked[ak];
      var label = def.title || def.label || ak;
      var desc = def.desc || def.description || '';
      var type = def.type || 'story';
      var rarity = def.rarity || 1;
      var icon = TYPE_ICONS[type] || '\ud83c\udfc6';
      var rkClass = RARITY_KEYS[rarity] || 'rk-c';
      var stars = RARITY_STARS[rarity] || '\u2605';
      var isNSFW = !!def.nsfw;
      var achProg = (typeof core.getAchievementProgress === 'function') ? core.getAchievementProgress(state, ak) : null;
      html += '<div class="ach-card '+(isUnlocked?'unlocked':'locked')+'" data-ach-id="'+esc(ak)+'" data-ach-type="'+esc(type)+'" data-ach-nsfw="'+(isNSFW?'1':'0')+'">';
      html += '<div class="ic">'+icon+'</div>';
      html += '<div class="nm">'+esc(label)+'</div>';
      html += '<div class="dc">'+esc(desc)+'</div>';
      if (achProg && achProg.max > 1 && !isUnlocked) {
        var pct = achProg.pct;
        var barColor = pct < 30 ? '#f85149' : pct < 70 ? '#d29922' : '#238636';
        html += '<div class="world-engine-ach-progress"><div class="world-engine-ach-progress-bar" style="width:'+pct+'%;background:'+barColor+'"></div></div>';
        html += '<div class="world-engine-progress-text">'+achProg.current+' / '+achProg.max+'</div>';
      }
      if (!isUnlocked && typeof core.unlockAchievement === 'function') {
        html += '<button class="btn btn-sm world-engine-ach-unlock-btn" data-ach-id="'+esc(ak)+'" style="font-size:9px;padding:1px 6px;margin-top:4px;">\ud83d\udd13 \u624b\u52a8\u89e3\u9501</button>';
      }
      html += '<div class="rk '+rkClass+'">'+stars+'</div></div>';
      shown++;
    }
    if (shown === 0) {
      html += '<div class="sm gray" style="grid-column:1/-1;text-align:center;padding:20px;">\u6682\u65e0\u6210\u5c31\u5b9a\u4e49</div>';
    }
    html += '</div></div>';

    // combo
    html += '<div class="card-row">';
    html += '<div class="card" style="flex:1;"><div class="card-title">\ud83d\udd25 \u6210\u5c31\u8fde\u51fb</div>';
    html += '<div class="flex"><div style="font-size:28px;font-weight:700;color:#f0c040;">'+(state.combo||0)+'</div>';
    // \u8fde\u51fb\u5fbd\u7ae0\u67e5\u627e
    var comboBadges = {0:'',1:'',2:'\u53cc\u54cd\u70ae',3:'\u4e09\u8fde\u6740',4:'\u56db\u91cd\u594f',5:'\u4e94\u661f\u8fde\u73e0',6:'\u516d\u5408',7:'\u4e03\u661f',8:'\u516b\u65b9\u6765\u671d',9:'\u4e5d\u4e5d\u5f52\u4e00',10:'\u5341\u5168\u5341\u7f8e'};
    var comboNum = state.combo || 0;
    var badgeName = comboBadges[comboNum] || (comboNum > 10 ? '\u8d85\u51e1\u5165\u5723' : '');
    html += '<div><div class="sm gray">\u5f53\u524d\u8fde\u51fb\uff1a<span class="gold">'+(state.combo||0)+' \u8fde</span></div>';
    html += '<div class="sm gray">\u6700\u9ad8\u7eaa\u5f55\uff1a<span class="gold">'+(state.comboHistory&&state.comboHistory.length?state.comboHistory.reduce(function(a,b){return Math.max(a,b.combo||0);},0):0)+' \u8fde</span></div>';
    if (badgeName) html += '<div class="sm gray">\u5fbd\u7ae0\uff1a<span class="gold">'+badgeName+'</span></div>';
    html += '</div></div></div>';

    html += '<div class="card" style="flex:1;"><div class="card-title">\ud83d\udd0a \u6210\u5c31\u56de\u54cd <span class="bdg">\u6ce8\u5165\u4e0a\u4e0b\u6587</span></div>';
    html += '<div class="sm gray">\u89e3\u9501\u6210\u5c31\u540e\u81ea\u52a8\u6ce8\u5165 AI \u4e0a\u4e0b\u6587\uff0c\u5f71\u54cd\u6545\u4e8b\u8d70\u5411</div>';
    html += '<div class="echo-l mt-8">';
    var echoes = (typeof core.getAchievementEchoes === 'function') ? core.getAchievementEchoes(state, 3) : [];
    if (echoes.length) {
      for (var echi2 = 0; echi2 < echoes.length; echi2++) {
        html += '<div class="echo-i">\ud83c\udfc6 '+esc(echoes[echi2].name)+' <span class="gray">#'+(echoes[echi2].round||'?')+'</span></div>';
      }
    } else {
      html += '<div class="echo-i">\u6682\u65e0</div>';
    }
    html += '</div></div></div>';

    cont.innerHTML = html;

    // bind ach events
    setTimeout(function(){
      var showCb = document.getElementById('world-engine-ach-show-hidden');
      var genCb = document.getElementById('world-engine-ach-auto-gen');
      if (showCb) showCb.addEventListener('change', function(){
          var st = core.loadState();
          if (!st.achievements) st.achievements = {};
          st.achievements.showNSFW = this.checked;
          core.saveState(st);
          toast('\u663e\u793a NSFW \u6210\u5c31: '+(this.checked?'\u5f00':'\u5173'));
          refresh();
      });
      if (genCb) genCb.addEventListener('change', function(){ var st=core.loadState(); if(!st.achievements)st.achievements={}; st.achievements.autoGenEnabled=this.checked; core.saveState(st); });
      // \u6210\u5c31\u7b5b\u9009
      var achFilter = document.getElementById('world-engine-ach-filter');
      if (achFilter) achFilter.addEventListener('change', function(){
        var v = this.value;
        document.querySelectorAll('#world-engine-ach-grid .ach-card').forEach(function(c){
          c.style.display = 'block';
          if (v === '\u5df2\u89e3\u9501' && !c.classList.contains('unlocked')) c.style.display = 'none';
          else if (v === '\u672a\u89e3\u9501' && c.classList.contains('unlocked')) c.style.display = 'none';
          else if (v === '\u5df2\u63ed\u793a' && (!c.classList.contains('revealed'))) c.style.display = 'none';
          // NSFW filter: when showNSFW is off, hide NSFW cards regardless of other filters
          var showNsfw = document.getElementById('world-engine-ach-show-hidden');
          if (showNsfw && !showNsfw.checked) {
            var isNsfw = c.getAttribute('data-ach-nsfw');
            if (isNsfw === '1') { c.style.display = 'none'; }
          }
          if (c.style.display !== 'none' && ['survival','combat','intimate','quirky','exploration','social','story','growth','world','meta','hidden'].indexOf(v) >= 0) {
            var cardType = c.getAttribute('data-ach-type') || '';
            c.style.display = cardType === v ? 'block' : 'none';
          }
        });
      });
      // \u2605 v3.0.1: \u6210\u5c31\u6392\u5e8f
      var achSort = document.getElementById('world-engine-ach-sort');
      if (achSort) achSort.addEventListener('change', function(){
        var v = this.value;
        try { window.WORLD_ENGINE_STORAGE.setItem('world_engine_ach_sort', v); } catch(e){}
        // re-render with sorted order
        refresh();
      });
      // \u2605 v3.0.1: \u624b\u52a8\u89e3\u9501\u6309\u94ae
      document.querySelectorAll('.world-engine-ach-unlock-btn').forEach(function(btn){
        btn.addEventListener('click', function(){
          var achId = this.getAttribute('data-ach-id');
          if (!achId || !confirm('\u786e\u5b9a\u624b\u52a8\u89e3\u9501\u6210\u5c31\u201c'+achId+'\u201d\uff1f')) return;
          var st = core.loadState();
          core.unlockAchievement(st, achId);
          core.saveState(st);
          toast('\u2705 \u6210\u5c31\u5df2\u89e3\u9501: '+achId);
          refresh();
        });
      });
      // \u6210\u5c31\u641c\u7d22
      var achSearch = document.getElementById('world-engine-ach-search');
      if (achSearch) achSearch.addEventListener('input', function(){
        var kw = this.value.trim().toLowerCase();
        document.querySelectorAll('#world-engine-ach-grid .ach-card').forEach(function(c){
          if (!kw) { c.style.display = 'block'; } else {
            var nm = (c.querySelector('.nm')||{}).textContent||'';
            c.style.display = nm.toLowerCase().indexOf(kw) >= 0 ? 'block' : 'none';
          }
          // re-apply NSFW filter
          if (c.style.display !== 'none') {
            var nsfwEl = document.getElementById('world-engine-ach-show-hidden');
            if (nsfwEl && !nsfwEl.checked && c.getAttribute('data-ach-nsfw') === '1') c.style.display = 'none';
          }
        });
      });
      // \u91cc\u7a0b\u7891\u70b9\u51fb
      document.querySelectorAll('.m-grid .c').forEach(function(c){
        c.addEventListener('click', function(){
          var s = this.classList.contains('unlocked') ? '\u89e3\u9501' : this.classList.contains('revealed') ? '\u5df2\u63ed\u793a' : '\u672a\u77e5';
          toast('\ud83d\udccd ' + (this.title||'\u672a\u547d\u540d') + ' \u2014 ' + s);
        });
      });
      // apply initial NSFW filter
      var nsfwInit = document.getElementById('world-engine-ach-show-hidden');
      if (nsfwInit && !nsfwInit.checked) {
        document.querySelectorAll('#world-engine-ach-grid .ach-card').forEach(function(c){
          if (c.getAttribute('data-ach-nsfw') === '1') c.style.display = 'none';
        });
      }
    }, 50);
  }

  /* ═══════════════════ WORLD ═══════════════════ */
  function renderWorld(cont, state) {
    if (!activeChat()) {
      cont.innerHTML = '<div class="guide-box"><div class="gt">\ud83c\udf0d \u4e16\u754c\u7ba1\u7406</div><div class="gd">\u8bf7\u5148\u9009\u62e9\u4e00\u4e2a\u89d2\u8272\u5f00\u59cb\u804a\u5929</div></div>';
      return;
    }

    var lifecycles = state.characterLifecycles || {};
    var lcColors = {ALIVE:'#1a3a2a',DYING:'#3a3a1a',DEAD:'#3a1a1a',REINCARNATED:'#2a1a3a',REBORN:'#2a1a3a',DORMANT:'#1a2a3a'};
    var lcTxts = {ALIVE:'#7ee787',DYING:'#d29922',DEAD:'#f85149',REINCARNATED:'#bc8cff',REBORN:'#bc8cff',DORMANT:'#58a6ff'};

    var html = '';
    html += '<div class="guide-box"><div class="gt">\ud83c\udf0d \u4e16\u754c\u7ba1\u7406</div><div class="gd">\u89d2\u8272\u3001\u52bf\u529b\u3001\u58f0\u8a89\u3001\u7ecf\u6d4e \u2014 \u4e16\u754c\u72b6\u6001\u4e00\u76ee\u4e86\u7136\u3002\u60c5\u611f\u72b6\u6001\u673a (8\u6001) + \u751f\u547d\u5468\u671f (5\u6001) \u81ea\u52a8\u6f14\u5316\u3002</div></div>';

    // characters
    var emEntries = Object.entries(state.emotionMap || {});
    html += '<div class="card"><div class="card-title">\ud83d\udc65 \u89d2\u8272 & \u60c5\u611f\u72b6\u6001 <span class="bdg">'+emEntries.length+' \u540d\u6d3b\u8dc3</span></div><div class="ent-grid">';
    if (emEntries.length > 0) {
      for (var ei = 0; ei < emEntries.length; ei++) {
        var en = emEntries[ei], cName = en[0], cData = en[1];
        var lc = lifecycles[cName] || {};
        var lcKey = lc.state || 'ALIVE';
        var lcLabel = {ALIVE:'\u5b58\u6d3b',DYING:'\u6fd2\u6b7b',DEAD:'\u6b7b\u4ea1',REINCARNATED:'\u8f6c\u751f',REBORN:'\u8f6c\u751f',DORMANT:'\u4f11\u7720'}[lcKey]||lcKey;
        // \u6839\u636e\u6001\u5ea6\u52a8\u6001\u7740\u8272 border-left
        var attitudeVal = parseInt(cData.attitude) || 0;
        var isSelf = cName.indexOf('\u4f60') >= 0 || cName.indexOf('\u4e3b\u89d2') >= 0;
        var borderClr = isSelf ? '#f0c040' : attitudeVal > 3 ? '#7ee787' : attitudeVal < -3 ? '#f85149' : '#8b949e';
        html += '<div class="ent-card" style="border-left:3px solid '+borderClr+';">';
        html += '<span class="ebadge" style="background:'+(lcColors[lcKey]||'#1a2a3a')+';color:'+(lcTxts[lcKey]||'#58a6ff')+';">'+lcLabel+'</span>';
        // ★ v3.0.1: 生命周期手动下拉
        html += '<select class="world-engine-lifecycle-select" data-char="'+esc(cName)+'" data-orig="'+lcKey+'">';
        html += '<option value="ALIVE"'+(lcKey==='ALIVE'?' selected':'')+'>存</option><option value="DYING"'+(lcKey==='DYING'?' selected':'')+'>濒</option><option value="DEAD"'+(lcKey==='DEAD'?' selected':'')+'>亡</option><option value="REBORN"'+(lcKey==='REBORN'?' selected':'')+'>转</option><option value="DORMANT"'+(lcKey==='DORMANT'?' selected':'')+'>眠</option>';
        html += '</select>';
        html += '<div class="ename">'+esc(cName)+'</div>';
        html += '<div class="estate">\u6001\u5ea6\uff1a'+esc(cData.attitude||'-')+' \u00b7 \u60c5\u611f\uff1a<span class="gold">'+esc(cData.level||'-')+'</span></div>';
        html += '<div class="sm gray" style="margin-bottom:4px;">\u7b2c 1 \u8f6e\u767b\u573a</div>';
        html += '<div style="display:flex;gap:4px;"><button class="btn btn-sm world-engine-entity-edit" data-char="'+esc(cName)+'" style="font-size:9px;padding:2px 6px;">\u270e \u7f16\u8f91</button></div></div>';
      }
    } else {
      html += '<div class="sm gray" style="padding:12px;">\u6682\u65e0\u89d2\u8272\u60c5\u611f\u6570\u636e</div>';
    }
    html += '</div></div>';

    // factions + reputation
    html += '<div class="card-row">';
    html += '<div class="card" style="flex:1;"><div class="card-title">\ud83c\udfdb\ufe0f \u52bf\u529b\u5173\u7cfb <span class="bdg">'+(state.factions?state.factions.length:0)+' \u4e2a\u52bf\u529b</span></div>';
    html += '<div class="faction-grid">';
    var facs = state.factions || [];
    var fcolors = ['#7ee787','#f85149','#58a6ff','#d29922'];
    if (facs.length > 0) {
      for (var fi = 0; fi < facs.length; fi++) {
        var f = facs[fi];
        html += '<div class="faction-card" style="border-left:3px solid '+fcolors[fi%fcolors.length]+';">';
        html += '<div style="font-weight:600;font-size:12.5px;">'+esc(f.name)+'</div>';
        html += '<div class="sm gray">\u51dd\u805a\u529b: '+esc(f.cohesion||'-')+' \u00b7 \u8d44\u6e90: '+esc(f.resources||'-')+'</div>';
        html += '<div class="sm gray">\u76ee\u6807: '+esc(f.goal||'-')+' \u00b7 \u6001\u5ea6: '+esc(f.attitude||'-')+'</div></div>';
      }
    } else {
      html += '<div class="sm gray">\u6682\u65e0\u52bf\u529b</div>';
    }
    html += '</div>';
    // faction relations
    var facRels = state.factionRelations || [];
    if (facRels.length) {
      html += '<div class="mt-8"><div class="sm" style="font-weight:600;margin-bottom:4px;">\ud83d\udd17 \u52bf\u529b\u5173\u7cfb\u7f51</div>';
      for (var fri = 0; fri < facRels.length; fri++) {
        var fr = facRels[fri];
        html += '<div class="sm gray" style="margin-bottom:2px;">'+esc(fr.from||'')+' \u2192 '+esc(fr.to||'')+' <span style="color:'+(fr.type==='\u654c\u5bf9'?'#f85149':'#7ee787')+'">['+esc(fr.type||'')+']</span></div>';
      }
      html += '</div>';
    }
    html += '<div class="fa mt-8"><button class="btn btn-sm" id="world-engine-create-faction">\u2795 \u521b\u5efa\u52bf\u529b</button></div></div>';

    var rep = state.reputation || {};
    html += '<div class="card" style="flex:1;"><div class="card-title">\ud83c\udf10 \u58f0\u8a89\u7cfb\u7edf</div>';
    html += '<div class="fr" style="grid-template-columns:1fr;">';
    var repItems = [{l:'\u6c5f\u6e56',v:rep.jianghu||'\u9ed8\u9ed8\u65e0\u95fb'},{l:'\u5b98\u573a',v:rep.official||'\u9ed8\u9ed8\u65e0\u95fb'},{l:'\u6c11\u95f4',v:rep.folk||'\u9ed8\u9ed8\u65e0\u95fb'},{l:'\u5730\u4e0b',v:rep.underworld||'\u9ed8\u9ed8\u65e0\u95fb'}];
    for (var ri = 0; ri < repItems.length; ri++) {
      html += '<div class="flex" style="justify-content:space-between;"><span class="gray">'+repItems[ri].l+'\uff1a</span><span>'+esc(repItems[ri].v)+'</span></div>';
    }
    html += '</div></div></div>';

    // economy + world desc
    var eco = state.economy || {};
    html += '<div class="card-row">';
    html += '<div class="card" style="flex:1;"><div class="card-title">\ud83d\udcb0 \u7ecf\u6d4e\u72b6\u51b5</div>';
    html += '<div class="flex"><span class="gray">\u5e02\u573a\u8d8b\u52bf\uff1a</span><span>'+esc(eco.marketTrend||'\u5e73\u7a33')+'</span></div>';
    html += '<div class="flex"><span class="gray">\u8d44\u91d1\u72b6\u51b5\uff1a</span><span>'+esc(eco.fundsStatus||'\u624b\u5934\u7d27')+'</span></div>';
    html += '<div class="flex"><span class="gray">\u5173\u952e\u8d44\u6e90\uff1a</span><span>'+esc((eco.keyResources||[]).join(' \u00b7 ')||'-')+'</span></div></div>';

    html += '<div class="card" style="flex:1;"><div class="card-title">\ud83d\udcdd \u4e16\u754c\u7b80\u8ff0</div>';
    html += '<div class="sm gray">'+esc(state.worldDescription||'\uff08\u6682\u65e0\u7b80\u8ff0\uff0c\u70b9\u51fb\u7f16\u8f91\u6dfb\u52a0\uff09')+'</div>';
    html += '<div class="flex mt-8"><button class="btn btn-sm" id="world-engine-wdesc-edit">\u270f\ufe0f \u7f16\u8f91\u4e16\u754c\u7b80\u8ff0</button>';
    html += '<button class="btn btn-sm btn-primary" id="world-engine-wdesc-save" style="display:none">\ud83d\udcbe \u4fdd\u5b58</button></div>';
    html += '<textarea id="world-engine-wdesc-editor" style="display:none;width:100%;min-height:50px;padding:6px;border-radius:6px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;font-size:11px;resize:vertical;box-sizing:border-box;margin-top:4px">'+esc(state.worldDescription||'')+'</textarea></div></div>';

    // lifecycle summary
    var lcCounts = {ALIVE:0,DYING:0,DEAD:0,REINCARNATED:0,REBORN:0,DORMANT:0};
    Object.keys(lifecycles).forEach(function(k){ var s=lifecycles[k].state||'ALIVE'; if(lcCounts[s]!==undefined)lcCounts[s]++; });
    var totalAlive = lcCounts.ALIVE + lcCounts.DYING;
    html += '<div class="card"><div class="card-title">\ud83d\udd04 \u89d2\u8272\u751f\u547d\u5468\u671f <span class="bdg">\u5b58\u6d3b '+totalAlive+' \u00b7 \u4f11\u7720 '+lcCounts.DORMANT+' \u00b7 \u6b7b\u4ea1 '+lcCounts.DEAD+' \u00b7 \u8f6c\u751f '+(lcCounts.REINCARNATED+lcCounts.REBORN)+'</span></div>';
    html += '<div class="flex" style="gap:16px;"><div><span class="green">\ud83d\udfe2 \u5b58\u6d3b</span> <span class="gray">'+lcCounts.ALIVE+' \u540d</span></div>';
    if (lcCounts.DYING > 0) html += '<div><span class="gold">\ud83d\udfe1 \u6fd2\u6b7b</span> <span class="gray">'+lcCounts.DYING+' \u540d</span></div>';
    html += '<div><span class="blue">\ud83d\udd35 \u4f11\u7720</span> <span class="gray">'+lcCounts.DORMANT+' \u540d</span></div>';
    html += '<div><span class="red">\ud83d\udd34 \u6b7b\u4ea1</span> <span class="gray">'+lcCounts.DEAD+' \u540d</span></div>';
    html += '<div><span class="gold">\ud83d\udfe1 \u8f6c\u751f</span> <span class="gray">'+(lcCounts.REINCARNATED+lcCounts.REBORN)+' \u540d</span></div></div></div>';

    // blood feud + events
    html += '<div class="card-row">';
    html += '<div class="card" style="flex:1;"><div class="card-title">\u2694\ufe0f \u8840\u4ec7\u5907\u5fd8\u5f55</div>';
    var bf = state.bloodFeudMemo || [];
    if (bf.length) {
      for (var bi = 0; bi < bf.length; bi++) {
        html += '<div class="sm gray" style="margin-bottom:3px;"><span style="color:#f85149;font-weight:600;">'+esc(bf[bi].faction)+'</span> \u2014 '+esc(bf[bi].reason||'')+'\uff08'+esc(bf[bi].status||'')+'\uff09</div>';
      }
    } else { html += '<div class="sm gray">\u6682\u65e0\u8840\u4ec7\u8bb0\u5f55</div>'; }
    html += '</div><div class="card" style="flex:1;"><div class="card-title">\ud83d\udd17 \u56e0\u679c\u94fe</div>';
    var evts = state.events || [];
    if (evts.length) {
      for (var evi = 0; evi < evts.length; evi++) {
        var ev = evts[evi];
        html += '<div class="sm gray" style="margin-bottom:3px;display:flex;justify-content:space-between;align-items:center;"><span><span style="color:#d29922;">['+esc(ev.stage||'\u8fdb\u884c\u4e2d')+']</span> <span style="font-weight:500;">'+esc(ev.name)+'</span> <span class="gray">Lv.'+(ev.level||1)+' '+(ev.currentRound||0)+'/'+(ev.totalRounds||1)+'</span></span><button class="btn btn-sm world-engine-event-advance" data-ev-name="'+esc(ev.name)+'">\u25b6 \u63a8\u8fdb</button></div>';
      }
    } else { html += '<div class="sm gray">\u6682\u65e0\u5173\u952e\u56e0\u679c</div>'; }
    html += '<div class="fa mt-8"><button class="btn btn-sm" id="world-engine-create-event">\u2795 \u521b\u5efa\u4e8b\u4ef6</button></div></div></div>';

    // NPC schedules
    html += '<div class="card"><div class="card-title">\ud83d\udcc5 NPC \u65e5\u7a0b</div><div class="tl">';
    var npcLog = state.npcActivityLog || [];
    if (npcLog.length) {
      var shown = 0;
      for (var ni = 0; ni < npcLog.length && shown < 8; ni++) {
        var a = npcLog[ni];
        if (!a || !a.npc) continue;
        shown++;
        html += '<div class="tl-i"><div class="rnd">#'+a.round+'</div><div class="txt">'+esc(a.npc)+'\uff1a'+esc(a.activity)+(a.location&&a.location!=='\u672a\u77e5'?'\uff08'+esc(a.location)+'\uff09':'')+'</div><button class="world-engine-sched-edit-btn" data-npc="'+esc(a.npc)+'" data-activity="'+esc(a.activity)+'" data-location="'+esc(a.location||'')+'" style="flex-shrink:0;margin-left:4px;">\u270f</button></div>';
      }
    } else {
      html += '<div class="sm gray">\u6682\u65e0 NPC \u6d3b\u52a8\u8bb0\u5f55</div>';
    }
    html += '</div></div>';

    // rumors
    var rumors = state.rumors || [];
    html += '<div class="card"><div class="card-title" style="display:flex;align-items:center;gap:6px;">\ud83d\udde3\ufe0f \u8c23\u8a00\u4e0e\u4f20\u95fb <span class="bdg">'+rumors.length+'</span><button class="btn btn-sm world-engine-rumor-add" style="margin-left:auto;font-size:9px;padding:2px 6px;">\u2795 \u6dfb\u52a0\u8c23\u8a00</button></div>';
    if (rumors.length) {
      html += '<div class="tl">';
      for (var rmi = Math.max(0, rumors.length - 5); rmi < rumors.length; rmi++) {
        var rm = rumors[rmi];
        html += '<div class="tl-i"><div class="txt">\ud83d\udcac '+(rm.round?'#'+rm.round+': ':'')+esc(rm.text||rm.content||'')+'</div></div>';
      }
      html += '</div>';
    } else {
      html += '<div class="sm gray">\u6682\u65e0\u8c23\u8a00\u4f20\u95fb</div>';
    }
    html += '</div>';

    // causal chain
    var causalChain = state.causalChain || [];
    html += '<div class="card"><div class="card-title">\ud83d\udd17 \u56e0\u679c\u94fe\u6761 <span class="bdg">\u6545\u4e8b\u903b\u8f91</span></div>';
    if (causalChain.length) {
      html += '<div class="tl">';
      for (var cci = 0; cci < causalChain.length; cci++) {
        var cc = causalChain[cci];
        html += '<div class="tl-i"><div class="txt">'+(cc.round?'#'+cc.round+': ':'')+esc(cc.cause||'')+' \u2192 '+esc(cc.effect||'')+'</div></div>';
      }
      html += '</div>';
    } else {
      html += '<div class="sm gray">\u6682\u65e0\u56e0\u679c\u94fe\u6761\u8bb0\u5f55</div>';
    }
    html += '</div>';

    // world law preview
    var wlp = state.worldLaw || {};
    html += '<div class="card"><div class="card-title">\ud83c\udf10 \u4e16\u754c\u6cd5\u5219\u9884\u89c8 <span class="bdg">'+(wlp.dimensions?Object.keys(wlp.dimensions).length:0)+' \u7ef4\u5ea6</span></div>';
    html += '<div class="sm gray">';
    if (wlp.dimensions) {
      for (var dimKey in wlp.dimensions) {
        html += '<span class="tag tag-top">'+esc(dimKey)+': '+esc(wlp.dimensions[dimKey])+'</span> ';
      }
    }
    if (wlp.customRules && wlp.customRules.length) {
      wlp.customRules.forEach(function(r){ html += '<span class="tag tag-ent">'+esc(r)+'</span> '; });
    }
    if (!wlp.dimensions && (!wlp.customRules || !wlp.customRules.length)) {
      html += '\u6682\u65e0\u4e16\u754c\u6cd5\u5219\u914d\u7f6e';
    }
    html += '</div>';
    html += '<div class="fa"><button class="btn btn-sm btn-primary" id="world-engine-worldlaw-nav">\ud83c\udf10 \u67e5\u770b\u5b8c\u6574\u4e16\u754c\u6cd5\u5219</button></div></div>';

    cont.innerHTML = html;

    // bind world desc editor
    setTimeout(function(){
      var edBtn = document.getElementById('world-engine-wdesc-edit');
      var svBtn = document.getElementById('world-engine-wdesc-save');
      var disp = document.getElementById('world-engine-wdesc-display');
      var ed = document.getElementById('world-engine-wdesc-editor');
      if (!edBtn || !svBtn || !ed) return;
      edBtn.addEventListener('click', function(){
        ed.style.display = 'block'; edBtn.style.display = 'none'; svBtn.style.display = 'inline-block'; ed.focus();
      });
      svBtn.addEventListener('click', function(){
        var v = ed.value.trim();
        var st = core.loadState();
        st.worldDescription = v;
        core.saveState(st);
        ed.style.display = 'none'; edBtn.style.display = 'inline-block'; svBtn.style.display = 'none';
        toast('\u2705 \u4e16\u754c\u7b80\u8ff0\u5df2\u4fdd\u5b58');
        requestConfigApply('world-description');
      });
      // create faction
      var cfBtn = document.getElementById('world-engine-create-faction');
      if (cfBtn) cfBtn.addEventListener('click', function(){
        var name = prompt('请输入势力名称：');
        if (!name) return;
        var st = core.loadState();
        if (!st.factions) st.factions = [];
        st.factions.push({ name: name, cohesion: 50, resources: '中等', goal: '自我发展', attitude: '中立' });
        core.saveState(st);
        toast('✅ 已创建势力：' + name);
        refresh();
      });
      // create event
      var ceBtn = document.getElementById('world-engine-create-event');
      if (ceBtn) ceBtn.addEventListener('click', function(){
        var name = prompt('请输入事件名称：');
        if (!name) return;
        var st = core.loadState();
        if (!st.events) st.events = [];
        st.events.push({ name: name, stage: '进行中', level: 1, currentRound: 0, totalRounds: 3 });
        core.saveState(st);
        toast('✅ 已创建事件：' + name);
        refresh();
      });
      // event advance buttons
      document.querySelectorAll('.world-engine-event-advance').forEach(function(btn){
        btn.addEventListener('click', function(){
          var evName = this.getAttribute('data-ev-name');
          if (!evName) { toast('⚠️ 错误：无效事件', true); return; }
          var st = core.loadState();
          var evts = st.events || [];
          for (var ei = 0; ei < evts.length; ei++) {
            if (evts[ei].name === evName) {
              evts[ei].currentRound = (evts[ei].currentRound || 0) + 1;
              if (evts[ei].currentRound >= (evts[ei].totalRounds || 3)) evts[ei].stage = '已结束';
              break;
            }
          }
          core.saveState(st);
          toast('✅ 事件已推进：' + evName);
          refresh();
        });
      });
      // entity edit buttons — prompt to change attitude/level
      document.querySelectorAll('.world-engine-entity-edit').forEach(function(btn){
        btn.addEventListener('click', function(){
          var charName = this.getAttribute('data-char');
          if (!charName) return;
          var st = core.loadState();
          var em = st.emotionMap && st.emotionMap[charName];
          if (!em) { toast('⚠️ 未找到该角色情感数据', true); return; }
          var newAtt = prompt('修改态度值（当前：'+em.attitude+'）：', em.attitude);
          if (newAtt === null) return;
          var newLevel = prompt('修改情感等级（当前：'+em.level+'）：', em.level);
          if (newLevel === null) return;
          em.attitude = parseInt(newAtt) || 0;
          em.level = newLevel.trim();
          core.saveState(st);
          toast('✅ 已更新 '+charName+' 的情感数据');
          refresh();
        });
      });
      // ★ v3.0.1: 生命周期下拉变更
      document.querySelectorAll('.world-engine-lifecycle-select').forEach(function(sel){
        sel.addEventListener('change', function(){
          var charName = this.getAttribute('data-char');
          var newState = this.value;
          if (!charName || !newState) return;
          var labelMap = {ALIVE:'存',DYING:'濒',DEAD:'亡',REBORN:'转',DORMANT:'眠'};
          var confirmMsg = '确定将角色「'+charName+'」的生命状态切换为'+({ALIVE:'存活',DYING:'濒死',DEAD:'死亡',REBORN:'转生',DORMANT:'休眠'}[newState]||newState)+'？';
          if (!confirm(confirmMsg)) {
            this.value = this.getAttribute('data-orig');
            return;
          }
          var st = core.loadState();
          if (typeof core.setCharacterLifecycle === 'function') {
            core.setCharacterLifecycle(st, charName, newState);
            this.setAttribute('data-orig', newState);
            addNotification('生命周期: '+charName+' → '+newState);
          } else {
            if (!st.characterLifecycles) st.characterLifecycles = {};
            if (!st.characterLifecycles[charName]) st.characterLifecycles[charName] = { state: 'ALIVE', lastChangedRound: 0, history: [] };
            st.characterLifecycles[charName].state = newState;
            st.characterLifecycles[charName].lastChangedRound = st.round || 0;
          }
          core.saveState(st);
          toast('✅ 已更新 '+charName+' 状态');
          refresh();
        });
      });
      // ★ v3.0.1: NPC日程编辑
      document.querySelectorAll('.world-engine-sched-edit-btn').forEach(function(btn){
        btn.addEventListener('click', function(){
          var npc = this.getAttribute('data-npc');
          var act = this.getAttribute('data-activity');
          var loc = this.getAttribute('data-location');
          var newAct = prompt('修改「'+npc+'」的活动内容：', act);
          if (newAct === null) return;
          var newLoc = prompt('修改地点：', loc || '未知');
          if (newLoc === null) return;
          var st = core.loadState();
          if (st.npcActivityLog) {
            for (var ni2 = 0; ni2 < st.npcActivityLog.length; ni2++) {
              var entry = st.npcActivityLog[ni2];
              if (entry.npc === npc && entry.activity === act) {
                entry.activity = newAct;
                if (newLoc) entry.location = newLoc;
                break;
              }
            }
          }
          if (st.npcActivities && st.npcActivities[npc]) {
            st.npcActivities[npc].currentActivity = newAct;
            if (newLoc) st.npcActivities[npc].location = newLoc;
          }
          core.saveState(st);
          toast('✅ 已更新 '+npc+' 的日程');
          refresh();
        });
      });
      // rumor add
      document.querySelectorAll('.world-engine-rumor-add').forEach(function(btn){
        btn.addEventListener('click', function(){
          var text = prompt('请输入谣言内容：');
          if (!text) return;
          var st = core.loadState();
          if (!st.rumors) st.rumors = [];
          st.rumors.push({ text: text, round: st.round || 0, timestamp: Date.now() });
          core.saveState(st);
          toast('✅ 已添加谣言');
          refresh();
        });
      });
      // rumor delete
      document.querySelectorAll('.world-engine-rumor-delete').forEach(function(btn){
        btn.addEventListener('click', function(){
          var idx = parseInt(this.getAttribute('data-idx'));
          if (isNaN(idx)) return;
          var st = core.loadState();
          if (!st.rumors || idx < 0 || idx >= st.rumors.length) { toast('⚠️ 无效索引', true); return; }
          st.rumors.splice(idx, 1);
          core.saveState(st);
          toast('✅ 已删除谣言');
          refresh();
        });
      });
      // world law nav
      var wlBtn = document.getElementById('world-engine-worldlaw-nav');
      if (wlBtn) wlBtn.addEventListener('click', function(){
        switchTab('worldbook');
        // scroll to the world law editor area
        setTimeout(function(){
          var wlSection = document.getElementById('world-engine-wl-section');
          if (wlSection) wlSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      });
    }, 50);
  }

  /* ═══════════════════ MEMORY ═══════════════════ */
  function renderMemory(cont, state) {
    var mems = state.memories || [];
    var hot = 0, cold = 0;
    mems.forEach(function(m){ var i=m.importance||0; if(i>=4)hot++; else if(i>=2)cold++; });

    var html = '';
    html += '<div class="guide-box"><div class="gt">\ud83e\udde0 \u8bb0\u5fc6\u7cfb\u7edf</div><div class="gd">\u70ed\u8bb0\u5fc6\uff08\u8fd1\u671f/\u9ad8\u9891\uff09\ud83d\udd25 \u4f18\u5148\u53ec\u56de\uff0c\u51b7\u8bb0\u5fc6\uff08\u4e45\u8fdc\uff09\ud83e\uddca \u81ea\u52a8\u5f52\u6863\u3002Tag \u7d22\u5f15\u81ea\u52a8\u5206\u7c7b\uff0cToken \u9884\u7b97\u52a8\u6001\u88c1\u526a\u4fdd\u969c\u4e0a\u4e0b\u6587\u8d28\u91cf\u3002</div></div>';

    html += '<div class="save-bar"><div class="hint"><b>'+mems.length+' \u6761\u8bb0\u5fc6</b> \u00b7 \u70ed \ud83d\udd25 '+hot+' \u00b7 \u51b7 \ud83e\uddca '+cold+'</div>';
    html += '<div class="flex"><input type="text" id="world-engine-mem-search" placeholder="\u641c\u7d22\u8bb0\u5fc6..." style="padding:4px 8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;color:#e6edf3;font-size:11px;width:140px;">';
    html += '<select id="world-engine-mem-filter" style="padding:4px 8px;background:#21262d;border:1px solid #30363d;border-radius:4px;color:#e6edf3;font-size:11px;"><option>\u5168\u90e8</option><option>\u70ed\u8bb0\u5fc6</option><option>\u51b7\u8bb0\u5fc6</option></select></div></div>';
    html += '<div class="save-bar"><div class="hint">\ud83d\udcdd \u81ea\u5b9a\u4e49\u5b9e\u4f53</div>';
    html += '<div class="flex"><input type="text" id="world-engine-custom-entities" placeholder="\u8f93\u5165\u81ea\u5b9a\u4e49\u5b9e\u4f53\u540d\u79f0..." style="flex:1;padding:4px 8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;color:#e6edf3;font-size:11px;">';
    html += '<button class="btn btn-sm" id="world-engine-save-custom-entities">\u2795 \u6dfb\u52a0</button></div></div>';
    html += '<div class="save-bar" style="justify-content:flex-end;"><button class="btn btn-sm" id="world-engine-add-memory">\u2795 \u624b\u52a8\u6dfb\u52a0\u8bb0\u5fc6</button></div>';

    html += '<div id="world-engine-memory-batch-area"></div>';
    html += '<div class="card"><div class="card-title">\ud83d\udcbe \u8bb0\u5fc6\u5217\u8868</div><div id="world-engine-memory-list">';
    var recent = recentMemories(state, 20);
    if (recent.length === 0) {
      html += '<div class="sm gray" style="padding:12px;">\u6682\u65e0\u8bb0\u5fc6\uff0c\u5bf9\u8bdd\u540e\u81ea\u52a8\u751f\u6210</div>';
    } else {
      for (var mi = 0; mi < recent.length; mi++) {
        var m = recent[mi];
        var ih = (m.importance||0) >= 4;
        var ic = (m.importance||0) >= 2 && (m.importance||0) < 4;
        var cls = ih ? 'hot' : (ic ? 'cold' : '');
        var memTags = (m.tags && m.tags.entities||[]).concat(m.tags && m.tags.topics||[]);
        html += '<div class="mem-item '+cls+'" data-mem-round="'+(m.round||'')+'" data-mem-summary="'+esc((m.summary||m.text||'').substring(0,60))+'">';
        html += '<input type="checkbox" class="world-engine-mem-select" data-mem-round="'+(m.round||'')+'" style="flex-shrink:0;accent-color:#238636;">';
        html += '<span style="font-weight:600;'+(ih?'color:#f0c040':ic?'color:#58a6ff':'')+'">'+(ih?'\ud83d\udd25':ic?'\ud83e\uddca':'')+'</span>';
        html += '<span class="memt">'+esc(m.summary||m.text||'')+'</span>';
        html += '<span class="memr">#'+m.round+' \u00b7 '+relativeTime(m, state)+'</span>';
        if (memTags.length) html += '<span>'+memTags.map(function(t){return tagHtml(t);}).join('')+'</span>';
        html += '<span class="mem-actions" style="flex-shrink:0;display:flex;gap:2px;margin-left:4px;">';
        html += '<button class="btn btn-sm world-engine-mem-edit" data-mem-round="'+(m.round||'')+'" style="font-size:9px;padding:0 4px;">\u270e</button>';
        html += '<button class="btn btn-sm world-engine-mem-del" data-mem-round="'+(m.round||'')+'" style="font-size:9px;padding:0 4px;color:#f85149;">\u2716</button>';
        html += '<button class="btn btn-sm world-engine-mem-imp" data-mem-round="'+(m.round||'')+'" style="font-size:9px;padding:0 4px;" title="\u4fee\u6539\u91cd\u8981\u6027">\ud83d\udd25</button></span>';
        html += '</div>';
      }
    }
    html += '</div></div>';

    // tag stats + thresholds
    html += '<div class="card-row">';
    html += '<div class="card" style="flex:1;"><div class="card-title">\ud83c\udff7\ufe0f \u6807\u7b7e\u7edf\u8ba1</div><div class="sm gray">';
    var tagCounts = {ent:0,loc:0,fac:0,top:0,emo:0,sta:0};
    mems.forEach(function(mem){
      var t = (mem.tags&&mem.tags.entities||[]).concat(mem.tags&&mem.tags.topics||[]);
      t.forEach(function(tg){ var tt=tagType(tg); if(tagCounts[tt]!==undefined)tagCounts[tt]++; });
    });
    html += '<span class="tag tag-ent" style="cursor:pointer;" onclick="document.getElementById(\'world-engine-mem-search\').value=\'\u5b9e\u4f53\';document.getElementById(\'world-engine-mem-search\').dispatchEvent(new Event(\'input\'));">\u5b9e\u4f53 '+tagCounts.ent+'</span> ';
    html += '<span class="tag tag-loc" style="cursor:pointer;" onclick="document.getElementById(\'world-engine-mem-search\').value=\'\u5730\u70b9\';document.getElementById(\'world-engine-mem-search\').dispatchEvent(new Event(\'input\'));">\u5730\u70b9 '+tagCounts.loc+'</span> ';
    html += '<span class="tag tag-fac" style="cursor:pointer;" onclick="document.getElementById(\'world-engine-mem-search\').value=\'\u52bf\u529b\';document.getElementById(\'world-engine-mem-search\').dispatchEvent(new Event(\'input\'));">\u52bf\u529b '+tagCounts.fac+'</span> ';
    html += '<span class="tag tag-top" style="cursor:pointer;" onclick="document.getElementById(\'world-engine-mem-search\').value=\'\u4e3b\u9898\';document.getElementById(\'world-engine-mem-search\').dispatchEvent(new Event(\'input\'));">\u4e3b\u9898 '+tagCounts.top+'</span> ';
    html += '<span class="tag tag-emo" style="cursor:pointer;" onclick="document.getElementById(\'world-engine-mem-search\').value=\'\u60c5\u611f\';document.getElementById(\'world-engine-mem-search\').dispatchEvent(new Event(\'input\'));">\u60c5\u611f '+tagCounts.emo+'</span>';
    html += '</div></div>';
    html += '<div class="card" style="flex:1;"><div class="card-title">\u2699\ufe0f \u51b7\u70ed\u9608\u503c</div>';
    var memConfig = state.memConfig || state.storageConfig || {};
    var hotThreshold = memConfig.hotRoundThreshold || 50;
    var archiveThreshold = memConfig.archiveImportance || 2;
    html += '<div class="flex"><span class="gray">\u70ed\u8bb0\u5fc6\u8f6e\u6570\u9608\u503c\uff1a</span><input type="number" class="world-engine-threshold-input" id="world-engine-hot-threshold" value="'+hotThreshold+'" min="1" max="999"></div>';
    html += '<div class="flex"><span class="gray">\u81ea\u52a8\u5f52\u6863\u91cd\u8981\u6027\uff1a</span><input type="number" class="world-engine-threshold-input" id="world-engine-archive-threshold" value="'+archiveThreshold+'" min="1" max="10"></div>';
    html += '<div class="fa"><button class="btn btn-sm btn-primary" id="world-engine-save-thresholds" style="font-size:10px;padding:2px 8px;">\ud83d\udcbe \u4fdd\u5b58\u9608\u503c</button></div></div></div>';

    html += '<div class="card"><div class="card-title">\ud83d\udcca \u8bb0\u5fc6\u7edf\u8ba1</div>';
    html += '<div class="fr" style="grid-template-columns:1fr;">';
    html += '<div class="flex" style="justify-content:space-between;"><span class="gray">\u539f\u59cb\u8bb0\u5fc6\uff1a</span><span>'+mems.length+'</span></div>';
    html += '<div class="flex" style="justify-content:space-between;"><span class="gray">\u7ae0\u8282\u6458\u8981\uff1a</span><span>'+(state.chapterSummaries?state.chapterSummaries.length:0)+'</span></div>';
    html += '<div class="flex" style="justify-content:space-between;"><span class="gray">\u5377\u6458\u8981\uff1a</span><span>'+(state.volumeSummaries?state.volumeSummaries.length:0)+'</span></div>';
    html += '<div class="flex" style="justify-content:space-between;"><span class="gray">\u60c5\u611f\u5b9e\u4f53\uff1a</span><span>'+Object.keys(state.emotionMap||{}).length+'</span></div>';
    html += '</div>';
    // chapter summaries content
    if (state.chapterSummaries && state.chapterSummaries.length) {
      html += '<div class="mt-8"><span class="sm" style="font-weight:600;">\u7ae0\u8282\u6458\u8981\u5217\u8868\uff1a</span>'
      for (var ci = 0; ci < Math.min(state.chapterSummaries.length, 3); ci++) {
        var cs = state.chapterSummaries[ci];
        html += '<div class="sm gray" style="margin-top:4px;">#' + (cs.round || cs.chapter || '?') + ' ' + esc(cs.summary || cs.text || '') + '</div>';
      }
      html += '</div>';
    }
    // volume summaries content
    if (state.volumeSummaries && state.volumeSummaries.length) {
      html += '<div class="mt-8"><span class="sm" style="font-weight:600;">\u5377\u6458\u8981\u5217\u8868\uff1a</span>'
      for (var vi = 0; vi < Math.min(state.volumeSummaries.length, 3); vi++) {
        var vs = state.volumeSummaries[vi];
        html += '<div class="sm gray" style="margin-top:4px;">#' + (vs.round || vs.volume || '?') + ' ' + esc(vs.summary || vs.text || '') + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    cont.innerHTML = html;

    // bind memory search
    setTimeout(function(){
      var searchInp = document.getElementById('world-engine-mem-search');
      var memList = document.getElementById('world-engine-memory-list');
      if (searchInp && memList) {
        searchInp.addEventListener('input', function(){
          var kw = this.value.trim().toLowerCase();
          if (!kw) { renderMemoryList(memList, recentMemories(state, 20), state); return; }
          var filtered = (state.memories||[]).filter(function(m){
            var s = (m.summary||m.text||'').toLowerCase();
            var t = (m.tags&&m.tags.entities||[]).concat(m.tags&&m.tags.topics||[]).join(' ').toLowerCase();
            return s.indexOf(kw) >= 0 || t.indexOf(kw) >= 0;
          }).sort(function(a,b){return b.round-a.round;}).slice(0, 30);
          renderMemoryList(memList, filtered, state);
        });
      }
      // \u8bb0\u5fc6\u7b5b\u9009
      var memFilter = document.getElementById('world-engine-mem-filter');
      if (memFilter) memFilter.addEventListener('change', function(){
        var v = this.value;
        document.querySelectorAll('#world-engine-memory-list .mem-item').forEach(function(item){
          item.style.display = 'flex';
          if (v === '\u70ed\u8bb0\u5fc6' && !item.classList.contains('hot')) item.style.display = 'none';
          else if (v === '\u51b7\u8bb0\u5fc6' && !item.classList.contains('cold')) item.style.display = 'none';
        });
      });
      // ★ v3.0.1: 批量操作栏初始化
      if (typeof renderBatchActionBar === 'function') {
        renderBatchActionBar('world-engine-memory-batch-area',
          function(checked){ /* selectAll callback - auto handled by renderBatchActionBar */ },
          function(){
            // batch delete
            var selected = [];
            document.querySelectorAll('.world-engine-mem-select:checked').forEach(function(cb){
              var r = parseInt(cb.getAttribute('data-mem-round'));
              if (!isNaN(r)) selected.push(r);
            });
            if (selected.length === 0) { toast('请先选择记忆', true); return; }
            if (!confirm('确定删除 '+selected.length+' 条记忆？')) return;
            var st = core.loadState();
            if (st.memories) {
              st.memories = st.memories.filter(function(m){ return selected.indexOf(m.round) < 0; });
            }
            core.saveState(st);
            toast('✅ 已批量删除 '+selected.length+' 条记忆');
            refresh();
          },
          function(){
            // batch mark importance
            var selected = [];
            document.querySelectorAll('.world-engine-mem-select:checked').forEach(function(cb){
              var r = parseInt(cb.getAttribute('data-mem-round'));
              if (!isNaN(r)) selected.push(r);
            });
            if (selected.length === 0) { toast('请先选择记忆', true); return; }
            var newImp = parseInt(prompt('设置重要性 (1-5)：', '3'));
            if (isNaN(newImp) || newImp < 1 || newImp > 5) { toast('无效重要性值', true); return; }
            var st = core.loadState();
            if (st.memories) {
              st.memories.forEach(function(m){
                if (selected.indexOf(m.round) >= 0) m.importance = newImp;
              });
            }
            core.saveState(st);
            toast('✅ 已批量更新 '+selected.length+' 条记忆的重要性');
            refresh();
          }
        );
        // checkbox change -> update batch count
        document.querySelectorAll('.world-engine-mem-select').forEach(function(cb){
          cb.addEventListener('change', function(){ if (typeof updateBatchCount === 'function') updateBatchCount(); });
        });
      }
      // ★ v3.0.1: 阈值保存
      var saveThreshBtn = document.getElementById('world-engine-save-thresholds');
      if (saveThreshBtn) {
        saveThreshBtn.addEventListener('click', function(){
          var hotEl = document.getElementById('world-engine-hot-threshold');
          var archEl = document.getElementById('world-engine-archive-threshold');
          var hotV = hotEl ? parseInt(hotEl.value) : 50;
          var archV = archEl ? parseInt(archEl.value) : 2;
          if (isNaN(hotV) || hotV < 1) hotV = 50;
          if (isNaN(archV) || archV < 1) archV = 2;
          var st = core.loadState();
          if (!st.memConfig) st.memConfig = {};
          st.memConfig.hotRoundThreshold = hotV;
          st.memConfig.archiveImportance = archV;
          core.saveState(st);
          toast('✅ 阈值已保存: 热='+hotV+', 归档重要性>='+archV);
        });
      }
      // custom entities save
      var custBtn = document.getElementById('world-engine-save-custom-entities');
      if (custBtn) custBtn.addEventListener('click', function(){
        var inp = document.getElementById('world-engine-custom-entities');
        if (!inp || !inp.value.trim()) { toast('\u8bf7\u8f93\u5165\u5b9e\u4f53\u540d\u79f0', true); return; }
        var st = core.loadState();
        if (!st.customEntities) st.customEntities = [];
        st.customEntities.push({ name: inp.value.trim(), addedRound: st.round || 0 });
        core.saveState(st);
        inp.value = '';
        toast('\u2705 \u5df2\u6dfb\u52a0\u81ea\u5b9a\u4e49\u5b9e\u4f53');
        refresh();
      });
      // manual add memory
      var memBtn = document.getElementById('world-engine-add-memory');
      if (memBtn) memBtn.addEventListener('click', function(){
        var text = prompt('\u8bf7\u8f93\u5165\u8bb0\u5fc6\u5185\u5bb9\uff1a');
        if (!text) return;
        var st = core.loadState();
        if (!st.memories) st.memories = [];
        st.memories.push({ summary: text, round: st.round || 0, importance: 3, timestamp: Date.now() });
        core.saveState(st);
        toast('\u2705 \u5df2\u6dfb\u52a0\u8bb0\u5fc6');
        refresh();
      });
      // memory edit
      document.querySelectorAll('.world-engine-mem-edit').forEach(function(btn){
        btn.addEventListener('click', function(ev){
          ev.stopPropagation();
          var round = parseInt(this.getAttribute('data-mem-round'));
          if (isNaN(round)) { toast('\u26a0\ufe0f \u65e0\u6548\u8bb0\u5fc6', true); return; }
          var st = core.loadState();
          var mems = st.memories || [];
          for (var i = 0; i < mems.length; i++) {
            if (mems[i].round === round) {
              var newText = prompt('\u7f16\u8f91\u8bb0\u5fc6\u5185\u5bb9\uff1a', mems[i].summary || mems[i].text || '');
              if (newText === null) return;
              mems[i].summary = newText.trim();
              core.saveState(st);
              toast('\u2705 \u8bb0\u5fc6\u5df2\u66f4\u65b0');
              refresh();
              return;
            }
          }
          toast('\u26a0\ufe0f \u672a\u627e\u5230\u8bb0\u5fc6', true);
        });
      });
      // memory delete
      document.querySelectorAll('.world-engine-mem-del').forEach(function(btn){
        btn.addEventListener('click', function(ev){
          ev.stopPropagation();
          var round = parseInt(this.getAttribute('data-mem-round'));
          if (isNaN(round)) { toast('\u26a0\ufe0f \u65e0\u6548\u8bb0\u5fc6', true); return; }
          if (!confirm('\u786e\u5b9a\u5220\u9664\u8fd9\u6761\u8bb0\u5fc6\uff1f')) return;
          var st = core.loadState();
          var mems = st.memories || [];
          for (var i = 0; i < mems.length; i++) {
            if (mems[i].round === round) {
              mems.splice(i, 1);
              core.saveState(st);
              toast('\u2705 \u8bb0\u5fc6\u5df2\u5220\u9664');
              refresh();
              return;
            }
          }
          toast('\u26a0\ufe0f \u672a\u627e\u5230\u8bb0\u5fc6', true);
        });
      });
      // memory importance toggle
      document.querySelectorAll('.world-engine-mem-imp').forEach(function(btn){
        btn.addEventListener('click', function(ev){
          ev.stopPropagation();
          var round = parseInt(this.getAttribute('data-mem-round'));
          if (isNaN(round)) { toast('\u26a0\ufe0f \u65e0\u6548\u8bb0\u5fc6', true); return; }
          var st = core.loadState();
          var mems = st.memories || [];
          for (var i = 0; i < mems.length; i++) {
            if (mems[i].round === round) {
              var cur = mems[i].importance || 0;
              var v = prompt('\u8f93\u5165\u65b0\u7684\u91cd\u8981\u6027 (1-5\uff0c\u5f53\u524d: '+cur+')', cur);
              if (v === null) return;
              var nv = parseInt(v);
              if (isNaN(nv) || nv < 1 || nv > 5) { toast('\u26a0\ufe0f \u91cd\u8981\u6027\u8303\u56f4\u4e3a 1-5', true); return; }
              mems[i].importance = nv;
              core.saveState(st);
              toast('\u2705 \u91cd\u8981\u6027\u5df2\u66f4\u65b0\u4e3a: '+nv);
              refresh();
              return;
            }
          }
          toast('\u26a0\ufe0f \u672a\u627e\u5230\u8bb0\u5fc6', true);
        });
      });
    }, 50);
  }

  function renderMemoryList(el, mems, state) {
    if (!el) return;
    if (!state) state = core.loadState();
    if (!mems.length) { el.innerHTML = '<div class="sm gray" style="padding:12px;">\u672a\u627e\u5230\u76f8\u5173\u8bb0\u5fc6</div>'; return; }
    var html = '';
    mems.forEach(function(m){
      var ih = (m.importance||0) >= 4;
      var ic = (m.importance||0) >= 2 && (m.importance||0) < 4;
      var cls = ih ? 'hot' : (ic ? 'cold' : '');
      var memTags = (m.tags && m.tags.entities||[]).concat(m.tags && m.tags.topics||[]);
      html += '<div class="mem-item '+cls+'" data-mem-round="'+(m.round||'')+'" data-mem-summary="'+esc((m.summary||m.text||'').substring(0,60))+'">';
      html += '<span style="font-weight:600;'+(ih?'color:#f0c040':ic?'color:#58a6ff':'')+'">'+(ih?'\ud83d\udd25':ic?'\ud83e\uddca':'')+'</span>';
      html += '<span class="memt">'+esc(m.summary||m.text||'')+'</span>';
      html += '<span class="memr">#'+m.round+' \u00b7 '+relativeTime(m, state)+'</span>';
      if (memTags.length) html += '<span>'+memTags.map(function(t){return tagHtml(t);}).join('')+'</span>';
      html += '<span class="mem-actions" style="flex-shrink:0;display:flex;gap:2px;margin-left:4px;">';
      html += '<button class="btn btn-sm world-engine-mem-edit" data-mem-round="'+(m.round||'')+'" style="font-size:9px;padding:0 4px;">\u270e</button>';
      html += '<button class="btn btn-sm world-engine-mem-del" data-mem-round="'+(m.round||'')+'" style="font-size:9px;padding:0 4px;color:#f85149;">\u2716</button>';
      html += '<button class="btn btn-sm world-engine-mem-imp" data-mem-round="'+(m.round||'')+'" style="font-size:9px;padding:0 4px;" title="\u4fee\u6539\u91cd\u8981\u6027">\ud83d\udd25</button></span>';
      html += '</div>';
    });
    el.innerHTML = html;
  }

  /* ═══════════════════ ENGINE ═══════════════════ */
  function renderEngine(cont, state) {
    var settings = readSettings();
    var driveMode = state.driveMode || settings.driveMode || 'ai';
    var evolveInterval = settings.evolveInterval || 3;

    var html = '';
    html += '<div class="guide-box"><div class="gt">\u2699\ufe0f \u6d3b\u4f53\u5f15\u64ce\u63a7\u5236\u53f0</div><div class="gd">\u5f15\u64ce\u9a71\u52a8 NPC \u884c\u4e3a\u3001\u4e16\u754c\u4e8b\u4ef6\u3001\u65f6\u95f4\u63a8\u8fdb\u3001\u5267\u60c5\u6f14\u5316\u3002\u6240\u6709\u8bbe\u7f6e\u5747\u6709\u72ec\u7acb\u4fdd\u5b58\u6309\u94ae\uff0c\u4e0d\u4f1a\u4e22\u5931\u914d\u7f6e\u3002</div></div>';

    // drive mode
    html += '<div class="card"><div class="card-title">\ud83c\udfae \u9a71\u52a8\u6a21\u5f0f</div><div class="fr">';
    html += '<div class="fg"><label>\u5f15\u64ce\u6a21\u5f0f</label><select id="world-engine-drive-mode">';
    html += '<option value="ai"'+(driveMode==='ai'?' selected':'')+'>\u81ea\u52a8\u6a21\u5f0f \u2014 \u6bcf\u8f6e\u81ea\u52a8\u63a8\u6f14</option>';
    html += '<option value="manual"'+(driveMode==='manual'?' selected':'')+'>\u624b\u52a8\u6a21\u5f0f \u2014 \u6309\u95f4\u9694\u89e6\u53d1</option>';
    html += '<option value="semi"'+(driveMode==='semi'?' selected':'')+'>\u534a\u81ea\u52a8 \u2014 \u5efa\u8bae + \u786e\u8ba4</option>';
    html += '</select></div>';
    html += '<div class="fg"><label>\u63a8\u6f14\u95f4\u9694\uff08\u624b\u52a8/\u534a\u81ea\u52a8\uff09</label><select id="world-engine-evolve-interval">';
    [1,3,5,10].forEach(function(n){ html += '<option value="'+n+'"'+(evolveInterval==n?' selected':'')+'>\u6bcf '+n+' \u6761\u6d88\u606f</option>'; });
    html += '</select></div></div>';
    html += '<div class="fa"><button class="btn btn-primary" id="world-engine-save-drive">\ud83d\udcbe \u4fdd\u5b58\u9a71\u52a8\u8bbe\u7f6e</button></div></div>';

    // time system
    var timeStr = timeModule && typeof timeModule.formatWorldTime === 'function'
      ? timeModule.formatWorldTime(state.inWorldMinutes || 0)
      : (state.inWorldMinutes || 0) + '\u5206\u949f';
    html += '<div class="card"><div class="card-title">\u23f0 \u65f6\u95f4\u7cfb\u7edf <span class="bdg">\u5f53\u524d: '+esc(timeStr)+'</span></div><div class="fr">';
    html += '<div class="fg"><label>\u5f53\u524d\u65f6\u95f4\u6587\u672c</label><input type="text" id="world-engine-time-text" value="'+esc(timeStr)+'"></div>';
    html += '<div class="fg"><label>\u7eaa\u5143</label><input type="text" id="world-engine-era" value="'+esc(state.era||'\u7eaa\u5143 1247 \u5e74')+'"></div></div>';
    html += '<div class="fr"><div class="fg"><label>\u6bcf\u8f6e\u65f6\u95f4\u589e\u91cf</label><select id="world-engine-time-inc">';
    var incs = [15,30,60,120,0]; var incLabels = ['15 \u5206\u949f','30 \u5206\u949f','1 \u5c0f\u65f6','2 \u5c0f\u65f6','\u968f\u673a 15\u5206~2\u5c0f\u65f6'];
    for (var ti=0;ti<incs.length;ti++) { html += '<option value="'+incs[ti]+'">'+incLabels[ti]+'</option>'; }
    html += '</select></div>';
    html += '<div class="fg"><label>\u65e5\u591c\u5faa\u73af</label><select id="world-engine-daynight"><option selected>\u5f00\u542f</option><option>\u5173\u95ed</option></select></div></div>';
    html += '<div class="fg"><label>\ud83d\udd50 \u5feb\u6377\u65f6\u95f4\u9884\u8bbe\uff08\u4e00\u952e\u5e94\u7528\uff09</label>';
    html += '<div class="flex" style="gap:4px;flex-wrap:wrap;">';
    html += '<button class="btn btn-sm world-engine-preset-time" data-min="15">\u26a1 \u7d27\u8feb</button>';
    html += '<button class="btn btn-sm world-engine-preset-time" data-min="60">\u2600\ufe0f \u6b63\u5e38</button>';
    html += '<button class="btn btn-sm world-engine-preset-time" data-min="240">\ud83c\udf19 \u7f13\u6162</button>';
    html += '<button class="btn btn-sm world-engine-preset-time" data-min="720">\ud83d\udd01 \u65e5\u00b7\u591c\u6a21\u5f0f</button>';
    html += '<button class="btn btn-sm world-engine-preset-time" data-min="10080">\ud83c\udf31 \u5b63\u8282\u6a21\u5f0f</button>';
    html += '<button class="btn btn-sm world-engine-preset-time" data-min="43200">\u23e9 \u5feb\u901f\u63a8\u8fdb</button>';
    html += '</div></div>';
    html += '<div class="fa"><button class="btn btn-primary" id="world-engine-save-time">\ud83d\udcbe \u4fdd\u5b58\u65f6\u95f4\u8bbe\u7f6e</button></div></div>';

    // evolution settings
    html += '<div class="card"><div class="card-title">\ud83e\uddec \u6f14\u5316\u8bbe\u7f6e</div><div class="fr">';
    html += '<div class="fg"><label>NPC \u6d3b\u52a8\u9891\u7387</label><select id="world-engine-npc-freq"><option>\u4f4e</option><option selected>\u4e2d</option><option>\u9ad8</option></select></div>';
    html += '<div class="fg"><label>\u4e16\u754c\u4e8b\u4ef6\u6982\u7387</label><select id="world-engine-ev-prob"><option>\u4f4e (10%)</option><option selected>\u4e2d (30%)</option><option>\u9ad8 (50%)</option></select></div></div>';
    html += '<div class="fr"><div class="fg"><label>\u60c5\u611f\u8870\u51cf\u901f\u5ea6</label><select id="world-engine-emotion-decay"><option>\u6162 (10 \u8f6e)</option><option selected>\u6807\u51c6 (5 \u8f6e)</option><option>\u5feb (3 \u8f6e)</option></select></div>';
    html += '<div class="fg"><label>\u89d2\u8272\u751f\u547d\u5468\u671f</label><select id="world-engine-lifecycle"><option selected>\u5f00\u542f</option><option>\u5173\u95ed</option></select></div></div>';
    html += '<div class="fg"><label>\u81ea\u52a8\u5267\u60c5\u9636\u6bb5\u63a8\u8fdb</label><select id="world-engine-phase-auto"><option selected>\u5f00\u542f (\u6bcf 10 \u8f6e\u81ea\u52a8\u63a8\u8fdb)</option><option>\u5173\u95ed</option></select></div>';
    html += '<div class="fa"><button class="btn btn-primary" id="world-engine-save-evolve">\ud83d\udcbe \u4fdd\u5b58\u6f14\u5316\u8bbe\u7f6e</button>';
    html += '<button class="btn btn-success" id="world-engine-manual-evolve">\u25b6\ufe0f \u624b\u52a8\u89e6\u53d1\u4e00\u8f6e\u63a8\u6f14</button>';
    html += '<button class="btn btn-danger" id="world-engine-emergency-stop" style="'+(driveMode==='ai'||driveMode==='auto'?'':'display:none')+'">\u26a0\ufe0f \u7d27\u6025\u505c\u6b62 \u4e00\u952e\u7981\u6b62\u81ea\u52a8\u6f14\u5316</button></div></div>';

    // injection style
    html += '<div class="card"><div class="card-title">\ud83d\udc89 \u6ce8\u5165\u98ce\u683c <span class="bdg">A/B \u6d4b\u8bd5</span></div><div class="fr">';
    html += '<div class="fg"><label>\u5f53\u524d\u98ce\u683c</label><select id="world-engine-inject-style">';
    ['\u6807\u51c6\u53d9\u4e8b\u98ce','\u6781\u7b80\u98ce','\u6c89\u6d78\u5f0f\uff08\u542b\u4e16\u754c\u7ec6\u8282\uff09','\u6218\u6597\u5f3a\u5316','\u89d2\u8272\u626e\u6f14\u6781\u81f4','\u60ac\u5ff5\u63a2\u7d22','\u9ed1\u6697\u5199\u5b9e','\u8bd7\u610f\u6d6a\u6f2b','\u5e7d\u9ed8\u641e\u7b11','\u81ea\u5b9a\u4e49'].forEach(function(s){ html += '<option'+(s==='\u6c89\u6d78\u5f0f\uff08\u542b\u4e16\u754c\u7ec6\u8282\uff09'?' selected':'')+'>'+s+'</option>'; });
    html += '</select></div>';
    html += '<div class="fg"><label>\u6ce8\u5165\u4f18\u5148\u7ea7</label><select id="world-engine-inject-priority">';
    ['\u81ea\u52a8\uff08\u667a\u80fd\u4f18\u5148\uff09','\u4e8b\u4ef6 > \u60c5\u611f > \u8bb0\u5fc6','\u60c5\u611f > \u4e8b\u4ef6 > \u8bb0\u5fc6','\u8bb0\u5fc6 > \u60c5\u611f > \u4e8b\u4ef6'].forEach(function(p){ html += '<option'+(p==='\u4e8b\u4ef6 > \u60c5\u611f > \u8bb0\u5fc6'?' selected':'')+'>'+p+'</option>'; });
    html += '</select></div></div>';
    html += '<div class="fr"><div class="fg"><label>Token \u9884\u7b97</label><input type="number" id="world-engine-token-budget" value="4096"></div>';
    html += '<div class="fg"><label>\u667a\u80fd\u6298\u53e0\u7ea7\u522b</label><select id="world-engine-fold-level"><option selected>\u667a\u80fd\uff08\u81ea\u52a8 3 \u7ea7\u6298\u53e0\uff09</option><option>\u5bbd\u677e\uff08\u4fdd\u7559\u66f4\u591a\u5185\u5bb9\uff09</option><option>\u4e25\u683c\uff08\u4fdd\u7559\u6838\u5fc3\u5185\u5bb9\u53ea\uff09</option></select></div></div>';
    html += '<div class="fa"><button class="btn btn-primary" id="world-engine-save-inject">\ud83d\udcbe \u4fdd\u5b58\u6ce8\u5165\u98ce\u683c</button></div></div>';
    // ★ v3.0.1: 自定义注入模板
    html += '<div class="card"><div class="card-title">\ud83d\udcdd \u81ea\u5b9a\u4e49\u6ce8\u5165\u6a21\u677f <span class="bdg">\u8986\u76d6\u7cfb\u7edf\u9ed8\u8ba4</span></div>';
    html += '<textarea id="world-engine-custom-inject-template" style="width:100%;min-height:60px;padding:6px;border-radius:6px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;font-size:11px;resize:vertical;box-sizing:border-box;" placeholder="\u8f93\u5165\u81ea\u5b9a\u4e49\u6ce8\u5165\u6a21\u677f\u5185\u5bb9... \u7559\u7a7a\u4f7f\u7528\u7cfb\u7edf\u9ed8\u8ba4\u3002\u652f\u6301 {era} {time} {world} {characters} {memories} {events} \u53d8\u91cf\u3002">' + esc(state.customInjectTemplate || '') + '</textarea>';
    html += '<div class="fa"><button class="btn btn-sm btn-primary" id="world-engine-save-custom-inject">\ud83d\udcbe \u4fdd\u5b58\u81ea\u5b9a\u4e49\u6a21\u677f</button><button class="btn btn-sm" id="world-engine-clear-custom-inject" style="margin-left:4px;">\ud83d\uddd1\ufe0f \u6e05\u9664</button></div></div>';

    // evolution log
    var evLog = state.eventLog || [];
    html += '<div class="card"><div class="card-title">\ud83d\udccb \u6f14\u5316\u65e5\u5fd7 <span class="bdg">\u6700\u8fd1\u7684\u63a8\u6f14\u7ed3\u679c</span></div>';
    html += '<div style="background:#0d1117;border-radius:6px;padding:8px;border:1px solid #21262d;max-height:120px;overflow-y:auto;font-size:11px;color:#8b949e;">';
    for (var ei = Math.max(0, evLog.length-4); ei < evLog.length; ei++) {
      var ev = evLog[ei];
      var evTime = ev.timestamp ? new Date(ev.timestamp).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
      var tsStr = evTime ? ' \u00b7 '+evTime : '';
      html += '<div style="margin-bottom:3px;">#'+(ev.round||ev.currentRound||'?')+tsStr+' \u00b7 '+esc(ev.desc||ev.event||ev.message||'')+'</div>';
    }
    if (!evLog.length) html += '<div>\u6682\u65e0\u6f14\u5316\u65e5\u5fd7</div>';
    html += '</div></div>';

    cont.innerHTML = html;

    // bind events
    setTimeout(function(){
      // time presets
      document.querySelectorAll('.world-engine-preset-time').forEach(function(btn){
        btn.addEventListener('click', function(){
          var min = parseInt(this.dataset.min);
          var incSel = document.getElementById('world-engine-time-inc');
          if (incSel) { for (var i=0;i<incSel.options.length;i++){ if(parseInt(incSel.options[i].value)===min){incSel.selectedIndex=i;break;} } }
          toast('\u23f0 \u65f6\u95f4\u589e\u91cf\u5df2\u8bbe\u4e3a: '+this.textContent.trim());
        });
      });

      // save drive mode
      var saveDrive = document.getElementById('world-engine-save-drive');
      if (saveDrive) {
        saveDrive.addEventListener('click', function(){
          var dm = document.getElementById('world-engine-drive-mode');
          var intr = document.getElementById('world-engine-evolve-interval');
          var st = core.loadState();
          st.driveMode = dm ? dm.value : 'ai';
          core.saveState(st);
          var s = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
          s.driveMode = dm ? dm.value : 'ai';
          s.evolveInterval = intr ? parseInt(intr.value) : 3;
          window.WORLD_ENGINE_STORAGE.setItem('world_engine_settings', JSON.stringify(s));
          toast('\u2705 \u9a71\u52a8\u6a21\u5f0f\u5df2\u4fdd\u5b58');
        });
      }

      // save time
      var saveTime = document.getElementById('world-engine-save-time');
      if (saveTime) {
        saveTime.addEventListener('click', function(){
          var st = core.loadState();
          var timeTextEl = document.getElementById('world-engine-time-text');
          var eraEl = document.getElementById('world-engine-era');
          var timeIncEl = document.getElementById('world-engine-time-inc');
          var dayNightEl = document.getElementById('world-engine-daynight');
          if (timeTextEl) st.timeText = timeTextEl.value;
          if (eraEl) st.era = eraEl.value;
          if (timeIncEl) st.timeIncrement = parseInt(timeIncEl.value);
          if (dayNightEl) st.dayNightCycle = dayNightEl.value;
          core.saveState(st);
          var s = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
          if (timeTextEl) s.timeText = timeTextEl.value;
          if (eraEl) s.era = eraEl.value;
          if (timeIncEl) s.timeIncrement = parseInt(timeIncEl.value);
          if (dayNightEl) s.dayNightCycle = dayNightEl.value;
          window.WORLD_ENGINE_STORAGE.setItem('world_engine_settings', JSON.stringify(s));
          toast('\u2705 \u65f6\u95f4\u8bbe\u7f6e\u5df2\u4fdd\u5b58');
        });
      }

      // save evolve
      var saveEvolve = document.getElementById('world-engine-save-evolve');
      if (saveEvolve) {
        saveEvolve.addEventListener('click', function(){
          var npcFreqEl = document.getElementById('world-engine-npc-freq');
          var evProbEl = document.getElementById('world-engine-ev-prob');
          var emotionDecayEl = document.getElementById('world-engine-emotion-decay');
          var lifecycleEl = document.getElementById('world-engine-lifecycle');
          var phaseAutoEl = document.getElementById('world-engine-phase-auto');
          var s = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
          if (npcFreqEl) s.npcFreq = npcFreqEl.value;
          if (evProbEl) s.evProb = evProbEl.value;
          if (emotionDecayEl) s.emotionDecay = emotionDecayEl.value;
          if (lifecycleEl) s.lifecycle = lifecycleEl.value;
          if (phaseAutoEl) s.phaseAuto = phaseAutoEl.value;
          window.WORLD_ENGINE_STORAGE.setItem('world_engine_settings', JSON.stringify(s));
          toast('\u2705 \u6f14\u5316\u8bbe\u7f6e\u5df2\u4fdd\u5b58');
        });
      }

      // save inject
      var saveInject = document.getElementById('world-engine-save-inject');
      if (saveInject) {
        saveInject.addEventListener('click', function(){
          var styleEl = document.getElementById('world-engine-inject-style');
          var priorityEl = document.getElementById('world-engine-inject-priority');
          var tokenEl = document.getElementById('world-engine-token-budget');
          var foldEl = document.getElementById('world-engine-fold-level');
          var s = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
          if (styleEl) s.injectStyle = styleEl.value;
          if (priorityEl) s.injectPriority = priorityEl.value;
          if (tokenEl) s.tokenBudget = parseInt(tokenEl.value);
          if (foldEl) s.foldLevel = foldEl.value;
          window.WORLD_ENGINE_STORAGE.setItem('world_engine_settings', JSON.stringify(s));
          toast('\u2705 \u6ce8\u5165\u98ce\u683c\u5df2\u4fdd\u5b58');
        });
      }

      var saveCustomInject = document.getElementById('world-engine-save-custom-inject');
      if (saveCustomInject) {
        saveCustomInject.addEventListener('click', function(){
          var tmplEl = document.getElementById('world-engine-custom-inject-template');
          var st = core.loadState();
          st.customInjectTemplate = tmplEl ? tmplEl.value.trim() : '';
          core.saveState(st);
          toast(st.customInjectTemplate ? '\u2705 \u81ea\u5b9a\u4e49\u6ce8\u5165\u6a21\u677f\u5df2\u4fdd\u5b58' : '\u2705 \u81ea\u5b9a\u4e49\u6ce8\u5165\u6a21\u677f\u5df2\u6e05\u7a7a');
          requestConfigApply('custom-inject-template');
        });
      }

      var clearCustomInject = document.getElementById('world-engine-clear-custom-inject');
      if (clearCustomInject) {
        clearCustomInject.addEventListener('click', function(){
          var tmplEl = document.getElementById('world-engine-custom-inject-template');
          var st = core.loadState();
          delete st.customInjectTemplate;
          core.saveState(st);
          if (tmplEl) tmplEl.value = '';
          toast('\u2705 \u81ea\u5b9a\u4e49\u6ce8\u5165\u6a21\u677f\u5df2\u6e05\u9664');
          requestConfigApply('custom-inject-template-clear');
        });
      }

      // manual evolve
      var manualBtn = document.getElementById('world-engine-manual-evolve');
      if (manualBtn) {
        // \u2605 v3.0.1: semi-auto confirm dialog
        function doEvolve(btn) {
          if (!evolution || typeof evolution.evolve !== 'function') { toast('\u26a0\ufe0f \u6f14\u5316\u6a21\u5757\u672a\u52a0\u8f7d', true); return; }
          btn.disabled = true; btn.textContent = '\u23f3 \u63a8\u6f14\u4e2d...';
          return btn;
        }
        function executeEvolve(btn) {
          var ptoast = showPersistToast('\ud83c\udf0d \u4e16\u754c\u63a8\u6f14\u4e2d...');
          try {
            var st = core.loadState();
            var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
            var lastMsg = ctx && ctx.chat ? ctx.chat[ctx.chat.length - 1] : null;
            var userMsg = lastMsg && lastMsg.is_user ? (lastMsg.mes||'') : '';
            var aiMsg = lastMsg && !lastMsg.is_user ? (lastMsg.mes||'') : '';
            return evolution.evolve(st, userMsg, aiMsg).then(function(success){
              removePersistToast();
              toast(success ? '\u2705 \u624b\u52a8\u63a8\u6f14\u5b8c\u6210' : '\u26a0\ufe0f \u63a8\u6f14\u5931\u8d25', !success);
              if (success) refresh();
              btn.disabled = false; btn.innerHTML = '\u25b6\ufe0f \u624b\u52a8\u89e6\u53d1\u4e00\u8f6e\u63a8\u6f14';
            }).catch(function(e){
              removePersistToast();
              toast('\u63a8\u6f14\u5f02\u5e38: '+e.message, true);
              btn.disabled = false; btn.innerHTML = '\u25b6\ufe0f \u624b\u52a8\u89e6\u53d1\u4e00\u8f6e\u63a8\u6f14';
            });
          } catch(e) {
            removePersistToast();
            toast('\u63a8\u6f14\u5f02\u5e38: '+e.message, true);
            btn.disabled = false; btn.innerHTML = '\u25b6\ufe0f \u624b\u52a8\u89e6\u53d1\u4e00\u8f6e\u63a8\u6f14';
          }
        }
        manualBtn.addEventListener('click', function(){
          if (!evolution || typeof evolution.evolve !== 'function') { toast('\u26a0\ufe0f \u6f14\u5316\u6a21\u5757\u672a\u52a0\u8f7d', true); return; }
          var dm = document.getElementById('world-engine-drive-mode');
          var driveMode = dm ? dm.value : 'ai';
          if (driveMode === 'semi') {
            // \u2605 v3.0.1: \u5f39\u7a97\u786e\u8ba4
            var preview = '\u62bd\u8c61\u63a8\u6f14\u5c06\u4f1a\u89e6\u53d1\u4ee5\u4e0b\u64cd\u4f5c:\\n- \u66f4\u65b0\u4e16\u754c\u72b6\u6001\uff08\u8f6e\u6b21\u3001\u65f6\u95f4\u3001NPC\u884c\u4e3a\uff09\\n- \u89e6\u53d1\u968f\u673a\u4e8b\u4ef6\u548c\u5267\u60c5\u6f14\u5316\\n- \u6a21\u62df\u89d2\u8272\u60c5\u611f\u53d8\u5316\u548c\u5173\u7cfb\u53d8\u52a8\\n- \u68c0\u6d4b\u6210\u5c31\u89e6\u53d1';
            showSemiAutoConfirmDialog(preview,
              function(){
                // confirm - do evolve
                var btn = document.getElementById('world-engine-manual-evolve');
                btn.disabled = true; btn.textContent = '\u23f3 \u63a8\u6f14\u4e2d...';
                executeEvolve(btn);
              },
              function(){
                // skip
                toast('\u23ed \u5df2\u8df3\u8fc7\u672c\u8f6e\u63a8\u6f14');
              }
            );
          } else {
            var btn = doEvolve(this); if (!btn) return;
            executeEvolve(btn);
          }
        });
      }
      // emergency stop — switch to manual mode
      var emStop = document.getElementById('world-engine-emergency-stop');
      if (emStop) {
        emStop.addEventListener('click', function(){
          if (!confirm('\u786e\u5b9a\u8981\u7acb\u5373\u505c\u6b62\u81ea\u52a8\u6f14\u5316\uff1f\u8fd9\u5c06\u628a\u9a71\u52a8\u6a21\u5f0f\u5207\u6362\u4e3a\u624b\u52a8\u6a21\u5f0f\u3002')) return;
          var st = core.loadState();
          st.driveMode = 'manual';
          core.saveState(st);
          toast('\u26a0\ufe0f \u7d27\u6025\u505c\u6b62\u5df2\u6267\u884c\uff0c\u5df2\u5207\u6362\u4e3a\u624b\u52a8\u6a21\u5f0f');
          requestConfigApply('emergency-stop');
          refresh();
        });
      }
    }, 50);
  }

  /* ═══════════════════ STORY ═══════════════════ */
  function renderStory(cont, state) {
    var html = '';
    html += '<div class="guide-box"><div class="gt">\ud83d\udcd6 \u6545\u4e8b\u7ba1\u7406</div><div class="gd">\u6545\u4e8b\u7c7b\u578b\u5206\u6790\u3001\u5267\u60c5\u7ebf\u7d22\u677f\u3001\u89d2\u8272\u753b\u50cf\u3001\u6218\u6597\u65e5\u5fd7\u3001\u4e16\u754c\u5206\u6790 \u2014 \u4e00\u5207\u5173\u4e4e\u53d9\u4e8b\u8fde\u8d2f\u6027\u7684\u5de5\u5177\u3002</div></div>';

    // story type analysis
    var storyTemplate = state.storyTemplate || state.storyArc || '\u82f1\u96c4\u4e4b\u65c5';
    var storyTone = state.storyTone || state.tone || '\u53f2\u8bd7\u58ee\u9614';
    var storyPhase = state.storyPhase || state.storyStage || '';
    var templates = [{id:'hero_journey',name:'\u82f1\u96c4\u4e4b\u65c5'},{id:'monster_slayer',name:'\u6218\u80dc\u602a\u7269'},{id:'rags_to_riches',name:'\u767d\u624b\u8d77\u5bb6'},{id:'quest_explore',name:'\u5f81\u7a0b\u63a2\u79d8'},{id:'return',name:'\u51fa\u8d70\u4e0e\u56de\u5f52'},{id:'comedy',name:'\u559c\u5267'},{id:'tragedy',name:'\u60b2\u5267'},{id:'rebirth',name:'\u91cd\u751f'},{id:'revenge',name:'\u590d\u4ec7\u8bb0'},{id:'love_triangle',name:'\u4e09\u89d2\u56f0\u5c40'},{id:'mystery',name:'\u8ff7\u6848\u4fa6\u63a2'},{id:'faction_strife',name:'\u6d3e\u7cfb\u7eb7\u4e89'}];
    var tones = [{id:'passionate',name:'\u70ed\u8840\u6fc0\u8361'},{id:'healing',name:'\u6e29\u99a8\u6cbb\u6108'},{id:'dark',name:'\u9ed1\u6697\u538b\u6291'},{id:'humorous',name:'\u5e7d\u9ed8\u8c11\u8c10'},{id:'suspense',name:'\u60ac\u7591\u7d27\u5f20'},{id:'tragic',name:'\u54c0\u4f24\u60b2\u60ec'},{id:'calm',name:'\u5b81\u9759\u6de1\u6cca'},{id:'epic',name:'\u53f2\u8bd7\u58ee\u9614'},{id:'natural',name:'\u81ea\u7136'},{id:'custom',name:'\u81ea\u5b9a\u4e49'}];
    var enableAuto = state.storyType ? state.storyType.enablePhaseProgression !== false : true;

    html += '<div class="card"><div class="card-title">\ud83c\udfad \u6545\u4e8b\u7c7b\u578b\u5206\u6790 <span class="bdg">\u5f53\u524d\u6a21\u677f + \u60c5\u611f\u57fa\u8c03</span></div><div class="fr">';
    html += '<div class="fg"><label>\u6545\u4e8b\u6a21\u677f\uff0812 \u79cd\u7ecf\u5178\u53d9\u4e8b\u6a21\u5f0f\uff09</label><select id="world-engine-story-template">';
    templates.forEach(function(t){ html += '<option value="'+t.id+'"'+(t.name===storyTemplate || t.id===storyTemplate?' selected':'')+'>'+t.name+'</option>'; });
    html += '</select></div>';
    html += '<div class="fg"><label>\u60c5\u611f\u57fa\u8c03\uff088 \u79cd\u53d9\u4e8b\u6c1b\u56f4\uff09</label><select id="world-engine-story-tone">';
    tones.forEach(function(t){ html += '<option value="'+t.id+'"'+(t.name===storyTone || t.id===storyTone?' selected':'')+'>'+t.name+'</option>'; });
    html += '</select></div></div>';
    // \u9636\u6bb5\u8fdb\u5ea6\u6761 + \u81ea\u5b9a\u4e49\u57fa\u8c03
    var currentPhaseIdx = (state.storyType&&state.storyType.currentPhase)||0;
    var totalPhases = 12;
    var pct = totalPhases > 0 ? Math.round((currentPhaseIdx / (totalPhases - 1)) * 100) : 0;
    html += '<div class="fr"><div class="fg"><label>\u5f53\u524d\u9636\u6bb5\uff08\u5171 '+totalPhases+' \u9636\u6bb5\uff09</label><div class="flex" style="gap:4px;align-items:center;"><div style="flex:1;height:8px;background:#21262d;border-radius:4px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,#f0c040,#f0883e);border-radius:4px;transition:width 0.3s;"></div></div><span class="sm gray" style="white-space:nowrap;">\u7b2c '+(currentPhaseIdx+1)+'/'+totalPhases+' \u9636\u6bb5\uff1a'+esc(storyPhase||'\u672a\u77e5')+'</span></div></div>';
    html += '<div class="fg"><label>\u81ea\u5b9a\u4e49\u57fa\u8c03\u6587\u672c\uff08\u9009\u81ea\u5b9a\u4e49\u65f6\u751f\u6548\uff09</label><input type="text" id="world-engine-custom-tone" placeholder="\u8f93\u5165\u81ea\u5b9a\u4e49\u60c5\u611f\u57fa\u8c03\u63cf\u8ff0..." value="'+esc((state.storyType&&state.storyType.customToneText)||'')+'"></div></div>';
    html += '<div class="flex-sb mt-8"><span class="tw"><label class="tg"><input type="checkbox" id="world-engine-phase-auto-toggle" '+(enableAuto?'checked':'')+'><span class="s"></span></label><span class="sm gray">\u81ea\u52a8\u63a8\u8fdb\u9636\u6bb5\uff08\u6bcf 10 \u8f6e\uff09</span></span>';
    html += '<button class="btn btn-primary" id="world-engine-save-story">\ud83d\udcbe \u4fdd\u5b58\u6545\u4e8b\u8bbe\u7f6e</button></div>';
    var injPreview = state.lastInjection ? (state.lastInjection.summary || state.lastInjection.text || '') : '';
    html += '<div class="mt-8" style="background:#0d1117;border-radius:6px;padding:8px;border:1px solid #21262d;font-size:10.5px;color:#8b949e;">\u5f53\u524d\u6ce8\u5165\u7247\u6bb5\u9884\u89c8\uff1a\u300c' + (injPreview ? esc(injPreview) : '\u3010\u6545\u4e8b\u65b9\u5411\u3011\ud83d\udcd6 \u6545\u4e8b\u8109\u7edc\uff1a'+esc(storyTemplate)+' \u00b7 \ud83c\udfad \u60c5\u611f\u57fa\u8c03\uff1a'+esc(storyTone)) + '\u300d</div></div>';

    // plot threads
    var threads = state.plotThreads || [];
    html += '<div class="card"><div class="card-title">\ud83d\udcdc \u5267\u60c5\u7ebf\u7d22\u677f <span class="bdg">'+(threads.length||0)+' \u6761\u6d3b\u8dc3</span></div>';
    if (threads.length) {
      html += '<div class="plt-grid">';
      for (var pi = 0; pi < Math.min(threads.length, 6); pi++) {
        var t = threads[pi];
        var clrMap = {active:'#f0c040',completed:'#238636',paused:'#8b949e',failed:'#f85149'};
        var clr = clrMap[t.status] || '#58a6ff';
        html += '<div class="plt-item" style="border-left-color:'+clr+';">';
        html += '<div style="font-weight:600;font-size:12px;">'+esc(t.title||t.name||'')+'</div>';
        html += '<div class="sm gray">\u72b6\u6001\uff1a'+(t.status||'\u8fdb\u884c\u4e2d')+' \u00b7 '+(t.phase||'')+'</div>';
        if (t.participants && t.participants.length) html += '<div class="sm gray">\u5173\u8054\uff1a'+t.participants.slice(0,3).join(' \u00b7 ')+'</div>';
        html += '<button class="btn btn-sm mt-8 world-engine-thread-advance" data-thread-id="'+esc(t.id||t.name||pi)+'">\ud83d\udccc \u63a8\u8fdb\u9636\u6bb5</button>';
        html += '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="sm gray">\u6682\u65e0\u4e3b\u52a8\u5267\u60c5\u7ebf\u7d22</div>';
    }
    html += '<div class="fa"><button class="btn btn-sm" id="world-engine-new-thread">\u2795 \u65b0\u5efa\u5267\u60c5\u7ebf\u7d22</button></div></div>';

    // portraits
    var portraits = state.characterPortraits || {};
    var pKeys = Object.keys(portraits);
    html += '<div class="card"><div class="card-title">\ud83d\uddbc\ufe0f \u89d2\u8272\u753b\u50cf <span class="bdg">\u81ea\u52a8\u521b\u5efa</span></div>';
    if (pKeys.length > 0) {
      html += '<div class="port-grid">';
      for (var pi2 = 0; pi2 < Math.min(pKeys.length, 8); pi2++) {
        var p = portraits[pKeys[pi2]];
        html += '<div class="port-card world-engine-portrait-card" data-char="'+esc(pKeys[pi2])+'"><div style="font-size:26px;">'+(p.emoji||'\ud83d\udc64')+'</div>';
        html += '<div style="font-size:11px;font-weight:600;">'+esc(pKeys[pi2])+'</div>';
        html += '<div class="sm gray">'+(p.relation||'NPC')+(p.attitude!==undefined?' \u00b7 \u6001\u5ea6 '+(parseInt(p.attitude)>=0?'+':'')+p.attitude:'')+'</div>';
        if (p.personality) html += '<div class="sm gray">'+esc(p.personality)+'</div>';
        html += '<div style="display:flex;gap:2px;margin-top:4px;justify-content:center;"><button class="btn btn-sm world-engine-portrait-edit" data-char="'+esc(pKeys[pi2])+'" style="font-size:9px;padding:1px 4px;">\u270e</button>';
        html += '<button class="btn btn-sm world-engine-portrait-del" data-char="'+esc(pKeys[pi2])+'" style="font-size:9px;padding:1px 4px;color:#f85149;">\u2716</button></div>';
        html += '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="sm gray" style="text-align:center;padding:12px;">\u6682\u65e0\u89d2\u8272\u753b\u50cf\u3002\u4e0e\u4e16\u754c\u4e2d\u7684\u89d2\u8272\u4e92\u52a8\u540e\uff0c\u753b\u50cf\u5c06\u81ea\u52a8\u751f\u6210\u3002</div>';
    }
    html += '<div class="fa"><button class="btn btn-sm" id="world-engine-create-portrait">\u2795 \u624b\u52a8\u521b\u5efa\u753b\u50cf</button></div></div>';

    // combat log
    var combat = state.combat || {};
    html += '<div class="card"><div class="card-title">\u2694\ufe0f \u6218\u6597\u65e5\u5fd7 <span class="bdg">'+(combat.totalBattles||0)+' \u573a\u6218\u6597</span></div>';
    var combatLog = combat.log || [];
    if (combatLog.length) {
      html += '<div class="tl">';
      for (var ci = Math.max(0, combatLog.length-4); ci < combatLog.length; ci++) {
        var cl = combatLog[ci];
        html += '<div class="tl-i"><div class="rnd">#'+(cl.round||'?')+'</div><div class="txt">'+esc(cl.desc||cl.summary||'')+'</div></div>';
      }
      html += '</div>';
    } else {
      html += '<div class="sm gray">\u6682\u65e0\u6218\u6597\u8bb0\u5f55</div>';
    }
    html += '<div class="mt-8 flex" style="justify-content:space-between;align-items:center;"><span class="sm gray">\u603b\u6218\u6597\uff1a'+(combat.totalBattles||0)+' \u00b7 \u80dc\u7387 '+(combat.totalBattles?Math.round((combat.wins||0)/combat.totalBattles*100):0)+'% \u00b7 \u8fde\u6740 '+(combat.currentStreak||0)+' \u00b7 Boss \u51fb\u6740 '+(combat.bossesDefeated?combat.bossesDefeated.length:0)+'</span>';
    html += '<span class="flex" style="gap:4px;"><button class="btn btn-sm" id="world-engine-combat-add" style="font-size:9px;padding:2px 6px;">\u2795 \u6dfb\u52a0\u6218\u6597\u65e5\u5fd7</button>';
    html += '<button class="btn btn-sm" id="world-engine-combat-clear" style="font-size:9px;padding:2px 6px;color:#f85149;">\ud83d\uddd1\ufe0f \u6e05\u7a7a\u65e5\u5fd7</button></span></div></div>';

    // world analysis
    html += '<div class="card"><div class="card-title">\ud83d\udd0d \u4e16\u754c\u5206\u6790 <span class="bdg">AI \u589e\u5f3a</span></div>';
    html += '<div style="background:#0d1117;border-radius:6px;padding:8px;border:1px solid #21262d;font-size:11px;color:#e6edf3;">';
    html += '<div class="sm gray">\u5206\u6790\u7ed3\u679c\uff1a</div><div class="sm" style="color:#e6edf3;margin-top:2px;">'+(state.worldDigest||'\u6682\u65e0\u5206\u6790\u7ed3\u679c')+'</div></div>';
    html += '<div class="fa"><button class="btn" id="world-engine-analyze">\ud83d\udd04 \u91cd\u65b0\u5206\u6790</button></div></div>';

    cont.innerHTML = html;

    // bind events
    setTimeout(function(){
      var saveStory = document.getElementById('world-engine-save-story');
      if (saveStory) {
        saveStory.addEventListener('click', function(){
          var tmpl = document.getElementById('world-engine-story-template');
          var tone = document.getElementById('world-engine-story-tone');
          var autoCb = document.getElementById('world-engine-phase-auto-toggle');
          var customTone = document.getElementById('world-engine-custom-tone');
          var st = core.loadState();
          st.storyTemplate = st.storyArc = tmpl ? tmpl.options[tmpl.selectedIndex].text : '\u82f1\u96c4\u4e4b\u65c5';
          st.storyTone = st.tone = tone ? tone.options[tone.selectedIndex].text : '\u53f2\u8bd7\u58ee\u9614';
          if (!st.storyType) st.storyType = {};
          st.storyType.enablePhaseProgression = autoCb ? autoCb.checked : true;
          if (customTone) st.storyType.customToneText = customTone.value;
          core.saveState(st);
          toast('\u2705 \u6545\u4e8b\u8bbe\u7f6e\u5df2\u4fdd\u5b58');
          requestConfigApply('story-settings');
        });
      }
      // \u65b0\u5efa\u5267\u60c5\u7ebf\u7d22
      var nt = document.getElementById('world-engine-new-thread');
      if (nt) nt.addEventListener('click', function(){
        var name = prompt('\u8bf7\u8f93\u5165\u5267\u60c5\u7ebf\u7d22\u540d\u79f0\uff1a');
        if (!name) return;
        var st = core.loadState();
        if (!st.plotThreads) st.plotThreads = [];
        st.plotThreads.push({ title: name, status: 'active', participants: [], createdRound: st.round || 0 });
        core.saveState(st);
        toast('\u2705 \u5df2\u521b\u5efa\u5267\u60c5\u7ebf\u7d22\uff1a' + name);
      });
      // \u624b\u52a8\u521b\u5efa\u753b\u50cf
      var cp = document.getElementById('world-engine-create-portrait');
      if (cp) cp.addEventListener('click', function(){
        var name = prompt('\u8bf7\u8f93\u5165\u89d2\u8272\u540d\uff1a');
        if (!name) return;
        var st = core.loadState();
        if (!st.characterPortraits) st.characterPortraits = {};
        st.characterPortraits[name] = { emoji: '\ud83e\uddd1', relation: 'NPC', attitude: 0, personality: '', tags: [] };
        core.saveState(st);
        toast('\u2705 \u5df2\u521b\u5efa\u89d2\u8272\u753b\u50cf\uff1a' + name);
      });
      // \u91cd\u65b0\u5206\u6790
      var an = document.getElementById('world-engine-analyze');
      if (an) an.addEventListener('click', async function(){
        if (!evolution || typeof evolution.evolve !== 'function') { toast('\u26a0\ufe0f \u6f14\u5316\u6a21\u5757\u672a\u52a0\u8f7d', true); return; }
        this.disabled = true; this.textContent = '\u23f3 \u5206\u6790\u4e2d...';
        try {
          var st = core.loadState();
          var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
          var lastMsg = ctx && ctx.chat ? ctx.chat[ctx.chat.length - 1] : null;
          var userMsg = lastMsg && lastMsg.is_user ? (lastMsg.mes||'') : '';
          var aiMsg = lastMsg && !lastMsg.is_user ? (lastMsg.mes||'') : '';
          var success = await evolution.evolve(st, userMsg, aiMsg);
          toast(success ? '\u2705 \u4e16\u754c\u5206\u6790\u5df2\u5b8c\u6210' : '\u26a0\ufe0f \u5206\u6790\u5931\u8d25', !success);
          if (success) refresh();
        } catch(e) { toast('\u5206\u6790\u5f02\u5e38: '+e.message, true); }
        this.disabled = false; this.innerHTML = '\ud83d\udd04 \u91cd\u65b0\u5206\u6790';
      });
      // \u63a8\u8fdb\u5267\u60c5\u7ebf\u7d22\u9636\u6bb5
      document.querySelectorAll('.world-engine-thread-advance').forEach(function(btn){
        btn.addEventListener('click', function(){
          var tid = this.getAttribute('data-thread-id');
          if (!tid) { toast('\u26a0\u9519\u8bef\uff1a\u65e0\u6548\u7684\u5267\u60c5\u7ebf\u7d22 ID', true); return; }
          var st = core.loadState();
          if (typeof core.updatePlotThreadProgress === 'function') {
            core.updatePlotThreadProgress(st, tid);
            core.saveState(st);
            toast('\u2705 \u5267\u60c5\u7ebf\u7d22\u5df2\u63a8\u8fdb: '+tid);
            refresh();
          } else {
            // fallback: \u624b\u52a8\u64cd\u4f5c state
            var threads = st.plotThreads || [];
            for (var ti = 0; ti < threads.length; ti++) {
              if (threads[ti].id === tid || threads[ti].name === tid) {
                threads[ti].progress = (threads[ti].progress||0) + 1;
                if (threads[ti].progress >= (threads[ti].maxProgress||3)) threads[ti].status = 'completed';
                break;
              }
            }
            core.saveState(st);
            toast('\u2705 \u5267\u60c5\u7ebf\u7d22\u5df2\u63a8\u8fdb');
            refresh();
          }
        });
      });
      // portrait edit
      document.querySelectorAll('.world-engine-portrait-edit').forEach(function(btn){
        btn.addEventListener('click', function(){
          var charName = this.getAttribute('data-char');
          if (!charName) return;
          var st = core.loadState();
          var pts = st.characterPortraits || {};
          var p = pts[charName];
          if (!p) { toast('\u26a0\ufe0f \u627e\u4e0d\u5230\u753b\u50cf', true); return; }
          var newEmoji = prompt('\u4fee\u6539\u5934\u50cf emoji\uff08\u5f53\u524d\uff1a'+p.emoji+'):', p.emoji);
          if (newEmoji === null) return;
          var newRelation = prompt('\u4fee\u6539\u5173\u7cfb\uff08\u5f53\u524d\uff1a'+p.relation+'):', p.relation);
          if (newRelation === null) return;
          var newAtt = prompt('\u4fee\u6539\u6001\u5ea6\u503c\uff08\u5f53\u524d\uff1a'+p.attitude+'):', p.attitude);
          if (newAtt === null) return;
          var newPersonality = prompt('\u4fee\u6539\u4e2a\u6027\u63cf\u8ff0\uff08\u5f53\u524d\uff1a'+(p.personality||'')+'):', p.personality||'');
          if (newPersonality === null) return;
          p.emoji = newEmoji.trim();
          p.relation = newRelation.trim();
          p.attitude = parseInt(newAtt) || 0;
          p.personality = newPersonality.trim();
          core.saveState(st);
          toast('\u2705 \u753b\u50cf\u5df2\u66f4\u65b0: '+charName);
          refresh();
        });
      });
      // portrait delete
      document.querySelectorAll('.world-engine-portrait-del').forEach(function(btn){
        btn.addEventListener('click', function(){
          var charName = this.getAttribute('data-char');
          if (!charName) return;
          if (!confirm('\u786e\u5b9a\u5220\u9664 '+charName+' \u7684\u753b\u50cf\uff1f')) return;
          var st = core.loadState();
          var pts = st.characterPortraits || {};
          delete pts[charName];
          core.saveState(st);
          toast('\u2705 \u753b\u50cf\u5df2\u5220\u9664: '+charName);
          refresh();
        });
      });
      // combat add
      var cbAdd = document.getElementById('world-engine-combat-add');
      if (cbAdd) cbAdd.addEventListener('click', function(){
        var desc = prompt('\u8bf7\u8f93\u5165\u6218\u6597\u63cf\u8ff0\uff1a');
        if (!desc) return;
        var st = core.loadState();
        if (!st.combat) st.combat = {};
        if (!st.combat.log) st.combat.log = [];
        st.combat.log.push({ round: st.round||0, desc: desc, timestamp: Date.now() });
        st.combat.totalBattles = (st.combat.totalBattles||0) + 1;
        core.saveState(st);
        toast('\u2705 \u5df2\u6dfb\u52a0\u6218\u6597\u65e5\u5fd7');
        refresh();
      });
      // combat clear
      var cbClear = document.getElementById('world-engine-combat-clear');
      if (cbClear) cbClear.addEventListener('click', function(){
        if (!confirm('\u786e\u5b9a\u6e05\u7a7a\u6240\u6709\u6218\u6597\u65e5\u5fd7\uff1f')) return;
        var st = core.loadState();
        if (st.combat) st.combat.log = [];
        core.saveState(st);
        toast('\u2705 \u6218\u6597\u65e5\u5fd7\u5df2\u6e05\u7a7a');
        refresh();
      });
    }, 50);
  }

  /* ═══════════════════ WORLDBOOK ═══════════════════ */
  function renderWorldbook(cont) {
    var _aa = window.WORLD_ENGINE_STORAGE.getItem('world_engine_wb_autoActivate') === 'true';
    var html = '';
    html += '<div class="guide-box"><div class="gt">\ud83d\udcda \u4e16\u754c\u4e66\u6d4f\u89c8\u5668</div><div class="gd">\u4e0b\u62c9\u6846\u9009\u4e66 \u2192 \u6fc0\u6d3b \u2192 \u52fe\u9009\u6761\u76ee \u2192 \u4fdd\u5b58\u3002\u7cbe\u7ec6\u63a7\u5236\u54ea\u4e9b\u4e16\u754c\u4e66\u3001\u54ea\u4e9b\u6761\u76ee\u6ce8\u5165 AI \u4e0a\u4e0b\u6587\u3002</div></div>';

    // ===== \u4e0b\u62c9\u6846\u9009\u62e9\u4e16\u754c\u4e66 =====
    html += '<div class="card"><div class="card-title">\ud83d\udcd6 \u9009\u62e9\u4e16\u754c\u4e66 <span class="bdg" id="world-engine-wb-selected-count">0 \u672c\u5df2\u9009</span></div>';
    html += '<div class="fg"><label>\u4e16\u754c\u4e66\uff08\u4e0b\u62c9\u9009\u62e9\uff0c\u641c\u7d22\u6846\u53ef\u8fc7\u6ee4\uff09</label>';
    html += '<select id="world-engine-wb-select" style="width:100%;padding:6px 10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:12px;font-family:inherit;">';
    html += '<option value="">\u2014 \u8bf7\u9009\u62e9\u4e16\u754c\u4e66 \u2014</option>';
    html += '</select></div>';
    html += '<div class="flex" style="gap:4px;flex-wrap:wrap;">';
    html += '<button class="btn btn-sm btn-success" id="world-engine-wb-activate-selected">\u2705 \u6fc0\u6d3b\u5f53\u524d\u4e66</button>';
    html += '<button class="btn btn-sm btn-danger" id="world-engine-wb-deactivate-selected">\u274c \u53d6\u6d88\u5f53\u524d\u4e66</button>';
    html += '<button class="btn btn-sm" id="world-engine-wb-activate-all">\u2705 \u5168\u90e8\u6fc0\u6d3b</button>';
    html += '<button class="btn btn-sm" id="world-engine-wb-deactivate-all">\u274c \u5168\u90e8\u53d6\u6d88</button>';
    html += '<button class="btn btn-primary" id="world-engine-save-wb">\ud83d\udcbe \u4fdd\u5b58\u4e66\u7ea7\u9009\u62e9</button>';
    html += '<button class="btn btn-sm" id="world-engine-refresh-wb">\ud83d\udd04 \u5237\u65b0\u5217\u8868</button>';
    html += '</div>';
    html += '<div class="fg mt-8"><label>\u641c\u7d22\u4e16\u754c\u4e66</label><input type="text" id="world-engine-wb-search" placeholder="\u8f93\u5165\u4e66\u540d\u4e2d\u65ad\u7eed..." style="width:100%;padding:6px 10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:12px;box-sizing:border-box;"></div>';
    html += '<div class="sm gray mt-8">\u4e0b\u62c9\u9009\u4e66 \u2192 \u70b9\u300c\u6fc0\u6d3b\u5f53\u524d\u4e66\u300d \u2192 \u4e0b\u65b9\u81ea\u52a8\u663e\u793a\u8be5\u4e66\u7684\u62d8\u53e0\u6761\u76ee\u5217\u8868\u3002\u5982\u6709\u591a\u672c\u6fc0\u6d3b\uff0c\u6bcf\u672c\u5404\u81ea\u62d8\u53e0\u3002</div></div>';

    // ===== \u6761\u76ee\u7ea7\u9009\u62e9（\u6bcf\u672c\u5df2\u6fc0\u6d3b\u4e66\u5404\u81ea\u62d8\u53e0\u628a\u5408\u53e0 =====
    html += '<div class="card" id="world-engine-wb-entries-card"><div class="card-title">\ud83d\udcd1 \u6761\u76ee\u7ea7\u9009\u62e9 <span class="bdg">\u5df2\u6fc0\u6d3b\u7684\u4e66\u5404\u81ea\u53ef\u62d8\u53e0</span></div>';
    html += '<div id="world-engine-wb-entries-container">';
    html += '<div class="sm gray" style="padding:10px 0;" id="world-engine-wb-entries-empty">\u6682\u65e0\u5df2\u6fc0\u6d3b\u4e16\u754c\u4e66\uff0c\u8bf7\u5148\u5728\u4e0a\u65b9\u6fc0\u6d3b</div>';
    html += '</div>';
    html += '<div class="flex mt-8" style="gap:4px;">';
    html += '<button class="btn btn-primary" id="world-engine-save-wb-entries">\ud83d\udcbe \u4fdd\u5b58\u5168\u90e8\u6761\u76ee\u9009\u62e9</button>';
    html += '<button class="btn btn-sm" id="world-engine-refresh-entries">\ud83d\udd04 \u5237\u65b0\u6761\u76ee</button>';
    html += '</div></div>';

    // ===== \u7edf\u8ba1 =====
    html += '<div class="card"><div class="card-title">\ud83d\udccb \u6d3b\u52a8\u6761\u76ee\u7edf\u8ba1</div>';
    html += '<div class="flex"><span class="gray">\u603b\u4e16\u754c\u4e66\uff1a</span><span id="world-engine-wb-stats-books">0 \u672c</span></div>';
    html += '<div class="flex"><span class="gray">\u5df2\u6fc0\u6d3b\u4e66\uff1a</span><span id="world-engine-wb-stats-active-books">0 \u672c</span></div>';
    html += '<div class="flex"><span class="gray">\u6709\u6761\u76ee\u914d\u7f6e\u7684\u4e66\uff1a</span><span id="world-engine-wb-stats-entry-books">0 \u672c</span></div>';
    html += '<div class="flex mt-4" style="align-items:center;gap:6px;"><label style="font-size:11px;color:#8b949e;cursor:pointer;"><input type="checkbox" id="world-engine-wb-auto-activate"'+(_aa?' checked':'')+' style="accent-color:#238636;"> \u5207\u6362\u4e16\u754c\u4e66/\u573a\u666f\u65f6\u81ea\u52a8\u6fc0\u6d3b</label></div>';
    html += '<div class="fa mt-8"><button class="btn btn-sm" id="world-engine-wb-analyze">\ud83e\udde0 AI \u5206\u6790\u4e16\u754c\u4e66\u5173\u8054\u6027</button></div></div>';

    cont.innerHTML = html;

    // \u7f13\u5b58\u4e16\u754c\u4e66\u5143\u6570\u636e\uff08\u7528\u4e8e\u4e0b\u62c9\u6846\u663e\u793a\u6761\u76ee\u6570\uff09
    var _bookMetaCache = [];

    function escId(s) { return String(s).replace(/[&<>"\'\\]/g, function(m){ return ''; }); }

    // \u5237\u65b0\u7edf\u8ba1
    function updateStats() {
      try {
        var bookSel = (typeof worldbook.getBookSelection === 'function') ? worldbook.getBookSelection() : {};
        var entryMap = (typeof worldbook.getActiveEntryMap === 'function') ? worldbook.getActiveEntryMap() : {};
        var activeCount = 0;
        for (var k in bookSel) { if (bookSel[k]) activeCount++; }
        var entryBookCount = 0;
        for (var ek in entryMap) { entryBookCount++; }
        var selectEl = document.getElementById('world-engine-wb-select');
        var totalBooks = selectEl ? selectEl.options.length - 1 : 0;
        var elB = document.getElementById('world-engine-wb-stats-books');
        var elAB = document.getElementById('world-engine-wb-stats-active-books');
        var elEB = document.getElementById('world-engine-wb-stats-entry-books');
        var elCnt = document.getElementById('world-engine-wb-selected-count');
        if (elB) elB.textContent = totalBooks + ' \u672c';
        if (elAB) elAB.textContent = activeCount + ' \u672c';
        if (elEB) elEB.textContent = entryBookCount + ' \u672c';
        if (elCnt) elCnt.textContent = activeCount + ' \u672c\u5df2\u9009';
      } catch(e) {}
    }

    // \u52a0\u8f7d\u4e16\u754c\u4e66\u4e0b\u62c9\u6846
    async function loadWbDropdown() {
      if (!worldbook || typeof worldbook.getAvailableBooks !== 'function') return;
      try {
        var books = await worldbook.getAvailableBooks();
        _bookMetaCache = books || [];
        var bookSel = (typeof worldbook.getBookSelection === 'function') ? worldbook.getBookSelection() : {};
        var selectEl = document.getElementById('world-engine-wb-select');
        if (!selectEl) return;
        while (selectEl.options.length > 1) selectEl.remove(1);
        if (!books || !books.length) {
          var def = document.createElement('option');
          def.value = ''; def.textContent = '\u2014 \u65e0\u53ef\u7528\u4e16\u754c\u4e66 \u2014';
          selectEl.appendChild(def);
          return;
        }
        for (var i = 0; i < books.length; i++) {
          var opt = document.createElement('option');
          opt.value = books[i].name;
          var isActivated = bookSel && bookSel[books[i].name];
          opt.textContent = books[i].name + ' (' + (books[i].entryCount || '?') + '\u6761)' + (isActivated ? ' \u2705' : '');
          selectEl.appendChild(opt);
        }

        updateStats();
      } catch(e) { console.warn('[World Engine UI] \u52a0\u8f7d\u4e16\u754c\u4e66\u4e0b\u62c9\u5931\u8d25', e); }
    }

    // ========== \u52a0\u8f7d\u5df2\u6fc0\u6d3b\u4e66\u7684\u6240\u6709\u6761\u76ee\uff0c\u6309\u4e66\u62d8\u53e0\u663e\u793a ==========
    var _entriesCache = {}; // { bookName: [entries] }

    async function renderAllBookEntries() {
      var container = document.getElementById('world-engine-wb-entries-container');
      var emptyEl = document.getElementById('world-engine-wb-entries-empty');
      if (!container) return;
      var bookSel = (typeof worldbook.getBookSelection === 'function') ? worldbook.getBookSelection() : {};
      var activatedBooks = [];
      for (var bk in bookSel) { if (bookSel[bk]) activatedBooks.push(bk); }
      if (activatedBooks.length === 0) {
        container.innerHTML = '<div class="sm gray" style="padding:10px 0;" id="world-engine-wb-entries-empty">\u6682\u65e0\u5df2\u6fc0\u6d3b\u4e16\u754c\u4e66\uff0c\u8bf7\u5148\u5728\u4e0a\u65b9\u6fc0\u6d3b</div>';
        return;
      }
      // \u663e\u793a\u52a0\u8f7d\u4e2d
      container.innerHTML = '<div class="sm gray" style="padding:10px 0;">\u23f3 \u52a0\u8f7d\u6761\u76ee...</div>';
      try {
        // \u5e76\u884c\u52a0\u8f7d\u6240\u6709\u5df2\u6fc0\u6d3b\u4e66\u7684\u6761\u76ee
        var loadPromises = activatedBooks.map(function(bn) { return worldbook.getBookEntries(bn); });
        var results = await Promise.all(loadPromises);
        _entriesCache = {};
        for (var ri = 0; ri < activatedBooks.length; ri++) {
          _entriesCache[activatedBooks[ri]] = results[ri] || [];
        }
        var entryMap = (typeof worldbook.getActiveEntryMap === 'function') ? worldbook.getActiveEntryMap() : {};
        var ehtml = '';
        for (var bi = 0; bi < activatedBooks.length; bi++) {
          var bn = activatedBooks[bi];
          var entries = _entriesCache[bn] || [];
          var bookEntrySel = entryMap ? entryMap[bn] : null;
          // \u8ba1\u7b97\u5df2\u9009\u6761\u76ee\u6570
          var selectedCount = 0;
          for (var ei = 0; ei < entries.length; ei++) {
            var entry = entries[ei];
            var isSel = true;
            if (bookEntrySel) {
              if (bookEntrySel.allSelected === true) isSel = true;
              else if (Array.isArray(bookEntrySel.selectedIndices)) isSel = bookEntrySel.selectedIndices.indexOf(entry.index) >= 0;
            }
            if (isSel) selectedCount++;
          }
          var sectionId = 'world-engine-wb-book-' + bi;
          ehtml += '<div class="wb-book-section" style="margin-bottom:8px;border:1px solid #30363d;border-radius:8px;overflow:hidden;">';
          // \u6807\u9898\u680f\uff08\u53ef\u70b9\u51fb\u62d8\u53e0\uff09
          ehtml += '<div class="wb-book-header" data-section="' + sectionId + '" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#1c2331;cursor:pointer;user-select:none;">';
          ehtml += '<span class="wb-book-arrow" style="transition:transform .2s;font-size:12px;color:#8b949e;">\u25b6</span>';
          ehtml += '<span style="font-weight:600;font-size:12.5px;color:#e6edf3;">' + esc(bn) + '</span>';
          ehtml += '<span class="sm gray">(' + entries.length + '\u6761\uff0c\u5df2\u9009 ' + selectedCount + '\u6761)</span>';
          ehtml += '<div style="margin-left:auto;display:flex;gap:4px;">';
          ehtml += '<button class="btn btn-sm btn-success wb-book-select-all" data-book="' + escId(bn) + '" style="font-size:10px;">\u5168\u9009</button>';
          ehtml += '<button class="btn btn-sm btn-danger wb-book-deselect-all" data-book="' + escId(bn) + '" style="font-size:10px;">\u53d6\u6d88</button>';
          ehtml += '</div></div>';
          // \u6761\u76ee\u5217\u8868\uff08\u9ed8\u8ba4\u6536\u8d77\uff09
          ehtml += '<div id="' + sectionId + '" class="wb-book-entries" style="display:none;padding:8px 12px;border-top:1px solid #21262d;">';
          if (!entries || entries.length === 0) {
            ehtml += '<div class="sm gray">\u6ca1\u6709\u53ef\u7528\u6761\u76ee</div>';
          } else {
            for (var ei = 0; ei < entries.length; ei++) {
              var entry = entries[ei];
              var isSel = true;
              if (bookEntrySel) {
                if (bookEntrySel.allSelected === true) isSel = true;
                else if (Array.isArray(bookEntrySel.selectedIndices)) isSel = bookEntrySel.selectedIndices.indexOf(entry.index) >= 0;
              }
              var contentPreview = entry.content || '';
              if (contentPreview.length > 100) contentPreview = contentPreview.substring(0, 100) + '...';
              ehtml += '<div class="tl-i" style="border-left:3px solid ' + (isSel ? '#238636' : '#30363d') + ';margin-bottom:3px;">';
              ehtml += '<div style="display:flex;gap:4px;align-items:flex-start;">';
              ehtml += '<input type="checkbox" class="wb-entry-cb" data-book="' + escId(bn) + '" data-entry-index="' + entry.index + '" ' + (isSel ? 'checked' : '') + ' style="accent-color:#238636;margin-top:2px;flex-shrink:0;">';
              ehtml += '<div style="flex:1;min-width:0;">';
              ehtml += '<div style="font-weight:600;font-size:11px;">' + esc(entry.comment || '\u6761\u76ee #' + (entry.index + 1)) + '</div>';
              ehtml += '<div class="sm gray" style="margin-top:2px;font-size:10px;word-break:break-all;">' + esc(contentPreview) + '</div>';
              if (entry.tags && entry.tags.length) {
                ehtml += '<div style="margin-top:2px;">';
                for (var ti = 0; ti < entry.tags.length; ti++) {
                  ehtml += '<span class="tag tag-ent">' + esc(entry.tags[ti]) + '</span>';
                }
                ehtml += '</div>';
              }
              ehtml += '</div></div></div>';
            }
          }
          ehtml += '</div></div>'; // end book section
        }
        container.innerHTML = ehtml;
        updateStats();
      } catch(e) {
        console.warn('[World Engine UI] \u52a0\u8f7d\u6761\u76ee\u5931\u8d25', e);
        container.innerHTML = '<div class="sm gray" style="padding:10px 0;color:#f85149;">\u274c \u52a0\u8f7d\u6761\u76ee\u5931\u8d25</div>';
      }
    }

    // \u66f4\u65b0\u4e0b\u62c9\u6846\u9009\u9879\u6587\u672c\uff08\u53cd\u6620\u6fc0\u6d3b\u72b6\u6001\uff09
    function updateDropdownText(bookName, activated) {
      var select = document.getElementById('world-engine-wb-select');
      if (!select) return;
      for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].value === bookName) {
          // \u4fdd\u7559\u539f\u59cb\u540d\u79f0\uff08\u65e0\u2705\u540e\u7f00\uff09
          var rawName = bookName;
          // \u4ece\u7f13\u5b58\u83b7\u53d6\u6761\u76ee\u6570
          var entryCount = '?';
          for (var mi = 0; mi < _bookMetaCache.length; mi++) {
            if (_bookMetaCache[mi].name === bookName) {
              entryCount = _bookMetaCache[mi].entryCount;
              break;
            }
          }
          select.options[i].textContent = rawName + ' (' + entryCount + '\u6761)' + (activated ? ' \u2705' : '');
          break;
        }
      }
    }

    // ========== \u4e8b\u4ef6\u7ed1\u5b9a ==========
    setTimeout(function() {
      // \u641c\u7d22 = \u8fc7\u6ee4\u4e0b\u62c9\u6846\u9009\u9879
      var searchEl = document.getElementById('world-engine-wb-search');
      if (searchEl) {
        searchEl.addEventListener('input', function() {
          var kw = this.value.trim().toLowerCase();
          var select = document.getElementById('world-engine-wb-select');
          if (!select) return;
          for (var i = 1; i < select.options.length; i++) {
            var txt = select.options[i].text.toLowerCase();
            select.options[i].style.display = (!kw || txt.indexOf(kw) >= 0) ? '' : 'none';
          }
        });
      }

      // \u6fc0\u6d3b\/\u53d6\u6d88\uff1a\u64cd\u4f5c\u540e\u91cd\u6620\u6761\u76ee\u5217\u8868
      function refreshEntriesAfterActivation() {
        renderAllBookEntries();
      }

      // ========== guard: \u7ed1\u5b9a\u53ea\u8dd1\u4e00\u6b21\uff08\u5143\u7d20\u7ea7\u4e8b\u4ef6\u6bcf\u6b21\u91cd\u65b0\u7ed1\uff0c\u56e0\u4e3ainnerHTML\u66ff\u6362\u4e86\u65e7DOM\u5143\u7d20\uff09==========
      // \u4ec5\u9632\u6b62 document \u7ea7\u59d4\u6258\u4e8b\u4ef6\u5806\u79ef
      var _world_engine_wb_no_rebind = window._world_engine_wb_doc_bound;

      var actSel = document.getElementById('world-engine-wb-activate-selected');
      if (actSel) {
        actSel.addEventListener('click', function() {
          var select = document.getElementById('world-engine-wb-select');
          if (!select || !select.value) { toast('\u26a0\ufe0f \u8bf7\u5148\u9009\u62e9\u4e00\u672c\u4e16\u754c\u4e66', true); return; }
          var bookSel = (typeof worldbook.getBookSelection === 'function') ? worldbook.getBookSelection() : {};
          bookSel[select.value] = true;
          if (typeof worldbook.setBookSelection === 'function') worldbook.setBookSelection(bookSel);
          updateDropdownText(select.value, true);
          updateStats();
          refreshEntriesAfterActivation();
          toast('\u2705 \u5df2\u6fc0\u6d3b\uff1a' + select.value);
        });
      }

      var deactSel = document.getElementById('world-engine-wb-deactivate-selected');
      if (deactSel) {
        deactSel.addEventListener('click', function() {
          var select = document.getElementById('world-engine-wb-select');
          if (!select || !select.value) { toast('\u26a0\ufe0f \u8bf7\u5148\u9009\u62e9\u4e00\u672c\u4e16\u754c\u4e66', true); return; }
          var bookSel = (typeof worldbook.getBookSelection === 'function') ? worldbook.getBookSelection() : {};
          bookSel[select.value] = false;
          if (typeof worldbook.setBookSelection === 'function') worldbook.setBookSelection(bookSel);
          updateDropdownText(select.value, false);
          updateStats();
          refreshEntriesAfterActivation();
          toast('\u274c \u5df2\u53d6\u6d88\u6fc0\u6d3b\uff1a' + select.value);
        });
      }

      var actAll = document.getElementById('world-engine-wb-activate-all');
      if (actAll) {
        actAll.addEventListener('click', function() {
          var bookSel = {};
          var select = document.getElementById('world-engine-wb-select');
          if (select) {
            for (var i = 1; i < select.options.length; i++) {
              if (select.options[i].value) {
                bookSel[select.options[i].value] = true;
              }
            }
          }
          if (typeof worldbook.setBookSelection === 'function') worldbook.setBookSelection(bookSel);
          if (select) {
            for (var j = 1; j < select.options.length; j++) {
              if (select.options[j].value) updateDropdownText(select.options[j].value, true);
            }
          }
          updateStats();
          refreshEntriesAfterActivation();
          toast('\u2705 \u5df2\u5168\u90e8\u6fc0\u6d3b');
        });
      }

      var deactAll = document.getElementById('world-engine-wb-deactivate-all');
      if (deactAll) {
        deactAll.addEventListener('click', function() {
          if (typeof worldbook.setBookSelection === 'function') worldbook.setBookSelection({});
          var select = document.getElementById('world-engine-wb-select');
          if (select) {
            for (var i = 1; i < select.options.length; i++) {
              if (select.options[i].value) updateDropdownText(select.options[i].value, false);
            }
          }
          updateStats();
          refreshEntriesAfterActivation();
          toast('\u274c \u5df2\u5168\u90e8\u53d6\u6d88');
        });
      }

      var saveWb = document.getElementById('world-engine-save-wb');
      if (saveWb) {
        saveWb.addEventListener('click', function() {
          var bookSel = (typeof worldbook.getBookSelection === 'function') ? worldbook.getBookSelection() : {};
          var count = 0;
          for (var k in bookSel) { if (bookSel[k]) count++; }
          var st = core.loadState();
          st.selectedWorldbooks = [];
          for (var bk in bookSel) { if (bookSel[bk]) st.selectedWorldbooks.push(bk); }
          core.saveState(st);
          toast('\u2705 \u5df2\u4fdd\u5b58 ' + count + ' \u672c\u4e16\u754c\u4e66\u9009\u62e9');
        });
      }

      // \u5237\u65b0\u5217\u8868
      var refreshBtn = document.getElementById('world-engine-refresh-wb');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
          loadWbDropdown().then(function() {
            renderAllBookEntries();
          });
          toast('\ud83d\udd04 \u4e16\u754c\u4e66\u5217\u8868\u5df2\u5237\u65b0');
        });
      }

      // \u6761\u76ee\u62d8\u53e0\u5207\u6362\uff1a\u70b9\u51fb\u6807\u9898\u680f\u5c55\u5f00/\u6536\u8d77
      if (!_world_engine_wb_no_rebind) {
        window._world_engine_wb_doc_bound = true;
      document.addEventListener('click', function(e) {
        var header = e.target.closest('.wb-book-header');
        if (header) {
          var sectionId = header.getAttribute('data-section');
          var section = document.getElementById(sectionId);
          var arrow = header.querySelector('.wb-book-arrow');
          if (section) {
            var isOpen = section.style.display !== 'none';
            section.style.display = isOpen ? 'none' : 'block';
            if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
          }
          return;
        }
        // \u5355\u4e66\u5168\u9009
        var selBtn = e.target.closest('.wb-book-select-all');
        if (selBtn) {
          var bookName = selBtn.getAttribute('data-book');
          var section = selBtn.closest('.wb-book-section');
          if (section) {
            section.querySelectorAll('.wb-entry-cb').forEach(function(cb) {
              cb.checked = true;
              var item = cb.closest('.tl-i');
              if (item) item.style.borderLeftColor = '#238636';
            });
          }
          toast('\u2705 ' + esc(bookName) + ' \u5168\u9009');
          return;
        }
        // \u5355\u4e66\u53d6\u6d88\u5168\u9009
        var deselBtn = e.target.closest('.wb-book-deselect-all');
        if (deselBtn) {
          var section = deselBtn.closest('.wb-book-section');
          if (section) {
            section.querySelectorAll('.wb-entry-cb').forEach(function(cb) {
              cb.checked = false;
              var item = cb.closest('.tl-i');
              if (item) item.style.borderLeftColor = '#30363d';
            });
          }
          toast('\u274c \u5df2\u53d6\u6d88');
          return;
        }
      });
      }

      // \u4fdd\u5b58\u5168\u90e8\u6761\u76ee\u9009\u62e9
      var saveWbE = document.getElementById('world-engine-save-wb-entries');
      if (saveWbE) {
        saveWbE.addEventListener('click', function() {
          var entryMap = (typeof worldbook.getActiveEntryMap === 'function') ? worldbook.getActiveEntryMap() : {};
          if (!entryMap) entryMap = {};
          var totalCbs = 0;
          var totalSelected = 0;
          // \u6309\u4e66\u5206\u7ec4\u7edf\u8ba1
          var byBook = {};
          document.querySelectorAll('.wb-entry-cb').forEach(function(cb) {
            var bookName = cb.getAttribute('data-book');
            var idx = parseInt(cb.getAttribute('data-entry-index'));
            if (!bookName || isNaN(idx)) return;
            if (!byBook[bookName]) byBook[bookName] = { total: 0, selected: [] };
            byBook[bookName].total++;
            totalCbs++;
            if (cb.checked) {
              byBook[bookName].selected.push(idx);
              totalSelected++;
            }
          });
          for (var bn in byBook) {
            var info = byBook[bn];
            if (info.selected.length === info.total) {
              entryMap[bn] = { allSelected: true, selectedIndices: [] };
            } else {
              entryMap[bn] = { allSelected: false, selectedIndices: info.selected };
            }
          }
          if (typeof worldbook.setActiveEntryMap === 'function') worldbook.setActiveEntryMap(entryMap);
          // \u66f4\u65b0\u8fb9\u6846\u989c\u8272+\u7edf\u8ba1
          document.querySelectorAll('.wb-entry-cb').forEach(function(cb) {
            var item = cb.closest('.tl-i');
            if (item) item.style.borderLeftColor = cb.checked ? '#238636' : '#30363d';
          });
          // \u66f4\u65b0\u6807\u9898\u680f\u9009\u4e2d\u6570
          document.querySelectorAll('.wb-book-section').forEach(function(section) {
            var header = section.querySelector('.wb-book-header');
            if (!header) return;
            var cbs = section.querySelectorAll('.wb-entry-cb');
            var checked = 0;
            cbs.forEach(function(cb) { if (cb.checked) checked++; });
            var txtSpan = header.querySelector('.sm.gray');
            if (txtSpan && cbs.length > 0) {
              txtSpan.textContent = '(' + cbs.length + '\u6761\uff0c\u5df2\u9009 ' + checked + '\u6761)';
            }
          });
          updateStats();
          toast('\u2705 \u5df2\u4fdd\u5b58 ' + totalSelected + '/' + totalCbs + ' \u6761\u6761\u76ee\u9009\u62e9');
        });
      }

      // \u5237\u65b0\u6761\u76ee\u6309\u94ae
      var refreshEntries = document.getElementById('world-engine-refresh-entries');
      if (refreshEntries) {
        refreshEntries.addEventListener('click', function() {
          renderAllBookEntries().then(function() {
            toast('\ud83d\udd04 \u6761\u76ee\u5df2\u5237\u65b0');
          });
        });
      }

      // auto-activate toggle
      var autoActCb = document.getElementById('world-engine-wb-auto-activate');
      if (autoActCb) {
        autoActCb.addEventListener('change', function() {
          window.WORLD_ENGINE_STORAGE.setItem('world_engine_wb_autoActivate', this.checked ? 'true' : 'false');
        });
      }
      // AI analyze worldbook button
      var wbAnalyzeBtn = document.getElementById('world-engine-wb-analyze');
      if (wbAnalyzeBtn) {
        wbAnalyzeBtn.addEventListener('click', async function(){
          if (!worldbook || typeof worldbook.getAvailableBooks !== 'function') { toast('\u26a0\ufe0f \u4e16\u754c\u4e66\u6a21\u5757\u672a\u52a0\u8f7d', true); return; }
          this.disabled = true; this.innerHTML = '\u23f3 \u5206\u6790\u4e2d...';
          try {
            var report = await worldbook.analyzeWorldbooks();
            if (report) {
              toast('\u2705 AI \u4e16\u754c\u4e66\u5206\u6790\u5b8c\u6210');
            } else {
              toast('\u26a0\ufe0f \u5206\u6790\u5b8c\u6210\uff0c\u65e0\u7ed3\u679c', true);
            }
          } catch(e) {
            toast('\u5206\u6790\u5f02\u5e38: '+e.message, true);
          }
          this.disabled = false; this.innerHTML = '\ud83e\udde0 AI \u5206\u6790\u4e16\u754c\u4e66\u5173\u8054\u6027';
        });
      }

    }, 50);
    // \u521d\u59cb\u52a0\u8f7d\uff08\u653e\u5b88\u536b\u5916\uff0c\u6bcf\u6b21\u5237\u65b0 Tab \u90fd\u6267\u884c\uff09
    renderAllBookEntries();
    loadWbDropdown().then(function() {
      renderAllBookEntries();
    });
  }

  /* ═══════════════════ SETTINGS ═══════════════════ */
  function renderSettings(cont) {
    var settings = readSettings();
    var stateForSettings = core.loadState();
    function selected(value, current) { return value === current ? ' selected' : ''; }
    function checked(value) { return value ? ' checked' : ''; }
    function numValue(value, fallback) {
      var n = parseInt(value, 10);
      return isNaN(n) ? fallback : n;
    }

    var html = '';
    html += '<div class="save-bar"><div class="hint">\u26a0\ufe0f \u66f4\u6539\u8bbe\u7f6e\u540e\u52a1\u5fc5\u70b9\u51fb <b>\u300c\u4fdd\u5b58\u300d</b> \u6309\u94ae\u624d\u4f1a\u751f\u6548\u3002\u6bcf\u4e2a\u533a\u57df\u6709\u72ec\u7acb\u4fdd\u5b58\u6309\u94ae\u3002</div>';
    html += '<button class="btn btn-success" id="world-engine-save-all">\ud83d\udcbe \u4fdd\u5b58\u5168\u90e8\u8bbe\u7f6e</button></div>';

    // API
    html += '<div class="card"><div class="card-title">\ud83d\udd0c API \u8fde\u63a5 <span class="bdg">\u5fc5\u987b\u914d\u7f6e</span></div><div class="fr">';
    html += '<div class="fg"><label>API \u7c7b\u578b</label><select id="world-engine-api-type">';
    ['OpenAI (ChatGPT)','KoboldCPP','TextGen WebUI (Ooba)','Claude API','\u81ea\u5b9a\u4e49'].forEach(function(t){ html += '<option'+selected(t, settings.apiType || 'KoboldCPP')+'>'+t+'</option>'; });
    html += '</select></div>';
    html += '<div class="fg"><label>API \u5730\u5740</label><input type="url" id="world-engine-api-url" value="'+esc(settings.apiUrl||'http://localhost:5001/api')+'"></div></div>';
    html += '<div class="fr"><div class="fg"><label>API Key</label><input type="password" id="world-engine-api-key" value="'+(settings.apiKey||'')+'"></div>';
    html += '<div class="fg"><label>\u6a21\u578b\u540d\u79f0</label><input type="text" id="world-engine-api-model" value="'+esc(settings.apiModel||'deepseek-v4')+'"></div></div>';
    html += '<div class="fa"><button class="btn btn-primary" id="world-engine-save-api">\ud83d\udcbe \u4fdd\u5b58 API \u8bbe\u7f6e</button>';
    html += '<button class="btn btn-success" id="world-engine-test-api">\ud83d\udd0c \u6d4b\u8bd5\u8fde\u63a5</button></div></div>';

    // general
    html += '<div class="card"><div class="card-title">\u2699\ufe0f \u901a\u7528\u8bbe\u7f6e</div><div class="fr">';
    html += '<div class="fg"><label>\u8bed\u8a00</label><select id="world-engine-lang"><option'+selected('\u4e2d\u6587', settings.language || '\u4e2d\u6587')+'>\u4e2d\u6587</option><option'+selected('English', settings.language)+'>English</option><option'+selected('\u65e5\u672c\u8a9e', settings.language)+'>\u65e5\u672c\u8a9e</option></select></div>';
    html += '<div class="fg"><label>\u6210\u5c31\u901a\u77e5</label><select id="world-engine-ach-notify"><option'+selected('\u5168\u90e8\u901a\u77e5', settings.achievementNotify || '\u5168\u90e8\u901a\u77e5')+'>\u5168\u90e8\u901a\u77e5</option><option'+selected('\u4ec5\u7a00\u6709\u53ca\u4ee5\u4e0a', settings.achievementNotify)+'>\u4ec5\u7a00\u6709\u53ca\u4ee5\u4e0a</option><option'+selected('\u5173\u95ed', settings.achievementNotify)+'>\u5173\u95ed</option></select></div></div>';
    html += '<div class="flex"><span class="tw"><label class="tg"><input type="checkbox" id="world-engine-auto-load"'+checked(settings.autoLoad !== false)+'><span class="s"></span></label><span class="sm">\u542f\u52a8\u65f6\u81ea\u52a8\u52a0\u8f7d\u4e16\u754c\u72b6\u6001</span></span>';
    html += '<span class="tw"><label class="tg"><input type="checkbox" id="world-engine-nsfw-ach"'+checked(!!(stateForSettings.achievements && stateForSettings.achievements.showNSFW))+'><span class="s"></span></label><span class="sm">\u663e\u793a NSFW \u6210\u5c31</span></span></div>';
    html += '<div class="fa"><button class="btn btn-primary" id="world-engine-save-general">\ud83d\udcbe \u4fdd\u5b58\u901a\u7528\u8bbe\u7f6e</button></div></div>';

    // data & storage
    html += '<div class="card"><div class="card-title">\ud83d\udcbe \u6570\u636e & \u5b58\u50a8</div><div class="fr">';
    html += '<div class="fg"><label>\u70ed\u8bb0\u5fc6\u9608\u503c\uff08\u8f6e\u6570\uff09</label><input type="number" id="world-engine-hot-threshold" value="'+numValue(settings.hotMemoryThreshold, 50)+'"></div>';
    html += '<div class="fg"><label>\u81ea\u52a8\u5907\u4efd\u95f4\u9694</label><select id="world-engine-backup-interval"><option'+selected('\u6bcf 5 \u8f6e', settings.backupInterval)+'>\u6bcf 5 \u8f6e</option><option'+selected('\u6bcf 10 \u8f6e', settings.backupInterval || '\u6bcf 10 \u8f6e')+'>\u6bcf 10 \u8f6e</option><option'+selected('\u6bcf 20 \u8f6e', settings.backupInterval)+'>\u6bcf 20 \u8f6e</option><option'+selected('\u5173\u95ed', settings.backupInterval)+'>\u5173\u95ed</option></select></div></div>';
    html += '<div class="fr"><div class="fg"><label>\u6700\u5927\u8bb0\u5fc6\u6570\u91cf</label><input type="number" id="world-engine-max-memory" value="'+numValue(settings.maxMemories, 500)+'"></div>';
    html += '<div class="fg"><label>AI \u81ea\u52a8\u6210\u5c31\u751f\u6210</label><select id="world-engine-auto-ach"><option'+selected('\u5f00\u542f\uff08\u6700\u591a 50 \u4e2a\uff09', settings.autoAchievements === false ? '' : '\u5f00\u542f\uff08\u6700\u591a 50 \u4e2a\uff09')+'>\u5f00\u542f\uff08\u6700\u591a 50 \u4e2a\uff09</option><option'+selected('\u5173\u95ed', settings.autoAchievements === false ? '\u5173\u95ed' : '')+'>\u5173\u95ed</option></select></div></div>';
    html += '<div class="fa"><button class="btn btn-primary" id="world-engine-save-storage">\ud83d\udcbe \u4fdd\u5b58\u5b58\u50a8\u8bbe\u7f6e</button>';
    html += '<button class="btn btn-success" id="world-engine-export-snapshot">\ud83d\udce6 \u5bfc\u51fa\u5feb\u7167</button>';
    html += '<button class="btn" id="world-engine-import-snapshot">\ud83d\udce5 \u5bfc\u5165\u5feb\u7167</button></div>';
    html += '<div class="hr"></div>';
    var autoBackups = []; try { autoBackups = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_auto_backups') || '[]'); } catch(e) {}
    var lastBakRound = autoBackups.length > 0 ? autoBackups[autoBackups.length - 1].round || '\u65e0' : '\u65e0';
    html += '<div class="flex"><span class="sm gray">\u6700\u8fd1\u5feb\u7167\uff1a' + autoBackups.length + ' \u4e2a\u4fdd\u5b58\u70b9</span><span class="sm gray">\u6700\u540e\u5907\u4efd\uff1a\u7b2c ' + lastBakRound + ' \u8f6e</span></div></div>';

    // \u9884\u8bbe\u7ba1\u7406
    var presetsApi = window.WORLD_ENGINE_PRESETS;
    var presetList = presetsApi && presetsApi.listPresets ? presetsApi.listPresets() : [{ id: 'standard', name: '\u6807\u51c6\u9884\u8bbe' }];
    var activePreset = presetsApi && presetsApi.getActivePreset ? presetsApi.getActivePreset() : null;
    var currentPresetId = (activePreset && activePreset.id) || window.WORLD_ENGINE_STORAGE.getItem('world_engine_active_preset') || 'standard';
    var currentPresetName = (activePreset && activePreset.name) || currentPresetId;
    html += '<div class="card"><div class="card-title">\ud83d\udce6 \u9884\u8bbe\u7ba1\u7406 <span class="bdg">\u5f53\u524d: '+esc(currentPresetName)+'</span></div><div class="fr">';
    html += '<div class="fg"><label>\u5f53\u524d\u9884\u8bbe</label><select id="world-engine-preset-select">';
    presetList.forEach(function(p) {
      html += '<option value="'+esc(p.id)+'"'+selected(p.id, currentPresetId)+'>'+esc(p.name || p.id)+'</option>';
    });
    html += '</select></div>';
    html += '<div class="fg"><label>\u521b\u5efa\u65b0\u9884\u8bbe</label><div class="flex"><input type="text" id="world-engine-new-preset-name" placeholder="\u8f93\u5165\u9884\u8bbe\u540d\u79f0..." style="flex:1;padding:6px 10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:12px;"><button class="btn btn-sm" id="world-engine-create-preset">\u2795 \u521b\u5efa</button></div></div></div>';
    html += '<div class="fa"><button class="btn btn-primary" id="world-engine-save-preset">\ud83d\udcbe \u4fdd\u5b58\u9884\u8bbe</button><button class="btn btn-sm" id="world-engine-export-preset">\ud83d\udce4 \u5bfc\u51fa\u9884\u8bbe</button><button class="btn btn-sm" id="world-engine-import-preset">\ud83d\udce5 \u5bfc\u5165\u9884\u8bbe</button><button class="btn btn-danger btn-sm" id="world-engine-delete-preset">\ud83d\uddd1\ufe0f \u5220\u9664\u9884\u8bbe</button></div></div>';

    // world law
    var st = core.loadState();
    var wl = st.worldLaw || {};
    var DIM_DEFS = [
      {id:'magic',label:'\u9b54\u529b\u6d53\u5ea6',opts:['\u65e0','\u4f4e','\u4e2d','\u9ad8','\u6781\u9ad8']},
      {id:'tech',label:'\u79d1\u6280\u6c34\u5e73',opts:['\u539f\u59cb','\u4e2d\u4e16\u7eaa','\u6587\u827a\u590d\u5174','\u5de5\u4e1a\u9769\u547d','\u73b0\u4ee3','\u79d1\u5e7b']},
      {id:'supernatural',label:'\u8d85\u81ea\u7136\u5b58\u5728',opts:['\u65e0','\u7f55\u89c1','\u5e38\u89c1','\u4e30\u5bcc']},
      {id:'governance',label:'\u7edf\u6cbb\u5f62\u6001',opts:['\u5c01\u5efa\u5236','\u5e1d\u56fd\u5236','\u5171\u548c\u5236','\u5b97\u95e8\u7edf\u6cbb','\u65e0\u653f\u5e9c']},
      {id:'conflict',label:'\u6838\u5fc3\u51b2\u7a81',opts:['\u751f\u5b58','\u6218\u4e89','\u6c42\u77e5','\u6743\u529b','\u7231\u6068','\u81ea\u7531']},
      {id:'environment',label:'\u81ea\u7136\u73af\u5883',opts:['\u6781\u5bd2','\u9177\u70ed','\u6e29\u5e26','\u6c99\u6f20','\u6d77\u6d0b','\u4e1b\u6797','\u591a\u6837']}
    ];
    var wlDims = wl.dimensions || {};

    html += '<div class="card" id="world-engine-wl-section"><div class="card-title">\ud83c\udf10 \u4e16\u754c\u6cd5\u5219 <span class="bdg">v3.0.0</span></div><div class="fr">';
    html += '<div class="fg"><label>\u4e16\u754c\u6846\u67b6</label><select id="world-engine-wf-framework">';
    ['\u81ea\u5b9a\u4e49','\u5251\u4e0e\u9b54\u6cd5','\u79d1\u5e7b\u672a\u6765','\u5386\u53f2\u4f20\u5947','\u90fd\u5e02\u5f02\u80fd'].forEach(function(f){ html += '<option'+(f==='\u81ea\u5b9a\u4e49'?' selected':'')+'>'+f+'</option>'; });
    html += '</select></div>';
    html += '<div class="fg"><label>\u6846\u67b6\u540d</label><input type="text" id="world-engine-wf-name" value="'+esc(wl.frameworkName||'\u81ea\u5b9a\u4e49\u4e16\u754c')+'"></div></div>';
    html += '<div class="fg"><label>\u4e16\u754c\u63cf\u8ff0</label><textarea id="world-engine-wf-desc" rows="2">'+esc(wl.description||st.worldDescription||'')+'</textarea></div>';
    // dimension selectors
    html += '<div class="fr" style="grid-template-columns:1fr 1fr;">';
    DIM_DEFS.forEach(function(dim){
      var currentVal = wlDims[dim.id] || dim.opts[0];
      html += '<div class="fg"><label>'+dim.label+'</label><select class="world-engine-wl-dim" data-dim="'+dim.id+'">';
      dim.opts.forEach(function(o){ html += '<option'+(o===currentVal?' selected':'')+'>'+o+'</option>'; });
      html += '</select></div>';
    });
    html += '</div>';
    // custom rules section
    html += '<div class="fg"><label>\u81ea\u5b9a\u4e49\u6cd5\u5219</label>';
    html += '<div class="flex" style="gap:4px;flex-wrap:wrap;" id="world-engine-wl-custom-rules">';
    if (wl.customRules && wl.customRules.length) {
      wl.customRules.forEach(function(r){ html += '<span class="tag tag-loc">'+esc(r)+'</span> '; });
    } else {
      html += '<span class="sm gray">\u6682\u65e0\u81ea\u5b9a\u4e49\u6cd5\u5219</span>';
    }
    html += '</div></div>';
    html += '<div class="flex" style="gap:4px;"><input type="text" id="world-engine-add-wl-rule" placeholder="\u8f93\u5165\u81ea\u5b9a\u4e49\u6cd5\u5219..." style="flex:1;padding:4px 8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;color:#e6edf3;font-size:11px;"><button class="btn btn-sm" id="world-engine-add-wl-rule-btn">\u2795 \u6dfb\u52a0</button></div>';
    html += '<div class="fg"><label>AI \u5206\u6790\u63a8\u8350</label>';
    html += '<div style="background:#0d1117;border-radius:6px;padding:8px;border:1px solid #21262d;font-size:11px;color:#8b949e;">';
    html += '\u7cfb\u7edf\u5c1a\u672a\u5bf9\u5f53\u524d\u4e16\u754c\u8fdb\u884c AI \u5206\u6790\u3002<button class="btn btn-sm" id="world-engine-analyze-wl">\u5f00\u59cb\u5206\u6790</button></div></div>';
    html += '<div class="fa"><button class="btn btn-primary" id="world-engine-save-wl">\ud83d\udcbe \u4fdd\u5b58\u4e16\u754c\u6cd5\u5219</button></div>';
    // ★ v3.0.1: 数据导出
    html += '<div class="card"><div class="card-title">\ud83d\udce6 \u6570\u636e\u5bfc\u51fa <span class="bdg">\u5907\u4efd/\u8fc1\u79fb</span></div>';
    html += '<div class="sm gray" style="margin-bottom:8px;">\u5bfc\u51fa\u5168\u90e8 World Engine \u72b6\u6001\u6570\u636e\u4e3a JSON \u6587\u4ef6\uff0c\u53ef\u7528\u4e8e\u5907\u4efd\u6216\u8de8\u804a\u5929\u8fc1\u79fb\u3002</div>';
    html += '<div class="fa"><button class="btn btn-primary" id="world-engine-export-all">\ud83d\udce4 \u5bfc\u51fa\u5168\u90e8\u6570\u636e (JSON)</button>';
    html += '<button class="btn" id="world-engine-import-all" style="margin-left:8px;">\ud83d\udce5 \u5bfc\u5165\u6570\u636e</button>';
    html += '<input type="file" id="world-engine-import-file" accept=".json" style="display:none;"></div></div>';

    // danger zone — reset
    html += '<div class="card" style="border:1px solid #f85149;"><div class="card-title">\u26a0\ufe0f \u5371\u9669\u64cd\u4f5c</div>';
    html += '<div class="sm gray" style="margin-bottom:8px;">\u4ee5\u4e0b\u64cd\u4f5c\u4e0d\u53ef\u6062\u590d\uff0c\u8bf7\u52ff\u8f7b\u8bd5\u3002</div>';
    html += '<button class="btn btn-danger" id="world-engine-reset-all">\ud83d\uddd1\ufe0f \u91cd\u7f6e\u6240\u6709 World Engine \u6570\u636e</button>';
    html += '<button class="btn btn-sm" id="world-engine-reset-settings" style="margin-left:8px;">\u2699\ufe0f \u4ec5\u91cd\u7f6e\u8bbe\u7f6e</button></div>';

    cont.innerHTML = html;

    // bind events
    setTimeout(function(){
      var saveAll = document.getElementById('world-engine-save-all');
      if (saveAll) saveAll.addEventListener('click', function(){
        // trigger all individual save clicks
        ['save-api','save-general','save-storage','save-preset','save-wl','save-drive','save-time','save-evolve','save-inject'].forEach(function(id){
          var btn = document.getElementById('world-engine-' + id);
          if (btn) btn.click();
        });
        toast('\u2705 \u5168\u90e8\u8bbe\u7f6e\u5df2\u4fdd\u5b58');
      });

      var saveApi = document.getElementById('world-engine-save-api');
      if (saveApi) saveApi.addEventListener('click', function(){
        var s = readSettings();
        var typeEl = document.getElementById('world-engine-api-type');
        var urlEl = document.getElementById('world-engine-api-url');
        var keyEl = document.getElementById('world-engine-api-key');
        var modelEl = document.getElementById('world-engine-api-model');
        if (typeEl) s.apiType = typeEl.value;
        if (urlEl) s.apiUrl = urlEl.value;
        if (keyEl) s.apiKey = keyEl.value;
        if (modelEl) s.apiModel = modelEl.value;
        saveSettings(s);
        toast('\u2705 API \u8bbe\u7f6e\u5df2\u4fdd\u5b58');
      });

      var testApi = document.getElementById('world-engine-test-api');
      if (testApi) testApi.addEventListener('click', async function(){
        var urlEl = document.getElementById('world-engine-api-url');
        var keyEl = document.getElementById('world-engine-api-key');
        var modelEl = document.getElementById('world-engine-api-model');
        var apiUrl = urlEl ? urlEl.value : '';
        if (!apiUrl) { toast('\u26a0\ufe0f \u8bf7\u5148\u586b\u5199 API \u5730\u5740', true); return; }
        this.disabled = true; var origText = this.innerHTML;
        this.innerHTML = '\u23f3 \u6d4b\u8bd5\u4e2d...';
        try {
          var resp = await fetch(apiUrl + '/v1/models', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + (keyEl ? keyEl.value : ''), 'Content-Type': 'application/json' }
          });
          if (resp.ok) { toast('\u2705 API \u8fde\u63a5\u6210\u529f\uff01'); } else { toast('\u26a0\ufe0f API \u8fd4\u56de: ' + resp.status, true); }
        } catch(e) {
          // try koboldcpp style
          try {
            var resp2 = await fetchWithTimeout(apiUrl, { method: 'GET' }, 5000);
            if (resp2.ok) { toast('\u2705 API \u8fde\u63a5\u6210\u529f\uff01'); } else { toast('\u26a0\ufe0f \u8fde\u63a5\u5931\u8d25: ' + resp2.status, true); }
          } catch(e2) { toast('\u274c \u65e0\u6cd5\u8fde\u63a5 API: ' + e2.message, true); }
        }
        this.disabled = false; this.innerHTML = origText;
      });

      var saveGen = document.getElementById('world-engine-save-general');
      if (saveGen) saveGen.addEventListener('click', function(){
        var s = readSettings();
        var langEl = document.getElementById('world-engine-lang');
        var notifyEl = document.getElementById('world-engine-ach-notify');
        var autoLoadEl = document.getElementById('world-engine-auto-load');
        var nsfwEl = document.getElementById('world-engine-nsfw-ach');
        if (langEl) s.language = langEl.value;
        if (notifyEl) s.achievementNotify = notifyEl.value;
        if (autoLoadEl) s.autoLoad = autoLoadEl.checked;
        saveSettings(s);
        var st = core.loadState();
        if (!st.achievements) st.achievements = {};
        if (nsfwEl) st.achievements.showNSFW = nsfwEl.checked;
        core.saveState(st);
        toast('\u2705 \u901a\u7528\u8bbe\u7f6e\u5df2\u4fdd\u5b58');
      });

      var saveSto = document.getElementById('world-engine-save-storage');
      if (saveSto) saveSto.addEventListener('click', function(){
        var s = readSettings();
        var hotEl = document.getElementById('world-engine-hot-threshold');
        var backupEl = document.getElementById('world-engine-backup-interval');
        var maxEl = document.getElementById('world-engine-max-memory');
        var autoAchEl = document.getElementById('world-engine-auto-ach');
        if (hotEl) s.hotMemoryThreshold = Math.max(1, parseInt(hotEl.value || '50', 10) || 50);
        if (backupEl) s.backupInterval = backupEl.value;
        if (maxEl) s.maxMemories = Math.max(10, parseInt(maxEl.value || '500', 10) || 500);
        if (autoAchEl) s.autoAchievements = autoAchEl.value !== '\u5173\u95ed';
        saveSettings(s);
        var st = core.loadState();
        if (!st.achievements) st.achievements = {};
        if (autoAchEl) st.achievements.autoGenEnabled = autoAchEl.value !== '\u5173\u95ed';
        core.saveState(st);
        toast('\u2705 \u5b58\u50a8\u8bbe\u7f6e\u5df2\u4fdd\u5b58');
      });

      var exportSnap = document.getElementById('world-engine-export-snapshot');
      if (exportSnap) exportSnap.addEventListener('click', function(){
        var st = core.loadState();
        downloadJson('world-engine-snapshot-'+new Date().toISOString().slice(0,19).replace(/[:-]/g,'')+'.json', st);
        toast('\ud83d\udce6 \u5feb\u7167\u5df2\u5bfc\u51fa');
      });

      // \u5bfc\u5165\u5feb\u7167
      var importSnap = document.getElementById('world-engine-import-snapshot');
      if (importSnap) importSnap.addEventListener('click', function(){
        var inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json';
        inp.addEventListener('change', function(e){
          var file = e.target.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function(ev){
            try {
              var data = JSON.parse(ev.target.result);
              var st = core.loadState();
              Object.assign(st, data);
              core.saveState(st);
              toast('\u2705 \u5feb\u7167\u5df2\u5bfc\u5165\uff0c\u5df2\u5373\u65f6\u5e94\u7528');
              requestConfigApply('snapshot-import');
            } catch(err){ toast('\u274c \u5bfc\u5165\u5931\u8d25\uff1a' + err.message, true); }
          };
          reader.readAsText(file);
        });
        inp.click();
      });

      // \u9884\u8bbe\u7ba1\u7406\u6309\u94ae
      var savePreset = document.getElementById('world-engine-save-preset');
      if (savePreset) savePreset.addEventListener('click', function(){
        var sel = document.getElementById('world-engine-preset-select');
        var presetId = sel ? sel.value : 'standard';
        var ok = presetsApi && presetsApi.setActivePreset ? presetsApi.setActivePreset(presetId) : false;
        var s = readSettings();
        s.activePreset = presetId;
        saveSettings(s);
        toast(ok ? '\u2705 \u9884\u8bbe\u5df2\u4fdd\u5b58' : '\u26a0\ufe0f \u9884\u8bbe\u5df2\u5199\u5165\u8bbe\u7f6e\uff0c\u4f46 preset API \u672a\u786e\u8ba4', !ok);
      });
      var createPreset = document.getElementById('world-engine-create-preset');
      if (createPreset) createPreset.addEventListener('click', function(){
        var name = document.getElementById('world-engine-new-preset-name');
        if (name && name.value.trim()) {
          var sel = document.getElementById('world-engine-preset-select');
          var baseId = sel ? sel.value : 'standard';
          var preset = presetsApi && presetsApi.createPreset ? presetsApi.createPreset(name.value.trim(), baseId) : null;
          if (preset && sel) {
            var opt = document.createElement('option');
            opt.value = preset.id;
            opt.textContent = preset.name || preset.id;
            opt.selected = true;
            sel.appendChild(opt);
            if (presetsApi.setActivePreset) presetsApi.setActivePreset(preset.id);
          }
          toast(preset ? '\u2705 \u5df2\u521b\u5efa\u9884\u8bbe\uff1a' + (preset.name || name.value.trim()) : '\u274c \u9884\u8bbe\u521b\u5efa\u5931\u8d25', !preset);
          name.value = '';
        }
      });
      var exportPreset = document.getElementById('world-engine-export-preset');
      if (exportPreset) exportPreset.addEventListener('click', function(){
        var sel = document.getElementById('world-engine-preset-select');
        var presetId = sel ? sel.value : 'standard';
        var json = presetsApi && presetsApi.exportPreset ? presetsApi.exportPreset(presetId) : null;
        if (!json) { toast('\u274c \u9884\u8bbe\u5bfc\u51fa\u5931\u8d25', true); return; }
        downloadJson('world-engine-preset-'+presetId+'-'+new Date().toISOString().slice(0,19).replace(/[:-]/g,'')+'.json', json);
        toast('\ud83d\udce4 \u9884\u8bbe\u5df2\u5bfc\u51fa');
      });
      var importPreset = document.getElementById('world-engine-import-preset');
      if (importPreset) importPreset.addEventListener('click', function(){
        var inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json';
        inp.addEventListener('change', function(e){
          var file = e.target.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function(ev){
            try {
              var result = presetsApi && presetsApi.importPreset ? presetsApi.importPreset(ev.target.result) : { success: false, error: 'Preset API unavailable' };
              if (!result.success) throw new Error(result.error || '\u5bfc\u5165\u5931\u8d25');
              var sel = document.getElementById('world-engine-preset-select');
              if (sel && result.preset) {
                var opt = document.createElement('option');
                opt.value = result.preset.id;
                opt.textContent = result.preset.name || result.preset.id;
                opt.selected = true;
                sel.appendChild(opt);
              }
              if (presetsApi.setActivePreset && result.preset) presetsApi.setActivePreset(result.preset.id);
              toast('\u2705 \u9884\u8bbe\u5df2\u5bfc\u5165');
            } catch(err){ toast('\u274c \u5bfc\u5165\u5931\u8d25\uff1a' + err.message, true); }
          };
          reader.readAsText(file);
        });
        inp.click();
      });
      var deletePreset = document.getElementById('world-engine-delete-preset');
      if (deletePreset) deletePreset.addEventListener('click', function(){
        if (!confirm('\u786e\u5b9a\u5220\u9664\u5f53\u524d\u9884\u8bbe\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u6062\u590d\u3002')) return;
        var sel = document.getElementById('world-engine-preset-select');
        var presetId = sel ? sel.value : '';
        var ok = presetsApi && presetsApi.deletePreset ? presetsApi.deletePreset(presetId) : false;
        if (ok && sel) {
          var opt = sel.querySelector('option[value="'+presetId.replace(/"/g, '\\"')+'"]');
          if (opt) opt.remove();
          sel.value = 'standard';
          if (presetsApi.setActivePreset) presetsApi.setActivePreset('standard');
        }
        toast(ok ? '\u2705 \u9884\u8bbe\u5df2\u5220\u9664' : '\u26a0\ufe0f \u7cfb\u7edf\u9884\u8bbe\u4e0d\u53ef\u5220\u9664', !ok);
      });

      var saveWl = document.getElementById('world-engine-save-wl');
      if (saveWl) saveWl.addEventListener('click', function(){
        var st = core.loadState();
        if (!st.worldLaw) st.worldLaw = {};
        var fwEl = document.getElementById('world-engine-wf-framework');
        var fnEl = document.getElementById('world-engine-wf-name');
        st.worldLaw.framework = fwEl ? fwEl.value : '\u81ea\u5b9a\u4e49';
        st.worldLaw.frameworkName = fnEl ? fnEl.value : '\u81ea\u5b9a\u4e49\u4e16\u754c';
        // save dimension values
        if (!st.worldLaw.dimensions) st.worldLaw.dimensions = {};
        document.querySelectorAll('.world-engine-wl-dim').forEach(function(sel){
          st.worldLaw.dimensions[sel.dataset.dim] = sel.value;
        });
        core.saveState(st);
        toast('\u2705 \u4e16\u754c\u6cd5\u5219\u5df2\u4fdd\u5b58');
        requestConfigApply('world-law');
      });

      // \u4e16\u754c\u6cd5\u5219 AI \u5206\u6790
      var awl = document.getElementById('world-engine-analyze-wl');
      if (awl) awl.addEventListener('click', function(){
        var st = core.loadState();
        if (!st.worldLaw) st.worldLaw = {};
        st.worldLaw.lastAnalyzed = true;
        st.worldLaw.lastModifiedRound = st.round || 0;
        core.saveState(st);
        toast('\u2705 AI \u4e16\u754c\u6cd5\u5219\u5206\u6790\u5df2\u89e6\u53d1');
        requestConfigApply('world-law-analysis');
      });

      // \u6dfb\u52a0\u81ea\u5b9a\u4e49\u6cd5\u5219 (id-based, Fix 5)
      var addRuleBtn = document.getElementById('world-engine-add-wl-rule-btn');
      if (addRuleBtn) addRuleBtn.addEventListener('click', function(){
        var input = document.getElementById('world-engine-add-wl-rule');
        var rule = input ? input.value.trim() : '';
        if (!rule) { toast('\u26a0\ufe0f \u8bf7\u8f93\u5165\u81ea\u5b9a\u4e49\u6cd5\u5219', true); return; }
        var st = core.loadState();
        if (!st.worldLaw) st.worldLaw = {};
        if (!st.worldLaw.customRules) st.worldLaw.customRules = [];
        st.worldLaw.customRules.push(rule);
        core.saveState(st);
        input.value = '';
        toast('\u2705 \u5df2\u6dfb\u52a0\u6cd5\u5219\uff1a' + rule);
        requestConfigApply('world-law-rule');
      });
      var exportAll = document.getElementById('world-engine-export-all');
      if (exportAll) exportAll.addEventListener('click', function(){
        var payload = {
          schema: 'world-engine-config-export',
          version: '3.4.2',
          exportedAt: new Date().toISOString(),
          settings: readSettings(),
          presets: readJSON(window.WORLD_ENGINE_STORAGE.getItem('world_engine_presets'), null),
          activePreset: window.WORLD_ENGINE_STORAGE.getItem('world_engine_active_preset') || null,
          injectStyle: window.WORLD_ENGINE_STORAGE.getItem('world_engine_inject_style') || null,
          panelState: readPanelState(),
          worldbookSelection: readJSON(window.WORLD_ENGINE_STORAGE.getItem('world_engine_worldbook_selection'), null),
          worldbookBooks: readJSON(window.WORLD_ENGINE_STORAGE.getItem('world_engine_wb_books'), null),
          state: core.loadState()
        };
        downloadJson('world-engine-full-export-'+new Date().toISOString().slice(0,19).replace(/[:-]/g,'')+'.json', payload);
        toast('\ud83d\udce4 \u5168\u90e8\u6570\u636e\u5df2\u5bfc\u51fa');
      });

      var importAll = document.getElementById('world-engine-import-all');
      var importFile = document.getElementById('world-engine-import-file');
      if (importAll && importFile) {
        importAll.addEventListener('click', function(){ importFile.click(); });
        importFile.addEventListener('change', function(e){
          var file = e.target.files && e.target.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function(ev) {
            try {
              var data = JSON.parse(ev.target.result);
              if (data.settings) saveSettings(data.settings);
              if (data.presets) window.WORLD_ENGINE_STORAGE.setItem('world_engine_presets', JSON.stringify(data.presets, null, 2));
              if (data.activePreset) window.WORLD_ENGINE_STORAGE.setItem('world_engine_active_preset', data.activePreset);
              if (data.injectStyle) window.WORLD_ENGINE_STORAGE.setItem('world_engine_inject_style', data.injectStyle);
              if (data.panelState) window.WORLD_ENGINE_STORAGE.setItem(PANEL_STATE_KEY, JSON.stringify(data.panelState, null, 2));
              if (data.worldbookSelection) window.WORLD_ENGINE_STORAGE.setItem('world_engine_worldbook_selection', JSON.stringify(data.worldbookSelection, null, 2));
              if (data.worldbookBooks) window.WORLD_ENGINE_STORAGE.setItem('world_engine_wb_books', JSON.stringify(data.worldbookBooks, null, 2));
              if (data.state) core.saveState(data.state);
              toast('\u2705 \u5168\u90e8\u6570\u636e\u5df2\u5bfc\u5165\uff0c\u5df2\u5373\u65f6\u5e94\u7528');
              requestConfigApply('full-import');
            } catch(err) {
              toast('\u274c \u5168\u90e8\u6570\u636e\u5bfc\u5165\u5931\u8d25\uff1a' + err.message, true);
            } finally {
              importFile.value = '';
            }
          };
          reader.readAsText(file);
        });
      }

      // reset all data - double confirmation
      var resetAll = document.getElementById('world-engine-reset-all');
      if (resetAll) resetAll.addEventListener('click', function(){
        if (!confirm('\u786e\u5b9a\u91cd\u7f6e\u6240\u6709 World Engine \u6570\u636e\uff1f\u8fd9\u5c06\u6e05\u9664\u5168\u90e8\u8bb0\u5fc6\u3001\u6210\u5c31\u3001\u4e16\u754c\u72b6\u6001\u3001\u60c5\u611f\u6570\u636e\u3002')) return;
        if (!confirm('\u518d\u786e\u8ba4\u4e00\u6b21\uff1a\u8fd9\u4e2a\u64cd\u4f5c\u4e0d\u53ef\u6062\u590d\u3002\u786e\u5b9a\u8981\u91cd\u7f6e\uff1f')) return;
        var keys = window.WORLD_ENGINE_STORAGE.keys ? window.WORLD_ENGINE_STORAGE.keys() : [];
        keys.forEach(function(key) { window.WORLD_ENGINE_STORAGE.removeItem(key); });
        toast('\u26a0\ufe0f \u6240\u6709 World Engine \u6570\u636e\u5df2\u91cd\u7f6e\uff0c\u5df2\u5373\u65f6\u5e94\u7528');
        requestConfigApply('reset-all');
      });
      // reset settings only
      var resetS = document.getElementById('world-engine-reset-settings');
      if (resetS) resetS.addEventListener('click', function(){
        if (!confirm('\u786e\u5b9a\u4ec5\u91cd\u7f6e\u8bbe\u7f6e\uff1f\u8bb0\u5fc6\u548c\u4e16\u754c\u72b6\u6001\u5c06\u4fdd\u7559\u3002')) return;
        window.WORLD_ENGINE_STORAGE.removeItem('world_engine_settings');
        toast('\u2699\ufe0f \u8bbe\u7f6e\u5df2\u91cd\u7f6e\uff0c\u5df2\u5373\u65f6\u5e94\u7528');
        requestConfigApply('reset-settings');
      });
    }, 50);
  }

  /* ═══════════════════ HELP ═══════════════════ */
  function renderHelp(cont, state) {
    var html = '';
    html += '<div class="guide-box"><div class="gt">\ud83d\udcda \u4f7f\u7528\u624b\u518c</div><div class="gd">\u8ba9\u4e16\u754c\u6d3b\u8d77\u6765 \u2716 3\u3002\u65b0\u624b\u770b\u5de6\u8fb9\uff0c\u8001\u624b\u770b\u53f3\u8fb9\u3002</div>';
    html += '<div class="save-bar"><div class="hint">🔍 搜索帮助内容</div>';
    html += '<input type="text" class="world-engine-search-input" id="world-engine-help-search" placeholder="搜索功能/关键词..." style="max-width:200px;"></div>';
    html += '<div class="save-bar"><div class="hint">🔍 搜索帮助内容</div>';
    // \u65b0\u624b/\u8fdb\u9636 Tab \u5207\u6362
    html += '<div style="display:flex;gap:0;margin-bottom:14px;border-bottom:2px solid #21262d;">';
    html += '<button class="world-engine-help-tab-btn active" data-htab="newbie" style="background:none;border:none;color:#f0c040;font-size:13px;font-weight:600;padding:9px 20px;border-bottom:2px solid #f0c040;cursor:pointer;font-family:inherit;">\ud83d\udfe2 \u65b0\u624b\u5165\u95e8</button>';
    html += '<button class="world-engine-help-tab-btn" data-htab="advanced" style="background:none;border:none;color:#8b949e;font-size:13px;padding:9px 20px;border-bottom:2px solid transparent;cursor:pointer;font-family:inherit;">\ud83d\udd35 \u8fdb\u9636\u53c2\u8003</button></div>';

    // ========== \u65b0\u624b\u5165\u95e8 ==========
    html += '<div class="world-engine-help-panel" id="world-engine-help-newbie">';
    html += '<div class="card hp-sect"><h3>\ud83d\ude80 \u65b0\u624b\u4e00\u6761\u9f99\uff085 \u5206\u949f\u641e\u5b9a\uff09</h3>';
    var steps = [
      {n:'\u2460 \u63a5\u4e0a AI \u5927\u8111','d':'\u6253\u5f00\u300c\u8bbe\u7f6e \u2192 API \u8fde\u63a5\u300d\uff1a\u4e0b\u62c9\u9009\u4f60\u7684 AI \u7c7b\u578b\uff08\u63a8\u8350 KoboldCPP \u6216 OpenAI\uff09\uff0c\u586b\u5730\u5740\uff08\u5982 http://localhost:5001/api\uff09\uff0c\u586b\u5bc6\u94a5\uff0c\u586b\u6a21\u578b\u540d\uff0c\u70b9\u300c\ud83d\udcbe \u4fdd\u5b58\u300d\uff0c\u518d\u70b9\u300c\ud83d\udd0c \u6d4b\u8bd5\u8fde\u63a5\u300d\u770b\u901a\u4e0d\u901a\u3002'},
      {n:'\u2461 \u9009\u4e2a\u6545\u4e8b\u65b9\u5411\uff08\u53ef\u9009\uff0c\u4f46\u5f3a\u70c8\u63a8\u8350\uff09','d':'\u6253\u5f00\u300c\u6545\u4e8b \u2192 \u6545\u4e8b\u7c7b\u578b\u5206\u6790\u300d\uff1a\u4e0a\u62c9\u9009\u6545\u4e8b\u6a21\u677f\uff08\u63a8\u8350\u300c\u82f1\u96c4\u4e4b\u65c5\u300d\u6216\u300c\u6d3e\u7cfb\u7eb7\u4e89\u300d\uff09\uff0c\u4e0b\u62c9\u9009\u60c5\u611f\u57fa\u8c03\uff08\u300c\u70ed\u8840\u6fc0\u8361\u300d\u6216\u300c\u6e29\u99a8\u6cbb\u6108\u300d\uff09\uff0c\u70b9\u300c\ud83d\udcbe \u4fdd\u5b58\u300d\u3002'},
      {n:'\u2462 \u6fc0\u6d3b\u4e16\u754c\u4e66\uff08\u5982\u679c\u4f60\u6709\u914d\u7684\u8bdd\uff09','d':'\u6253\u5f00\u300c\u4e16\u754c\u4e66\u300d\u9875\uff1a\u52fe\u9009\u8981\u7528\u7684\u4e16\u754c\u4e66\uff0c\u5728\u9009\u4e2d\u7684\u4e66\u91cc\u52fe\u9009\u8981\u6fc0\u6d3b\u7684\u6761\u76ee\uff0c\u70b9\u300c\ud83d\udcbe \u4fdd\u5b58\u9009\u62e9\u300d\u3002'},
      {n:'\u2463 \u9009\u4e2a\u5f15\u64ce\u6a21\u5f0f','d':'\u6253\u5f00\u300c\u5f15\u64ce \u2192 \u9a71\u52a8\u6a21\u5f0f\u300d\uff1a\u4e0b\u62c9\u9009\u300c\u81ea\u52a8\u6a21\u5f0f\u300d\uff0c\u70b9\u300c\ud83d\udcbe \u4fdd\u5b58\u300d\u3002\u65b0\u624b\u9009\u81ea\u52a8\u5c31\u884c\uff0c\u4e16\u754c\u81ea\u5df1\u5728\u540e\u53f0\u8f6c\u3002'},
      {n:'\u2464 \u5f00\u804a\uff01','d':'\u56de\u804a\u5929\u7a97\u53e3\uff0c\u6b63\u5e38\u8bf4\u8bdd\u3002\u4f60\u6bcf\u8bf4\u4e00\u53e5\uff0c\u5f15\u64ce\u5c31\u63a8\u6f14\u4e00\u8f6e\u2014\u2014NPC \u4f1a\u6d3b\u52a8\u3001\u65f6\u95f4\u4f1a\u6d41\u901d\u3001\u6210\u5c31\u81ea\u5df1\u89e3\u9501\u3002'},
      {n:'\u2465 \u60f3\u770b\u770b\u4e16\u754c\u5728\u5e72\u561b\uff1f','d':'\u70b9\u300c\u603b\u89c8\u300d\u2014\u2014\u6240\u6709\u4fe1\u606f\u90fd\u5728\u90a3\u513f\uff1a\u8f6e\u6570\u3001\u4e8b\u4ef6\u65f6\u95f4\u7ebf\u3001\u5173\u7cfb\u56fe\u3001\u6210\u5c31\u56de\u54cd\u3002'}
    ];
    steps.forEach(function(s){
      html += '<div class="hp-step"><span class="sn">'+s.n+'</span><br>'+s.d+'</div>';
    });
    html += '</div>';

    // FAQ
    html += '<div class="card hp-sect"><h3>\u2753 \u5e38\u89c1\u95ee\u9898\uff08\u65b0\u624b\u5fc5\u770b\uff09</h3>';
    var faqs = [
      {q:'\u6211\u8bbe\u7f6e\u4e86\u4f46\u6ca1\u751f\u6548\uff1f',a:'\u6bcf\u4e2a\u8bbe\u7f6e\u533a\u5757\u6709\u72ec\u7acb\u7684 \ud83d\udcbe \u4fdd\u5b58\u6309\u94ae\u3002\u4e0d\u70b9\u4fdd\u5b58 = \u767d\u8bbe\u3002\u4e5f\u53ef\u7528\u8bbe\u7f6e\u9875\u9876\u90e8\u7684\u300c\ud83d\udcbe \u4fdd\u5b58\u5168\u90e8\u8bbe\u7f6e\u300d\u4e00\u952e\u641e\u5b9a\u3002'},
      {q:'\u6210\u5c31\u600e\u4e48\u89e3\u9501\uff1f',a:'\u6b63\u5e38\u63a8\u8fdb\u6545\u4e8b\uff0cAI \u81ea\u52a8\u5224\u5b9a\u3002\u4f60\u53ea\u7ba1\u73a9\uff0c\u6210\u5c31\u81ea\u5df1\u6765\u3002'},
      {q:'\u6210\u5c31\u56fe\u6807\u4e3a\u4ec0\u4e48\u90fd\u4e00\u6837\uff1f',a:'200+ \u6210\u5c31\u6309\u7c7b\u578b\u5171\u7528 10 \u79cd\u56fe\u6807\uff1a\ud83d\udee1\ufe0f\u751f\u5b58 \u2694\ufe0f\u6218\u6597 \ud83d\udc95\u4eb2\u5bc6 \ud83e\udd23\u5947\u8469 \ud83d\uddfa\ufe0f\u63a2\u7d22 \ud83e\udd1d\u793e\u4ea4 \ud83d\udcd6\u6545\u4e8b \ud83c\udf31\u6210\u957f \ud83c\udf0d\u4e16\u754c \ud83c\udfae\u5143\u6210\u5c31\u3002\u540c\u7c7b\u91cc\u9760\u661f\u7ea7\u533a\u5206\u6863\u6b21\u3002'},
      {q:'\u89d2\u8272\u6b7b\u4e86\u600e\u4e48\u529e\uff1f',a:'10 \u8f6e\u540e\u6709\u6982\u7387\u8f6c\u751f\u5f52\u6765\uff0c\u4fdd\u7559\u90e8\u5206\u8bb0\u5fc6\u548c\u5173\u7cfb\u3002\u4e5f\u53ef\u4ee5\u53bb\u5f15\u64ce\u9875\u5173\u6389\u751f\u547d\u5468\u671f\u3002'},
      {q:'\u8bb0\u5fc6\u591a\u4e86\u4f1a\u4e0d\u4f1a\u5361\uff1f',a:'\u7cfb\u7edf\u81ea\u52a8\u5206\u51b7\u70ed\u8bb0\u5fc6 + \u88c1\u526a Token\u3002\u4f60\u53ef\u4ee5\u5728\u8bbe\u7f6e\u9875\u8c03\u300c\u70ed\u8bb0\u5fc6\u9608\u503c\u300d\u3002\u503c\u8d8a\u5927\uff0c\u6700\u65b0\u8bb0\u5fc6\u4fdd\u7559\u8d8a\u591a\u3002'},
      {q:'\u600e\u4e48\u624b\u52a8\u89e6\u53d1\u63a8\u6f14\uff1f',a:'\u5f15\u64ce\u9875 \u2192 \u6f14\u5316\u8bbe\u7f6e \u2192 \u70b9\u300c\u25b6\ufe0f \u624b\u52a8\u89e6\u53d1\u4e00\u8f6e\u63a8\u6f14\u300d\u3002'},
      {q:'\u4e16\u754c\u4e66\u600e\u4e48\u914d\uff1f',a:'\u4e16\u754c\u4e66\u9875 \u2192 \u52fe\u9009\u8981\u7528\u7684\u4e66 \u2192 \u70b9\u300c\u4fdd\u5b58\u300d\u3002\u53ef\u4ee5\u7cbe\u7ec6\u5230\u6bcf\u6761\u6761\u76ee\u662f\u5426\u52fe\u9009\u3002'},
      {q:'\u6211\u662f\u4e0d\u662f\u5fc5\u987b\u914d\u4e16\u754c\u6cd5\u5219\uff1f',a:'\u4e0d\u7528\u3002\u4e0d\u914d\u4e5f\u80fd\u73a9\u3002\u914d\u4e86\u80fd\u8ba9 AI \u66f4\u61c2\u4f60\u7684\u4e16\u754c\u3002'}
    ];
    faqs.forEach(function(f){
      html += '<div class="hp-step"><span class="sn" style="color:#f85149;">Q\uff1a</span> '+f.q+'<br><span class="sn" style="color:#7ee787;">A\uff1a</span> '+f.a+'</div>';
    });
    html += '</div></div>';

    // ========== \u8fdb\u9636\u53c2\u8003 ==========
    html += '<div class="world-engine-help-panel" id="world-engine-help-advanced" style="display:none;">';
    html += '<div class="card hp-sect"><h3>\u2699\ufe0f \u5f15\u64ce\u8be6\u89e3</h3>';
    html += '<h4>\u9a71\u52a8\u6a21\u5f0f\u4e09\u79cd</h4>';
    html += '<p><b>\u25b8 \u81ea\u52a8\u6a21\u5f0f</b>\uff1a\u6bcf\u8f6e\u6d88\u606f\u540e\u81ea\u52a8\u63a8\u6f14\u3002\u6c89\u6d78\u611f\u6700\u5f3a\uff0c\u4f60\u751a\u81f3\u611f\u89c9\u4e0d\u5230\u5b83\u5728\u5de5\u4f5c\u3002</p>';
    html += '<p><b>\u25b8 \u624b\u52a8\u6a21\u5f0f</b>\uff1a\u6bcf N \u6761\u6d88\u606f\u89e6\u53d1\u4e00\u6b21\u63a8\u6f14\u3002\u9002\u5408\u60f3\u63a7\u5236\u8282\u594f\u3001\u6216\u8005\u7701 API \u8d39\u7528\u7684\u60c5\u51b5\u3002N \u5728\u300c\u63a8\u6f14\u95f4\u9694\u300d\u8bbe\uff081~10 \u6761\uff09\u3002</p>';
    html += '<p><b>\u25b8 \u534a\u81ea\u52a8\u6a21\u5f0f</b>\uff1aAI \u751f\u6210\u5efa\u8bae\u8ba9\u4f60\u9884\u89c8\uff0c\u4f60\u786e\u8ba4\u540e\u624d\u6267\u884c\u3002\u9002\u5408\u6bcf\u6b21\u6f14\u5316\u90fd\u60f3\u770b\u518d\u6279\u7684\u300c\u63a7\u5236\u72c2\u300d\u7528\u6237\u3002</p>';
    html += '<hr class="hr"><h4>\u65f6\u95f4\u7cfb\u7edf\u600e\u4e48\u5de5\u4f5c</h4>';
    html += '<p>\u6bcf\u8f6e\u63a8\u6f14\u540e\uff0c\u65f6\u95f4\u8d70\u4e00\u4e2a\u589e\u91cf\uff08\u9ed8\u8ba4 30 \u5206\u949f\uff09\u3002<br>\u65f6\u95f4\u8de8\u8fc7\u9608\u503c\u65f6\uff1a<br>\u25b8 \u65e5\u591c\u5faa\u73af \u2192 NPC \u884c\u4e3a\u53d8\u5316\uff08\u665a\u4e0a\u8336\u9986\u5173\u95e8\uff09<br>\u25b8 \u5b63\u8282\u66ff\u6362 \u2192 \u7ecf\u6d4e/\u4e8b\u4ef6\u7c7b\u578b\u53d8\u5316\uff08\u51ac\u5929\u7269\u8d44\u77ed\u7f3a\uff09</p>';
    html += '<p>\u4f60\u4e5f\u53ef\u4ee5\u624b\u52a8\u6539\u65f6\u95f4\u6587\u672c\u3002\u5f15\u64ce\u4e0b\u4e00\u8f6e\u4ece\u65b0\u65f6\u95f4\u7ee7\u7eed\uff0c\u4e0d\u5f71\u54cd\u3002</p>';
    html += '<hr class="hr"><h4>\u51b7\u70ed\u8bb0\u5fc6</h4>';
    html += '<p>\ud83d\udd25 <b>\u70ed\u8bb0\u5fc6</b>\uff1a\u6700\u8fd1 N \u8f6e\u5185\u4ea7\u751f\u7684 + \u91cd\u8981\u6027\u9ad8\u7684 \u2192 \u6392\u5e8f\u4f18\u5148\uff0c\u4fdd\u8bc1 AI \u8bb0\u5f97\u6700\u65b0\u7684\u4e8b<br>\ud83e\uddca <b>\u51b7\u8bb0\u5fc6</b>\uff1a\u8d85\u8fc7\u8f6e\u6570\u9608\u503c\u7684 \u2192 \u6392\u5e8f\u9760\u540e\uff0c\u4f46\u4e0d\u4e22\u5f03</p>';
    html += '<p>\u5728\u300c\u8bbe\u7f6e \u2192 \u6570\u636e&\u5b58\u50a8\u300d\u8c03\u300c\u70ed\u8bb0\u5fc6\u9608\u503c\u300d\u3002\u503c\u8d8a\u5927\uff0c\u70ed\u8bb0\u5fc6\u8d8a\u591a\u3002</p>';
    html += '<hr class="hr"><h4>Token \u9884\u7b97 + \u667a\u80fd\u6298\u53e0</h4>';
    html += '<p>\u5f15\u64ce\u6ce8\u5165\u5230 AI \u7684\u5185\u5bb9\u4e0d\u80fd\u8d85\u8fc7\u4e0a\u4e0b\u6587\u7a97\u53e3\u3002\u6240\u4ee5\uff1a</p>';
    html += '<p>1. <b>Token \u9884\u7b97</b>\uff1a\u8bbe\u7f6e\u6700\u5927\u6ce8\u5165\u91cf\uff08\u9ed8\u8ba4 4096\uff09<br>2. <b>\u667a\u80fd\u6298\u53e0</b>\uff1a\u4e09\u4e2a\u4f18\u5148\u7ea7\u2014\u2014</p>';
    html += '<ul><li>\ud83d\udd34 <b>\u5173\u952e</b>\uff08\u6545\u4e8b\u65b9\u5411/\u4e16\u754c\u6cd5\u5219\uff09\u2192 \u6c38\u8fdc\u6ce8\u5165</li><li>\ud83d\udfe1 <b>\u666e\u901a</b>\uff08\u8fd1\u671f\u8bb0\u5fc6/\u60c5\u611f\u72b6\u6001\uff09\u2192 \u9884\u7b97\u591f\u5c31\u6ce8\u5165</li><li>\ud83d\udfe2 <b>\u8865\u5145</b>\uff08\u6210\u5c31\u56de\u54cd/\u73af\u5883\u63cf\u8ff0\uff09\u2192 \u9884\u7b97\u6709\u5269\u624d\u6ce8\u5165</li></ul>';
    html += '<hr class="hr"><h4>\u60c5\u611f\u72b6\u6001\u673a\uff088\u6001\uff09</h4>';
    html += '<p>\u89d2\u8272\u4e0d\u662f\u53ea\u6709\u300c\u53cb\u597d/\u654c\u5bf9\u300d\u3002\u4ed6\u4eec\u6709 8 \u79cd\u60c5\u611f\uff1a<br>\u53cb\u597d \ud83d\udfe2 \u00b7 \u6109\u5feb \ud83d\udfe1 \u00b7 \u4e2d\u7acb \u26aa \u00b7 \u70e6\u8e81 \ud83d\udfe0 \u00b7 \u6124\u6012 \ud83d\udd34 \u00b7 \u60b2\u4f24 \ud83d\udd35 \u00b7 \u6050\u60e7 \ud83d\udfe3 \u00b7 \u60ca\u8bb6 \ud83d\udfe4</p>';
    html += '<p>\u4e8b\u4ef6\u89e6\u53d1\u72b6\u6001\u8f6c\u79fb\uff1a<br>\u25b8 \u6218\u6597\u8d62\u4e86 \u2192 \u53ef\u80fd\u53d8\u6109\u5feb/\u53cb\u597d<br>\u25b8 \u88ab\u80cc\u53db\u4e86 \u2192 \u53ef\u80fd\u53d8\u6124\u6012/\u60b2\u4f24<br>\u25b8 \u6536\u5230\u793c\u7269 \u2192 \u53ef\u80fd\u53d8\u6109\u5feb/\u60ca\u8bb6<br>\u25b8 \u88ab\u4fae\u8fb1\u4e86 \u2192 \u53ef\u80fd\u53d8\u6124\u6012/\u70e6\u8e81</p>';
    html += '<p>5 \u8f6e\u6ca1\u4e92\u52a8\uff0c\u60c5\u611f\u6162\u6162\u8870\u51cf\u56de\u4e2d\u7acb\u3002\u5728\u5f15\u64ce\u9875\u53ef\u8c03\u8870\u51cf\u901f\u5ea6\u3002</p>';
    html += '<hr class="hr"><h4>\u89d2\u8272\u751f\u547d\u5468\u671f\uff085\u6001\uff09</h4>';
    html += '<ul><li>\ud83d\udfe2 <b>\u5b58\u6d3b</b>\uff1a\u9ed8\u8ba4\u72b6\u6001\uff0c\u6b63\u5e38\u6d3b\u52a8</li><li>\ud83d\udfe1 <b>\u6fd2\u6b7b</b>\uff1a\u6218\u6597\u91cd\u4f24\u540e\u8fdb\u5165\uff0c3 \u8f6e\u5185\u4e0d\u6551\u6cbb\u5c31\u2026\u2026</li><li>\ud83d\udd34 <b>\u6b7b\u4ea1</b>\uff1a\u89d2\u8272\u6b7b\u4ea1\uff0c\u4e0d\u80fd\u518d\u4e92\u52a8</li><li>\ud83d\udfe3 <b>\u8f6c\u751f</b>\uff1a\u6b7b\u4ea1 10 \u8f6e\u540e\uff0c10% \u6982\u7387\u8f6c\u751f\u5f52\u6765\uff0c\u4fdd\u7559\u90e8\u5206\u8bb0\u5fc6</li><li>\ud83d\udd35 <b>\u4f11\u7720</b>\uff1a\u6682\u65f6\u6d88\u5931\uff08\u88ab\u6253\u6655/\u88ab\u6293\u8d70\uff09\uff0c5 \u8f6e\u540e\u53ef\u80fd\u56de\u5f52</li></ul>';
    html += '<p>\u4e0d\u60f3\u73a9\u751f\u6b7b\uff1f\u5728\u5f15\u64ce\u9875\u5173\u6389\u751f\u547d\u5468\u671f\u5c31\u884c\u3002</p></div>';

    html += '<div class="card hp-sect"><h3>\ud83d\udcd6 \u6545\u4e8b\u8fdb\u9636\u64cd\u4f5c</h3>';
    html += '<h4>\u7528\u6a21\u677f\u63a7\u5236\u6545\u4e8b\u8d70\u5411</h4>';
    html += '<p>\u6545\u4e8b\u6a21\u677f\u4e0d\u662f\u6446\u8bbe\u2014\u2014<br>\u9009\u300c\u82f1\u96c4\u4e4b\u65c5\u300d\u2192 AI \u6309\u82f1\u96c4\u4e4b\u65c5\u7684\u8282\u594f\u63a8\u5267\u60c5<br>\u9009\u300c\u8ff7\u6848\u4fa6\u63a2\u300d\u2192 AI \u5236\u9020\u8c1c\u56e2\u548c\u7ebf\u7d22<br>\u9009\u300c\u60b2\u5267\u300d\u2192 \u4f60\u61c2\u7684</p>';
    html += '<p><b>\u600e\u4e48\u9009\uff1f</b>\u6253\u5f00\u300c\u6545\u4e8b \u2192 \u6545\u4e8b\u7c7b\u578b\u5206\u6790\u300d\uff1a<br>1. \u9876\u90e8\u4e0b\u62c9\u9009\u6a21\u677f<br>2. \u5e95\u90e8\u4e0b\u62c9\u9009\u57fa\u8c03<br>3. \u70b9 \ud83d\udcbe \u4fdd\u5b58</p>';
    html += '<hr class="hr"><h4>\u624b\u52a8\u63a8\u8fdb\u6545\u4e8b\u9636\u6bb5</h4>';
    html += '<p>\u6bcf\u4e2a\u6a21\u677f\u5206\u591a\u4e2a\u9636\u6bb5\u3002\u9ed8\u8ba4 10 \u8f6e\u81ea\u52a8\u63a8\u8fdb\u4e00\u6b21\u3002<br>\u4f60\u4e5f\u53ef\u4ee5\u5173\u6389\u81ea\u52a8\u63a8\u8fdb\uff0c\u5168\u7a0b\u624b\u63a7\u3002</p>';
    html += '<hr class="hr"><h4>\u5267\u60c5\u7ebf\u7d22\u677f</h4>';
    html += '<p>\u6545\u4e8b\u81ea\u52a8\u751f\u6210\u591a\u7ebf\u53d9\u4e8b\uff08\u50cf\u7f8e\u5267\uff09\u3002\u6bcf\u6761\u7ebf\u7d22\u6709\u540d\u5b57\u3001\u72b6\u6001\u3001\u9636\u6bb5\u3001\u5173\u8054\u89d2\u8272\u3002<br>\u4f60\u5728\u6545\u4e8b\u9875\u53ef\u624b\u52a8\u63a8\u8fdb\u6216\u5b8c\u7ed3\u67d0\u6761\u7ebf\u7d22\u3002</p>';
    html += '<hr class="hr"><h4>\u89d2\u8272\u753b\u50cf</h4>';
    html += '<p>\u7cfb\u7edf\u81ea\u52a8\u7ed9\u6bcf\u4e2a\u91cd\u8981\u89d2\u8272\u5efa\u753b\u50cf\u3002\u70b9\u5361\u7247\u5f39\u51fa\u7f16\u8f91\u7a97\uff0c\u53ef\u6539\u4e2a\u6027\u6807\u7b7e\u3001\u5173\u7cfb\u3001\u52a0\u5173\u952e\u4e8b\u4ef6\u3002</p>';
    html += '<hr class="hr"><h4>\u4e16\u754c\u5206\u6790</h4>';
    html += '<p>\u70b9\u300c\u5f00\u59cb\u5206\u6790\u300d\uff0cAI \u770b\u4e16\u754c\u4e66 + \u4e16\u754c\u72b6\u6001\uff0c\u751f\u6210\u5206\u6790\u62a5\u544a\u3002\u591a\u6b21\u5206\u6790\u53ef\u56de\u6eaf\u5bf9\u6bd4\u3002</p></div>';

    html += '<div class="card hp-sect"><h3>\ud83c\udf10 \u4e16\u754c\u6cd5\u5219</h3>';
    html += '<h4>6 \u5957\u9884\u8bbe\u6846\u67b6</h4>';
    html += '<p>\u9ad8\u9b54\u4ed9\u4fa0 \u00b7 \u8d5b\u535a\u4ed9\u4fa0 \u00b7 \u4f4e\u9b54\u73b0\u5b9e \u00b7 \u84b8\u6c7d\u670b\u514b \u00b7 \u6b66\u4fa0\u6c5f\u6e56 \u00b7 \u5e9f\u571f\u6c42\u751f</p>';
    html += '<p>\u9009\u4e00\u4e2a\uff0c5 \u4e2a\u7ef4\u5ea6\uff08\u9b54\u529b\u6d53\u5ea6/\u79d1\u6280\u6c34\u5e73/\u8d85\u81ea\u7136\u5b58\u5728/\u7edf\u6cbb\u5f62\u6001/\u6838\u5fc3\u51b2\u7a81\uff09\u81ea\u52a8\u586b\u597d\u3002\u4e4b\u540e\u6bcf\u4e2a\u7ef4\u5ea6\u8fd8\u80fd\u5355\u72ec\u5fae\u8c03\u3002</p>';
    html += '<h4>\u81ea\u5b9a\u4e49\u89c4\u5219</h4>';
    html += '<p>\u9884\u8bbe\u4e0d\u591f\u7528\uff1f\u52a0\u81ea\u5df1\u7684\u89c4\u5219\u3002\u6bd4\u5982\u300c\u9f99\u65cf\u4e0d\u53ef\u4fb5\u72af\u300d\u2192 \u5199\u8fdb\u53bb \u2192 \u70b9\u6dfb\u52a0\u3002<br>\u6bcf\u6761\u89c4\u5219\u4ee5\u6807\u7b7e\u5f62\u5f0f\u663e\u793a\uff0c\u53ef\u5355\u72ec\u5220\u9664\u3002</p></div>';

    html += '<div class="card hp-sect"><h3>\ud83c\udfc6 \u6210\u5c31\u7cfb\u7edf\u5168\u90e8\u7ec6\u8282</h3>';
    html += '<h4>\u7a00\u6709\u5ea6\u7b49\u7ea7</h4>';
    html += '<ul>';
    html += '<li><span class="gold">\u2605 \u5171\u901a</span> \u2014 \u57fa\u7840\u884c\u4e3a\uff0c\u5927\u6982\u7387\u89e3\u9501</li>';
    html += '<li><span class="blue">\u2605\u2605 \u7a00\u6709</span> \u2014 \u7279\u6b8a\u4e8b\u4ef6\u89e6\u53d1</li>';
    html += '<li><span style="color:#bc8cff;">\u2605\u2605\u2605 \u53f2\u8bd7</span> \u2014 \u91cd\u8981\u91cc\u7a0b\u7891</li>';
    html += '<li><span class="gold">\u2605\u2605\u2605\u2605 \u4f20\u8bf4</span> \u2014 \u6781\u96be\u8fbe\u6210\u7684\u4f20\u5947\u6210\u5c31</li>';
    html += '<li><span class="red">?? \u9690\u85cf</span> \u2014 \u672a\u77e5\u6761\u4ef6\uff0c\u9ed8\u8ba4\u4e0d\u663e\u793a</li></ul>';
    html += '<h4>\u8fde\u51fb</h4>';
    html += '<p>\u8fde\u7eed\u89e3\u9501\u6210\u5c31 \u2192 \u8fde\u51fb\u8ba1\u6570 \u2192 \u5fbd\u7ae0<br>2=\u53cc\u54cd\u70ae \u2192 3=\u4e09\u8fde\u6740 \u2192 4=\u56db\u91cd\u594f \u2192 5=\u4e94\u661f\u8fde\u73e0 \u2192 \u2026 \u2192 10=\u5341\u5168\u5341\u7f8e</p>';
    html += '<hr class="hr"><h4>\u91cc\u7a0b\u7891\u68cb\u76d8\u683c</h4>';
    html += '<p>\u6210\u5c31\u9875\u9876\u90e8\u7684\u683c\u5b50\u5730\u56fe\uff1a\ud83c\udfc6 \u5df2\u89e3\u9501 / \u2753 \u5df2\u63ed\u793a / \ud83c\udf2b \u8ff7\u96fe\u672a\u77e5\u3002<br>\u60ac\u505c\u770b\u540d\u5b57\uff0c\u70b9\u51fb\u8df3\u5230\u6210\u5c31\u5217\u8868\u3002</p>';
    html += '<h4>\u56de\u54cd</h4>';
    html += '<p>\u89e3\u9501\u7684\u6210\u5c31\u4f1a\u8fdb\u5165\u56de\u54cd\u961f\u5217\uff08\u6700\u591a 5 \u6761\uff09\uff0c\u81ea\u52a8\u6ce8\u5165 AI \u4e0a\u4e0b\u6587\u3002<br>AI \u77e5\u9053\u4f60\u6700\u8fd1\u62ff\u4e86\u4ec0\u4e48\u6210\u5c31\uff0c\u5728\u6545\u4e8b\u4e2d\u4f53\u73b0\u3002</p></div>';

    html += '<div class="card hp-sect"><h3>\ud83d\udcda \u4e16\u754c\u4e66</h3>';
    html += '<p><b>\u4e0b\u62c9\u9009\u4e66</b>\uff1a\u4ece dropdown \u9009\u62e9\u4e00\u672c\u4e16\u754c\u4e66\uff0c\u53ef\u8f93\u5165\u641c\u7d22\u8fc7\u6ee4\u3002<br><b>\u6fc0\u6d3b</b>\uff1a\u9009\u4e2d\u67d0\u672c\u4e66\u540e\u70b9\u300c\u6fc0\u6d3b\u5f53\u524d\u4e66\u300d\u3002\u53ea\u6709\u6fc0\u6d3b\u7684\u4e66\u624d\u4f1a\u6ce8\u5165\u3002<br><b>\u52fe\u9009\u6761\u76ee</b>\uff1a\u6fc0\u6d3b\u540e\u663e\u793a\u5168\u90e8\u6761\u76ee\uff0c\u53ef\u5355\u72ec\u52fe\u9009\u54ea\u4e9b\u8981\u6ce8\u5165\u3002<br><b>\u4fdd\u5b58</b>\uff1a\u5206\u522b\u4fdd\u5b58\u4e66\u7ea7\u548c\u6761\u76ee\u7ea7\u9009\u62e9\u3002</p></div>';

    html += '<div class="card hp-sect"><h3>\ud83d\udcbe \u5feb\u7167\u3001\u5907\u4efd\u3001\u9884\u8bbe</h3>';
    html += '<h4>\u81ea\u52a8\u5907\u4efd</h4>';
    html += '<p>\u6bcf N \u8f6e\u81ea\u52a8\u4fdd\u5b58\u4e00\u6b21\u4e16\u754c\u72b6\u6001\uff08N \u4f60\u8bbe\uff0c\u9ed8\u8ba4 10 \u8f6e\uff09\u3002\u5b58\u5728\u6d4f\u89c8\u5668\u672c\u5730\u3002</p>';
    html += '<h4>\u624b\u52a8\u5feb\u7167</h4>';
    html += '<p>\u968f\u65f6\u300c\u5bfc\u51fa\u5feb\u7167\u300d\u2192 \u4e0b\u8f7d JSON \u6587\u4ef6\u3002\u300c\u5bfc\u5165\u5feb\u7167\u300d\u2192 \u4e0a\u4f20\u6062\u590d\u3002</p>';
    html += '<h4>\u4fdd\u5b58\u70b9\u673a\u5236</h4>';
    html += '<p>\u6bcf\u6b21\u63a8\u6f14\u524d\u81ea\u52a8\u521b\u5efa\u4fdd\u5b58\u70b9\uff08\u6700\u591a 30 \u4e2a\uff09\u3002\u5220\u9664\u6d88\u606f\u65f6\u81ea\u52a8\u56de\u6eda\u5230\u6700\u8fd1\u7684\u6709\u6548\u70b9\u3002</p>';
    html += '<h4>\u9884\u8bbe\u7cfb\u7edf</h4>';
    html += '<p>\u9884\u8bbe = \u6240\u6709\u6ce8\u5165\u8bbe\u7f6e\u6253\u5305\u3002\u53ef\u5efa\u591a\u4e2a\uff08\u6218\u6597\u7248/\u63a2\u7d22\u7248/\u5bf9\u8bdd\u7248\uff09\uff0c\u5feb\u901f\u5207\u6362\u3002</p></div></div>';

    cont.innerHTML = html;

    // bind help tab switching
    setTimeout(function(){
      document.querySelectorAll('.world-engine-help-tab-btn').forEach(function(btn){
        btn.addEventListener('click', function(){
          document.querySelectorAll('.world-engine-help-tab-btn').forEach(function(b){
            b.style.color = '#8b949e';
            b.style.borderBottomColor = 'transparent';
            b.style.fontWeight = '400';
          });
          document.querySelectorAll('.world-engine-help-panel').forEach(function(p){ p.style.display = 'none'; });
          this.style.color = '#f0c040';
          this.style.borderBottomColor = '#f0c040';
          this.style.fontWeight = '600';
          document.getElementById('world-engine-help-' + this.dataset.htab).style.display = 'block';
        });
      });
    }, 50);
  }

  /* ═══════════════════ EXPORTS ═══════════════════ */
  return {
    buildUI: buildUI,
    switchTab: switchTab,
    refresh: refresh,
    resetUI: resetUI,
    hidePanel: hidePanel,
    showPanel: showPanel,
    togglePanel: togglePanel,
    makeDraggableModal: makeDraggableModal,
    applyConfig: applyConfig,
    requestConfigApply: requestConfigApply,
  };
})();
