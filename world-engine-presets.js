// world-engine-presets.js — 预设系统：4 种内置预设 + CRUD + 存储 + 导入导出
// ============================================================
// v2.5.0 — 新增模块
// ============================================================
// 哲学：预设只控制「数据格式、汇报方式、清洗规则」
// 不添加 behavior_rules / hard_gate / content_rate 等行为约束
// ============================================================

window.WORLD_ENGINE_PRESETS = (function() {
  'use strict';

  // ==================== 内置预设 ====================
  function getDefaultPresets() {
    return [
      // ───── 标准模式（与 v2.4 完全相同） ─────
      {
        id: 'standard',
        name: '标准模式',
        version: '2.5.0',
        labels: {
          panelTitle: '【世界状态摘要】',
          memoryTitle: '【相关记忆】',
          worldbookTitle: '【世界书参考】',
          roundLabel: '轮次',
          worldDigestLabel: '世界大势',
          eventsLabel: '事件链',
          factionsLabel: '势力',
          factionRelationsLabel: '势力关系',
          rumorsLabel: '流言',
          bloodFeudLabel: '血仇',
          causalChainLabel: '因果链',
          economyLabel: '经济',
          reputationLabel: '声誉',
          emotionLabel: '关键情感',
          emptyEvents: '无',
          emptyMemory: '无相关记忆',
          emptyWorldbook: '',
          preamble: '',
          postscript: '注意：以上是世界背景和近期记忆，请在剧情中自然地融入，不要生硬复述。'
        },
        sections: {
          statePanel: true,
          emotion: true,
          memory: true,
          worldbook: false,
          economy: true,
          factionRelations: true,
          causalChain: true
        },
        maxMemories: 10,
        maxRumors: 3,
        maxEmotions: 5,
        useSeparators: true,
        separatorStyle: 'block',
        showEmptySections: true,
        excludeRanges: [
          { start: '<thinking>', end: '</thinking>' },
          { start: '<think>', end: '</think>' },
          { start: '<review>', end: '</review>' },
          { start: '<refine>', end: '</refine>' },
          { start: '<Analysis', end: '</Analysis>' },
          { start: '<tucao', end: '</tucao>' },
          { start: '<disclaimer', end: '</disclaimer>' }
        ],
        minRoundCount: 0,
        skipEmptyState: false,
        minChatLength: 0
      },

      // ───── 精简模式 ─────
      {
        id: 'minimal',
        name: '精简模式',
        version: '2.5.0',
        labels: {
          panelTitle: '【世界概况】',
          memoryTitle: '【记忆】',
          worldbookTitle: '【世界书】',
          roundLabel: '轮次',
          worldDigestLabel: '概况',
          eventsLabel: '事件',
          factionsLabel: '势力',
          factionRelationsLabel: '关系',
          rumorsLabel: '流言',
          bloodFeudLabel: '血仇',
          causalChainLabel: '因果链',
          economyLabel: '经济',
          reputationLabel: '声望',
          emotionLabel: '情感',
          emptyEvents: '—',
          emptyMemory: '—',
          emptyWorldbook: '',
          preamble: '',
          postscript: '注意：以上世界状态仅供参考。'
        },
        sections: {
          statePanel: true,
          emotion: false,
          memory: true,
          worldbook: false,
          economy: false,
          factionRelations: false,
          causalChain: false
        },
        maxMemories: 3,
        maxRumors: 1,
        maxEmotions: 0,
        useSeparators: false,
        separatorStyle: 'none',
        showEmptySections: false,
        excludeRanges: [
          { start: '<thinking>', end: '</thinking>' },
          { start: '<think>', end: '</think>' }
        ],
        minRoundCount: 2,
        skipEmptyState: true,
        minChatLength: 100
      },

      // ───── 简洁模式 ─────
      {
        id: 'clean',
        name: '简洁模式',
        version: '2.5.0',
        labels: {
          panelTitle: '',
          memoryTitle: '',
          worldbookTitle: '',
          roundLabel: '#',
          worldDigestLabel: '',
          eventsLabel: '',
          factionsLabel: '',
          factionRelationsLabel: '',
          rumorsLabel: '',
          bloodFeudLabel: '',
          causalChainLabel: '',
          economyLabel: '',
          reputationLabel: '',
          emotionLabel: '',
          emptyEvents: '',
          emptyMemory: '',
          emptyWorldbook: '',
          preamble: '',
          postscript: ''
        },
        sections: {
          statePanel: true,
          emotion: true,
          memory: true,
          worldbook: false,
          economy: false,
          factionRelations: false,
          causalChain: false
        },
        maxMemories: 5,
        maxRumors: 2,
        maxEmotions: 3,
        useSeparators: false,
        separatorStyle: 'none',
        showEmptySections: false,
        excludeRanges: [
          { start: '<thinking>', end: '</thinking>' },
          { start: '<think>', end: '</think>' },
          { start: '<review>', end: '</review>' },
          { start: '<refine>', end: '</refine>' },
          { start: '<Analysis', end: '</Analysis>' },
          { start: '<tucao', end: '</tucao>' },
          { start: '<disclaimer', end: '</disclaimer>' }
        ],
        minRoundCount: 1,
        skipEmptyState: true,
        minChatLength: 50
      },

      // ───── 自定义模式 ─────
      {
        id: 'custom',
        name: '自定义',
        version: '2.5.0',
        labels: {
          panelTitle: '【世界状态摘要】',
          memoryTitle: '【相关记忆】',
          worldbookTitle: '【世界书参考】',
          roundLabel: '轮次',
          worldDigestLabel: '世界大势',
          eventsLabel: '事件链',
          factionsLabel: '势力',
          factionRelationsLabel: '势力关系',
          rumorsLabel: '流言',
          bloodFeudLabel: '血仇',
          causalChainLabel: '因果链',
          economyLabel: '经济',
          reputationLabel: '声誉',
          emotionLabel: '关键情感',
          emptyEvents: '无',
          emptyMemory: '无相关记忆',
          emptyWorldbook: '',
          preamble: '',
          postscript: '注意：以上是世界背景和近期记忆，请在剧情中自然地融入，不要生硬复述。'
        },
        sections: {
          statePanel: true,
          emotion: true,
          memory: true,
          worldbook: false,
          economy: true,
          factionRelations: true,
          causalChain: true
        },
        maxMemories: 10,
        maxRumors: 3,
        maxEmotions: 5,
        useSeparators: true,
        separatorStyle: 'block',
        showEmptySections: true,
        excludeRanges: [
          { start: '<thinking>', end: '</thinking>' },
          { start: '<think>', end: '</think>' },
          { start: '<review>', end: '</review>' },
          { start: '<refine>', end: '</refine>' },
          { start: '<Analysis', end: '</Analysis>' },
          { start: '<tucao', end: '</tucao>' },
          { start: '<disclaimer', end: '</disclaimer>' }
        ],
        minRoundCount: 0,
        skipEmptyState: false,
        minChatLength: 0
      }
    ];
  }

  // ==================== 存储 ====================
  var STORAGE_KEY = 'world_engine_presets';
  var ACTIVE_KEY = 'world_engine_active_preset';

  function loadPresetsFromStorage() {
    try {
      var raw = window.WORLD_ENGINE_STORAGE.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) { console.warn('[World Engine Presets] 读取存储失败', e); }
    return null;
  }

  function savePresetsToStorage(presets) {
    try { window.WORLD_ENGINE_STORAGE.setItem(STORAGE_KEY, JSON.stringify(presets)); }
    catch(e) { console.warn('[World Engine Presets] 保存失败', e); }
  }

  // ==================== 预设加载 ====================
  function getDefaultPresetsRef() {
    return getDefaultPresets();
  }

  function loadPresets() {
    var defaults = getDefaultPresets();
    return [JSON.parse(JSON.stringify(defaults[0]))];
  }

  // ==================== 激活的预设 ====================
  function getActivePreset() {
    var defaults = getDefaultPresets();
    return JSON.parse(JSON.stringify(defaults[0]));
  }

  function setActivePreset(presetId) {
    var all = loadPresets();
    var exists = all.some(function(p) { return p.id === presetId; });
    if (!exists) return false;
    try { window.WORLD_ENGINE_STORAGE.setItem(ACTIVE_KEY, presetId); } catch(e) { return false; }
    return true;
  }

  function listPresets() {
    return loadPresets().map(function(p) {
      return { id: p.id, name: p.name, version: p.version };
    });
  }

  // ==================== CRUD ====================
  function createPreset(name, baseId) {
    var all = loadPresets();
    // 找 base 模板
    var base = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === baseId) { base = all[i]; break; }
    }
    if (!base) base = all[0];
    if (!base) return null;

    var newId = 'custom_' + Date.now();
    var newPreset = JSON.parse(JSON.stringify(base));
    newPreset.id = newId;
    newPreset.name = name || ('自定义 ' + (all.length + 1));
    newPreset.version = '2.5.0';
    all.push(newPreset);
    savePresetsToStorage(all);
    return newPreset;
  }

  function updatePreset(presetId, patch) {
    var all = loadPresets();
    var found = false;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === presetId) {
        // 合并 patch（深层次合并 labels / sections / excludeRanges）
        if (patch.labels) {
          // 合并而非替换：避免 UI 未提供的标签字段被清空
          all[i].labels = Object.assign({}, all[i].labels, patch.labels);
        }
        if (patch.sections) {
          all[i].sections = patch.sections;
        }
        if (patch.excludeRanges) {
          all[i].excludeRanges = patch.excludeRanges;
        }
        // 标量直接覆盖
        for (var key in patch) {
          if (key === 'labels' || key === 'sections' || key === 'excludeRanges') continue;
          all[i][key] = patch[key];
        }
        found = true;
        break;
      }
    }
    if (!found) return false;
    savePresetsToStorage(all);
    return true;
  }

  function deletePreset(presetId) {
    var all = loadPresets();
    // 不允许删除内置预设
    var builtinIds = { default: true };
    if (builtinIds[presetId]) return false;

    var idx = -1;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === presetId) { idx = i; break; }
    }
    if (idx === -1) return false;
    all.splice(idx, 1);

    // 如果删除的是激活预设，切回标准
    var activeId = null;
    try { activeId = window.WORLD_ENGINE_STORAGE.getItem(ACTIVE_KEY); } catch(e) {}
    if (activeId === presetId) {
      try { window.WORLD_ENGINE_STORAGE.setItem(ACTIVE_KEY, 'standard'); } catch(e) {}
    }

    savePresetsToStorage(all);
    return true;
  }

  function resetPreset(presetId) {
    var defaults = getDefaultPresets();
    var def = null;
    for (var i = 0; i < defaults.length; i++) {
      if (defaults[i].id === presetId) { def = defaults[i]; break; }
    }
    if (!def) return false;
    var all = loadPresets();
    var found = false;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === presetId) {
        all[i] = JSON.parse(JSON.stringify(def));
        found = true;
        break;
      }
    }
    if (!found) {
      all.push(JSON.parse(JSON.stringify(def)));
    }
    savePresetsToStorage(all);
    return true;
  }

  // ==================== 导出 / 导入 ====================
  function exportPreset(presetId) {
    var all = loadPresets();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === presetId) {
        return JSON.stringify(all[i], null, 2);
      }
    }
    return null;
  }

  function importPreset(jsonString) {
    try {
      var data = JSON.parse(jsonString);
      if (!data || !data.id || !data.labels || !data.sections) {
        return { success: false, error: '无效的预设格式：缺少 id/labels/sections' };
      }
      // 确保不覆盖内置预设
      var builtinIds = { default: true };
      if (builtinIds[data.id]) {
        // 导入为自定义
        data.id = 'imported_' + Date.now();
        data.name = (data.name || '导入预设') + ' (导入)';
      }
      var all = loadPresets();
      // 检查是否已存在同名
      var dup = false;
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === data.id) { dup = true; break; }
      }
      if (dup) {
        data.id = data.id + '_' + Date.now();
      }
      all.push(data);
      savePresetsToStorage(all);
      return { success: true, preset: data };
    } catch(e) {
      return { success: false, error: 'JSON 解析失败: ' + e.message };
    }
  }

  // ==================== SPreset 兼容 ====================
  function exportToSPreset(presetId) {
    var all = loadPresets();
    var preset = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === presetId) { preset = all[i]; break; }
    }
    if (!preset) return null;

    var spreset = {
      version: '1.0',
      name: preset.name,
      contextExcludeRules: (preset.excludeRanges || []).map(function(r) {
        return r.start + '...' + r.end;
      }),
      finalSystemDirective: preset.labels.postscript || ''
    };
    return JSON.stringify(spreset, null, 2);
  }

  function importFromSPreset(jsonString) {
    try {
      var data = JSON.parse(jsonString);
      if (!data || typeof data !== 'object') {
        return { success: false, error: '无效的 SPreset JSON' };
      }

      // 提取排除规则
      var excludeRanges = [];
      if (Array.isArray(data.contextExcludeRules)) {
        data.contextExcludeRules.forEach(function(rule) {
          if (typeof rule !== 'string') return;
          // 格式: "<thinking>...</thinking>"
          var parts = rule.split('...');
          if (parts.length === 2) {
            excludeRanges.push({ start: parts[0], end: parts[1] });
          }
        });
      }

      // 提取后置指令
      var postscript = data.finalSystemDirective || '';

      return {
        success: true,
        excludeRanges: excludeRanges,
        postscript: postscript
      };
    } catch(e) {
      return { success: false, error: 'JSON 解析失败: ' + e.message };
    }
  }

  // ==================== 排除规则引擎 ====================
  function cleanContext(text, excludeRanges) {
    if (!excludeRanges || !Array.isArray(excludeRanges) || excludeRanges.length === 0) {
      return text;
    }
    var cleaned = text;
    for (var i = 0; i < excludeRanges.length; i++) {
      var rule = excludeRanges[i];
      if (!rule.start || !rule.end) continue;
      var escapedStart = rule.start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var escapedEnd = rule.end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        var regex = new RegExp(escapedStart + '[\\s\\S]*?' + escapedEnd, 'g');
        cleaned = cleaned.replace(regex, '');
      } catch(e) {
        console.warn('[World Engine Presets] 排除规则正则失败:', rule, e);
      }
    }
    return cleaned;
  }

  // ==================== 世界状态空检查 ====================
  function isWorldStateEmpty(state) {
    if (!state) return true;
    if (state.events && state.events.length > 0) return false;
    if (state.memories && state.memories.length > 0) return false;
    if (state.rumors && state.rumors.length > 0) return false;
    if (state.bloodFeudMemo && state.bloodFeudMemo.length > 0) return false;
    if (state.factions && state.factions.length > 0) return false;
    if (state.causalChain && state.causalChain.length > 0) return false;
    if (state.factionRelations && state.factionRelations.length > 0) return false;
    if (state.emotionMap && Object.keys(state.emotionMap).length > 0) return false;
    return true;
  }

  // ==================== A/B 注入风格 ====================
  // ★ v3.0.0: A/B 注入风格
  var INJECT_STYLES = {
    standard: {
      name: '标准（叙述式）',
      preamble: '',
      postscript: '注意：以上是世界背景和近期记忆，请在剧情中自然地融入，不要生硬复述。'
    },
    alternative: {
      name: '简洁（指令式）',
      preamble: '[系统信息]',
      postscript: '融入以上世界状态到接下来的回复中，保持角色一致性。'
    }
  };

  function getInjectStyle() {
    try { return window.WORLD_ENGINE_STORAGE.getItem('world_engine_inject_style') || 'standard'; } catch(e) { return 'standard'; }
  }

  function setInjectStyle(style) {
    if (!INJECT_STYLES[style]) return false;
    try { window.WORLD_ENGINE_STORAGE.setItem('world_engine_inject_style', style); return true; } catch(e) { return false; }
  }

  function getInjectStyleNames() {
    var names = {};
    for (var key in INJECT_STYLES) names[key] = INJECT_STYLES[key].name;
    return names;
  }

  function applyInjectStyle(preset, style) {
    if (!style) style = getInjectStyle();
    var sty = INJECT_STYLES[style] || INJECT_STYLES.standard;
    if (sty) {
      preset.labels.preamble = sty.preamble;
      preset.labels.postscript = sty.postscript;
    }
    return preset;
  }

  // ==================== 公开 API ====================
  return {
    getDefaultPresets: getDefaultPresetsRef,
    loadPresets: loadPresets,
    getActivePreset: getActivePreset,
    setActivePreset: setActivePreset,
    listPresets: listPresets,
    createPreset: createPreset,
    updatePreset: updatePreset,
    deletePreset: deletePreset,
    resetPreset: resetPreset,
    exportPreset: exportPreset,
    importPreset: importPreset,
    exportToSPreset: exportToSPreset,
    importFromSPreset: importFromSPreset,
    cleanContext: cleanContext,
    isWorldStateEmpty: isWorldStateEmpty,
    getInjectStyle: getInjectStyle,
    setInjectStyle: setInjectStyle,
    getInjectStyleNames: getInjectStyleNames,
    applyInjectStyle: applyInjectStyle,
  };
})();
