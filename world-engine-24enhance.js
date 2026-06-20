// world-engine-24enhance.js — 24项UI增强模块（独立自包含）
// ============================================================
// 与现有插件完全兼容，不修改任何现有文件
// 通过扩展核心API + MutationObserver + 包装演化函数实现

(function() {
  'use strict';
  if (window.__WORLD_ENGINE_24_ENHANCED__) return;
  window.__WORLD_ENGINE_24_ENHANCED__ = true;

  var core = window.WORLD_ENGINE_CORE;
  if (!core) { console.warn('[24enh] WORLD_ENGINE_CORE not found'); return; }

  // ============================================================
  // 第〇部分：核心扩展 — 新增数据结构和API
  // ============================================================

  // --- 扩展 loadState 确保新字段存在 ---
  var origLoadState = core.loadState;
  core.loadState = function() {
    var state = origLoadState.call(core);
    if (!state.undoHistory) state.undoHistory = [];
    if (!state.recycleBin) state.recycleBin = [];
    if (!state.memoryAssociations) state.memoryAssociations = [];
    if (!state.weather) state.weather = guessWeather(state);
    if (!state.season) state.season = guessSeason(state);
    if (!state.panelState) state.panelState = {};
    if (!state.lastEvolveResult) state.lastEvolveResult = null;
    if (!state.achTypeFilter) state.achTypeFilter = 'all';
    if (!state.chapters) state.chapters = [];
    if (!state.activeChapter) state.activeChapter = null;
    if (!state.evolveSchedule) state.evolveSchedule = { enabled: false, interval: 0, timerId: null };
    if (!state.autoHidePanel) state.autoHidePanel = false;
    return state;
  };

  function guessWeather(state) {
    var season = state.season || '秋';
    var map = { '春': '🌤️ 和风', '夏': '☀️ 晴朗', '秋': '🌥️ 多云', '冬': '❄️ 小雪' };
    return map[season] || '🌤️ 晴';
  }

  function guessSeason(state) {
    var totalRounds = state.round || 0;
    var seasons = ['春', '夏', '秋', '冬'];
    return seasons[Math.floor((totalRounds / 20) % 4)] || '秋';
  }

  // --- 多步撤销系统 ---
  core.pushUndo = function(state, description) {
    if (!state.undoHistory) state.undoHistory = [];
    var snapshot = JSON.parse(JSON.stringify(state));
    snapshot._undoDesc = description || '第 ' + (state.round || 0) + ' 轮快照';
    snapshot._undoTime = Date.now();
    state.undoHistory.push(snapshot);
    if (state.undoHistory.length > 50) state.undoHistory.shift();
    core.saveState(state);
  };

  core.getUndoList = function(state) {
    return (state.undoHistory || []).map(function(s, i) {
      return { index: i, round: s.round || 0, desc: s._undoDesc, time: s._undoTime };
    });
  };

  core.rollbackToUndo = function(state, index) {
    var history = state.undoHistory || [];
    if (index < 0 || index >= history.length) return false;
    var snapshot = history[index];
    // 恢复关键字段
    var keys = Object.keys(snapshot);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (key === '_undoDesc' || key === '_undoTime') continue;
      state[key] = JSON.parse(JSON.stringify(snapshot[key]));
    }
    // 裁剪历史：保留到该索引
    state.undoHistory = history.slice(0, index + 1);
    core.saveState(state);
    return true;
  };

  // --- 记忆回收站 ---
  core.deleteToRecycle = function(state, memIndex) {
    if (!state.recycleBin) state.recycleBin = [];
    if (memIndex >= 0 && memIndex < (state.memories || []).length) {
      var mem = state.memories.splice(memIndex, 1)[0];
      mem._deletedAt = state.round || 0;
      mem._deletedTime = Date.now();
      state.recycleBin.push(mem);
      core.saveState(state);
    }
  };

  core.restoreFromRecycle = function(state, binIndex) {
    if (binIndex >= 0 && binIndex < (state.recycleBin || []).length) {
      var mem = state.recycleBin.splice(binIndex, 1)[0];
      if (mem) {
        state.memories.push(mem);
        core.saveState(state);
      }
    }
  };

  core.permaDeleteFromRecycle = function(state, binIndex) {
    if (binIndex >= 0 && binIndex < (state.recycleBin || []).length) {
      state.recycleBin.splice(binIndex, 1);
      core.saveState(state);
    }
  };

  core.emptyRecycleBin = function(state) {
    state.recycleBin = [];
    core.saveState(state);
  };

  // --- 记忆关联 ---
  core.addMemoryAssociation = function(state, memIndexA, memIndexB, label) {
    if (!state.memoryAssociations) state.memoryAssociations = [];
    state.memoryAssociations.push({
      a: memIndexA, b: memIndexB,
      label: label || '关联',
      round: state.round || 0
    });
    core.saveState(state);
  };

  core.getMemoryAssociations = function(state) {
    return state.memoryAssociations || [];
  };

  // ============================================================
  // 第一部分：包装演化函数 & 成就变更监听
  // ============================================================

  var evolution = window.WORLD_ENGINE_EVOLUTION;
  var _origEvolve = null;
  var _previousAchCount = 0;
  var _evolveInProgress = false;

  if (evolution && typeof evolution.evolve === 'function') {
    _origEvolve = evolution.evolve;
    evolution.evolve = function(state, userMsg, aiMsg) {
      if (_evolveInProgress) return Promise.resolve(state);
      _evolveInProgress = true;

      // 快照当前成就状态
      var prevAch = JSON.stringify((state && state.achievements && state.achievements.unlocked) || {});

      // 推演前快照（撤销）
      if (state && core.pushUndo) core.pushUndo(state, '推演前 #' + (state.round || 0));

      // 显示进度条
      showEvolveProgress();

      try {
        var result = _origEvolve.call(evolution, state, userMsg, aiMsg);

        if (result && typeof result.then === 'function') {
          return result.then(function(res) {
            hideEvolveProgress();
            _evolveInProgress = false;
            if (state) {
              // 检测新成就
              var currAch = JSON.stringify((state.achievements && state.achievements.unlocked) || {});
              if (currAch !== prevAch) {
                detectNewAchievements(state, prevAch, currAch);
              }
              // 更新上次结果
              state.lastEvolveResult = {
                round: state.round,
                time: Date.now(),
                newMemories: (state.memories && state.memories.length) || 0,
                newEvents: (state.events && state.events.length) || 0
              };
              core.saveState(state);
            }
            return res;
          })['catch'](function(err) {
            hideEvolveProgress();
            _evolveInProgress = false;
            console.warn('[24enh] evolve error:', err);
            throw err;
          });
        } else {
          hideEvolveProgress();
          _evolveInProgress = false;
          if (state) {
            var currAch2 = JSON.stringify((state.achievements && state.achievements.unlocked) || {});
            if (currAch2 !== prevAch) detectNewAchievements(state, prevAch, currAch2);
          }
          return result;
        }
      } catch(e) {
        hideEvolveProgress();
        _evolveInProgress = false;
        console.warn('[24enh] evolve exception:', e);
        throw e;
      }
    };
  }

  // --- 检测新成就 ---
  function detectNewAchievements(state, prevStr, currStr) {
    if (!state || !state.achievements) return;
    var prev = JSON.parse(prevStr);
    var curr = JSON.parse(currStr);
    var newOnes = [];
    for (var key in curr) {
      if (curr.hasOwnProperty(key) && !prev.hasOwnProperty(key)) {
        newOnes.push({ id: key, data: curr[key] });
      }
    }
    newOnes.forEach(function(ach) {
      showAchievementPopup(state, ach.id, ach.data);
    });
  }

  // ============================================================
  // 第二部分：UI 增强功能
  // ============================================================

  var _progressOverlay = null;

  // ===== Feature 1: 推演进度动画条 =====
  function showEvolveProgress() {
    removeEvolveProgress();
    var overlay = document.createElement('div');
    overlay.className = 'world-engine-evolve-progress-overlay';
    overlay.id = 'world-engine-evolve-progress';
    overlay.innerHTML =
      '<div class="world-engine-evolve-progress-box">' +
        '<div class="world-engine-evolve-progress-title">⏳ 世界推演中...</div>' +
        '<div class="world-engine-evolve-progress-bar">' +
          '<div class="world-engine-evolve-progress-fill" id="world-engine-evolve-fill"></div>' +
        '</div>' +
        '<div class="world-engine-evolve-step-label" id="world-engine-evolve-step">初始化...</div>' +
      '</div>';
    document.body.appendChild(overlay);
    _progressOverlay = overlay;

    // 模拟步骤进度
    var steps = ['初始化推演引擎...', '分析上下文环境...', '生成事件与变化...', '更新世界状态...', '检查成就解锁...', '✅ 推演完成'];
    var stepIdx = 0;
    var fill = document.getElementById('world-engine-evolve-fill');
    var stepEl = document.getElementById('world-engine-evolve-step');

    var interval = setInterval(function() {
      stepIdx++;
      if (stepIdx >= steps.length) {
        clearInterval(interval);
        return;
      }
      if (stepEl) stepEl.textContent = steps[stepIdx];
      if (fill) fill.style.width = ((stepIdx / (steps.length - 1)) * 100) + '%';
    }, 400);

    overlay._stepInterval = interval;
  }

  function removeEvolveProgress() {
    var existing = document.getElementById('world-engine-evolve-progress');
    if (existing) {
      if (existing._stepInterval) clearInterval(existing._stepInterval);
      existing.parentNode.removeChild(existing);
    }
    _progressOverlay = null;
  }

  function hideEvolveProgress() {
    var fill = document.getElementById('world-engine-evolve-fill');
    var stepEl = document.getElementById('world-engine-evolve-step');
    if (fill) fill.style.width = '100%';
    if (stepEl) {
      stepEl.textContent = '✅ 推演完成';
      stepEl.style.color = '#7ee787';
    }
    setTimeout(removeEvolveProgress, 800);
  }

  // ===== Feature 2: 面板状态记忆 =====
  function savePanelState() {
    var panel = document.querySelector('.world-engine-panel');
    if (!panel) return;
    var state = {
      left: panel.style.left,
      top: panel.style.top,
      width: panel.style.width,
      height: panel.style.height,
      tab: getActiveTab(),
      autoHide: window._world_engine_autoHideEnabled || false
    };
    try { window.WORLD_ENGINE_STORAGE.setItem('world_engine_panel_state', JSON.stringify(state)); } catch(e) {}
  }

  function loadPanelState() {
    try {
      var raw = window.WORLD_ENGINE_STORAGE.getItem('world_engine_panel_state');
      if (!raw) return;
      var state = JSON.parse(raw);
      var panel = document.querySelector('.world-engine-panel');
      if (!panel) return;
      if (state.left) panel.style.left = state.left;
      if (state.top) panel.style.top = state.top;
      if (state.width) panel.style.width = state.width;
      if (state.height) panel.style.height = state.height;
      if (state.autoHide) {
        window._world_engine_autoHideEnabled = true;
        setupAutoHide();
      }
    } catch(e) {}
  }

  function getActiveTab() {
    var active = document.querySelector('.tab-btn.active');
    return active ? active.textContent.trim() : '';
  }

  // ===== Feature 3: 上次演化结果卡片 =====
  function renderLastEvolveCard(container, state) {
    if (!state || !state.lastEvolveResult) return;
    var result = state.lastEvolveResult;
    var html =
      '<div class="world-engine-last-evolve-card card">' +
        '<div class="card-title">📋 上次演化结果</div>' +
        '<div class="world-engine-last-evolve-item">🔄 轮次 #' + (result.round || '?') + '</div>' +
        '<div class="world-engine-last-evolve-item">📝 记忆数: ' + (result.newMemories || 0) + '</div>' +
        '<div class="world-engine-last-evolve-item">📌 事件数: ' + (result.newEvents || 0) + '</div>' +
      '</div>';
    container.insertAdjacentHTML('afterbegin', html);
  }

  // ===== Feature 4: 撤销列表 =====
  function renderUndoList(container, state) {
    var history = core.getUndoList(state);
    var html =
      '<div class="card"><div class="card-title">↩️ 撤销历史 <span class="bdg">' + history.length + '/50</span></div>';
    if (!history.length) {
      html += '<div class="sm gray">暂无撤销历史，推演后将自动创建快照</div>';
    } else {
      for (var i = history.length - 1; i >= 0; i--) {
        var h = history[i];
        html +=
          '<div class="world-engine-undo-item" style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #21262d;">' +
            '<div><span class="rnd" style="color:#8b949e;font-size:11px;">#' + h.round + '</span> <span class="label" style="font-size:12px;">' + escHtml(h.desc) + '</span></div>' +
            '<button class="btn btn-sm world-engine-undo-rollback" data-idx="' + h.index + '" style="color:#d29922;">↩️ 回滚</button>' +
          '</div>';
      }
    }
    html += '</div>';
    container.insertAdjacentHTML('beforeend', html);

    // 绑定回滚按钮
    setTimeout(function() {
      container.querySelectorAll('.world-engine-undo-rollback').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = parseInt(this.getAttribute('data-idx'));
          var st = core.loadState();
          if (core.rollbackToUndo(st, idx)) {
            toast('✅ 已回滚到 #' + st.round + ' 状态');
          } else {
            toast('❌ 回滚失败', true);
          }
        });
      });
    }, 50);
  }

  // ===== Feature 5: 成就解锁弹窗动画 =====
  function showAchievementPopup(state, achId, achData) {
    if (!achId || !achData) return;
    var rarity = achData.rarity || 'common';
    var rarityStars = getRarityStars(rarity);
    var icon = achData.icon || '🏆';
    var name = achData.name || achId;
    var desc = achData.description || '';

    var popup = document.createElement('div');
    popup.className = 'world-engine-ach-popup-overlay';
    popup.id = 'world-engine-ach-popup-' + Date.now();
    popup.innerHTML =
      '<div class="world-engine-ach-popup">' +
        '<div class="world-engine-ach-popup-inner">' +
          '<div class="world-engine-ach-popup-icon">' + icon + '</div>' +
          '<div class="world-engine-ach-popup-name">' + escHtml(name) + '</div>' +
          '<div class="world-engine-ach-popup-desc">' + escHtml(desc) + '</div>' +
          '<div class="world-engine-ach-popup-rarity ' + rarity + '">' + rarityStars + '</div>' +
        '</div>' +
        '<div class="world-engine-confetti">' +
          Array(20).fill(0).map(function(){ return '<span class="world-engine-confetti-particle"></span>'; }).join('') +
        '</div>' +
      '</div>';
    document.body.appendChild(popup);

    // 3秒后自动消失
    setTimeout(function() {
      if (popup.parentNode) popup.parentNode.removeChild(popup);
    }, 3500);

    // 点击关闭
    popup.addEventListener('click', function() {
      if (popup.parentNode) popup.parentNode.removeChild(popup);
    });
  }

  function getRarityStars(rarity) {
    var map = { 'common': '★', 'rare': '★★', 'epic': '★★★', 'legendary': '★★★★', 'hidden': '??' };
    return map[rarity] || '★';
  }

  // ===== Feature 6: 总完成率环形图 =====
  function renderDonutChart(container, state) {
    if (!state || !state.achievements) return;
    var total = countTotalAchievements(state);
    var unlocked = state.achievements.totalUnlocked || 0;
    var pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;
    var r = 54;
    var circ = 2 * Math.PI * r;
    var offset = circ - (pct / 100) * circ;

    var html =
      '<div class="world-engine-donut-container card">' +
        '<div class="card-title">🎯 总完成率</div>' +
        '<div style="display:flex;align-items:center;gap:16px;">' +
          '<svg width="130" height="130" viewBox="0 0 130 130" class="world-engine-donut-svg">' +
            '<circle cx="65" cy="65" r="' + r + '" fill="none" stroke="#21262d" stroke-width="10"/>' +
            '<circle cx="65" cy="65" r="' + r + '" fill="none" stroke="#f0c040" stroke-width="10" stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" transform="rotate(-90 65 65)" style="transition: stroke-dashoffset .8s ease;"/>' +
            '<text x="65" y="60" text-anchor="middle" fill="#f0c040" font-size="28" font-weight="700">' + pct + '%</text>' +
            '<text x="65" y="80" text-anchor="middle" fill="#8b949e" font-size="11">' + unlocked + '/' + total + '</text>' +
          '</svg>' +
          '<div class="world-engine-donut-legend">' +
            '<div><span style="color:#f0c040">★</span> 已解锁: ' + unlocked + '</div>' +
            '<div><span style="color:#30363d">★</span> 未解锁: ' + (total - unlocked) + '</div>' +
            '<div style="margin-top:4px;"><span style="color:#58a6ff;font-size:11px;">总成就: ' + total + '</span></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    container.insertAdjacentHTML('afterbegin', html);
  }

  function countTotalAchievements(state) {
    if (!state || !state.achievements) return 0;
    var all = state.achievements.autoGenerated || {};
    var count = state.achievements.totalUnlocked || 0;
    var autoCount = Object.keys(all).length;
    return Math.max(count + 10, autoCount + count);
  }

  // ===== Feature 7: 按成就类型查看 =====
  function renderAchTypeTabs(container, state) {
    var types = [
      { id: 'all', label: '🏠 全部', icon: '' },
      { id: 'survival', label: '🛡️ 生存', icon: '🛡️' },
      { id: 'combat', label: '⚔️ 战斗', icon: '⚔️' },
      { id: 'intimacy', label: '💕 亲密', icon: '💕' },
      { id: 'funny', label: '😂 奇趣', icon: '😂' },
      { id: 'explore', label: '🗺️ 探索', icon: '🗺️' },
      { id: 'social', label: '🤝 社交', icon: '🤝' },
      { id: 'story', label: '📖 故事', icon: '📖' },
      { id: 'growth', label: '🌱 成长', icon: '🌱' },
      { id: 'world', label: '🌍 世界', icon: '🌍' },
      { id: 'meta', label: '🎮 元成就', icon: '🎮' }
    ];

    var html =
      '<div class="card"><div class="card-title">📂 按类型筛选</div>' +
      '<div class="world-engine-ach-type-tabs">';
    types.forEach(function(t) {
      var active = (state.achTypeFilter === t.id || (!state.achTypeFilter && t.id === 'all')) ? ' active' : '';
      html += '<button class="world-engine-ach-type-tab' + active + '" data-type="' + t.id + '">' + t.label + '</button>';
    });
    html += '</div></div>';
    container.insertAdjacentHTML('afterbegin', html);

    // 绑定点击
    setTimeout(function() {
      container.querySelectorAll('.world-engine-ach-type-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
          container.querySelectorAll('.world-engine-ach-type-tab').forEach(function(t) { t.classList.remove('active'); });
          this.classList.add('active');
          var type = this.getAttribute('data-type');
          var st = core.loadState();
          st.achTypeFilter = type;
          core.saveState(st);
          filterAchCards(type);
        });
      });
    }, 50);
  }

  function filterAchCards(type) {
    var cards = document.querySelectorAll('.ach-card');
    if (type === 'all') {
      cards.forEach(function(c) { c.style.display = ''; });
      return;
    }
    cards.forEach(function(c) {
      var cardTypes = (c.getAttribute('data-types') || '').split(',');
      c.style.display = cardTypes.indexOf(type) >= 0 ? '' : 'none';
    });
  }

  // ===== Feature 8: 关系图可视化 =====
  function renderBondCanvas(container, state) {
    if (!state || !state.emotionMap) return;
    var entities = Object.keys(state.emotionMap);
    if (entities.length < 2) return;

    var wrap = document.createElement('div');
    wrap.className = 'world-engine-bond-canvas-wrap card';
    wrap.innerHTML = '<div class="card-title">🔗 关系图</div><canvas class="world-engine-bond-canvas" width="400" height="300"></canvas>';
    container.appendChild(wrap);

    var canvas = wrap.querySelector('canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 力导向布局
    var nodes = entities.map(function(name, i) {
      return { id: i, name: name, x: Math.random() * 350 + 25, y: Math.random() * 250 + 25, vx: 0, vy: 0 };
    });
    var nodeMap = {};
    nodes.forEach(function(n) { nodeMap[n.name] = n; });

    // 边：关系态度从emotionMap推断
    var edges = [];
    for (var i = 0; i < entities.length; i++) {
      for (var j = i + 1; j < entities.length; j++) {
        var att = getRelationAttitude(state, entities[i], entities[j]);
        edges.push({ from: i, to: j, attitude: att, weight: att === 'hostile' ? 1 : att === 'friendly' ? 2 : 0.5 });
      }
    }

    // 力导向模拟（20次迭代）
    for (var iter = 0; iter < 20; iter++) {
      // 斥力
      for (var a = 0; a < nodes.length; a++) {
        for (var b = a + 1; b < nodes.length; b++) {
          var dx = nodes[b].x - nodes[a].x;
          var dy = nodes[b].y - nodes[a].y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          var force = 500 / (dist * dist);
          var fx = (dx / dist) * force;
          var fy = (dy / dist) * force;
          nodes[a].vx -= fx;
          nodes[a].vy -= fy;
          nodes[b].vx += fx;
          nodes[b].vy += fy;
        }
      }
      // 引力（沿边）
      edges.forEach(function(e) {
        var na = nodes[e.from], nb = nodes[e.to];
        var dx = nb.x - na.x;
        var dy = nb.y - na.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var force = dist * 0.01;
        var fx = (dx / dist) * force;
        var fy = (dy / dist) * force;
        na.vx += fx * e.weight;
        na.vy += fy * e.weight;
        nb.vx -= fx * e.weight;
        nb.vy -= fy * e.weight;
      });
      // 中心引力
      nodes.forEach(function(n) {
        n.vx += (200 - n.x) * 0.001;
        n.vy += (150 - n.y) * 0.001;
        n.x += n.vx;
        n.y += n.vy;
        n.vx *= 0.8;
        n.vy *= 0.8;
        if (n.x < 10) n.x = 10;
        if (n.x > 390) n.x = 390;
        if (n.y < 10) n.y = 10;
        if (n.y > 290) n.y = 290;
      });
    }

    // 绘制
    ctx.clearRect(0, 0, 400, 300);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, 400, 300);

    // 边
    edges.forEach(function(e) {
      var na = nodes[e.from], nb = nodes[e.to];
      ctx.beginPath();
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.strokeStyle = e.attitude === 'friendly' ? '#7ee787' : e.attitude === 'hostile' ? '#f85149' : '#8b949e';
      ctx.lineWidth = e.weight * 2;
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // 节点
    nodes.forEach(function(n) {
      var emotionColor = getEmotionColor(state, n.name);
      ctx.beginPath();
      ctx.arc(n.x, n.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = emotionColor;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#e6edf3';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.name.length > 6 ? n.name.substring(0, 6) + '...' : n.name, n.x, n.y + 24);
    });

    // tooltip
    canvas.addEventListener('mousemove', function(e) {
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var found = null;
      for (var i = 0; i < nodes.length; i++) {
        var dx = mx - nodes[i].x;
        var dy = my - nodes[i].y;
        if (dx * dx + dy * dy < 256) { found = nodes[i]; break; }
      }
      var tooltip = wrap.querySelector('.world-engine-bond-tooltip');
      if (found) {
        if (!tooltip) {
          tooltip = document.createElement('div');
          tooltip.className = 'world-engine-bond-tooltip';
          wrap.appendChild(tooltip);
        }
        tooltip.textContent = found.name;
        tooltip.style.left = (e.offsetX + 10) + 'px';
        tooltip.style.top = (e.offsetY + 10) + 'px';
        tooltip.style.display = 'block';
      } else if (tooltip) {
        tooltip.style.display = 'none';
      }
    });
  }

  function getRelationAttitude(state, nameA, nameB) {
    var emo = state.emotionMap || {};
    var emoA = emo[nameA] || {};
    var emoB = emo[nameB] || {};
    var va = emoA.value || 0;
    var vb = emoB.value || 0;
    var sum = va + vb;
    if (sum > 3) return 'friendly';
    if (sum < -2) return 'hostile';
    return 'neutral';
  }

  function getEmotionColor(state, name) {
    var emo = state.emotionMap || {};
    var e = emo[name] || {};
    var v = e.value || 0;
    if (v > 0) return v > 3 ? '#238636' : '#7ee787';
    if (v < 0) return v < -2 ? '#b62324' : '#f85149';
    return '#8b949e';
  }

  // ===== Feature 9: 天气/季节显示 =====
  function renderWeatherPanel(container, state) {
    var weather = state.weather || guessWeather(state);
    var season = state.season || guessSeason(state);
    var weatherOpts = ['☀️ 晴朗', '🌤️ 和风', '🌥️ 多云', '🌧️ 小雨', '⛈️ 雷雨', '🌦️ 阵雨', '❄️ 小雪', '🌨️ 大雪', '🌫️ 大雾', '🌈 彩虹'];
    var seasonOpts = ['春', '夏', '秋', '冬'];

    var html =
      '<div class="world-engine-weather-panel card">' +
        '<div class="card-title">🌤️ 天气与季节</div>' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">' +
          '<div class="world-engine-weather-icon" style="font-size:36px;">' + (weather.split(' ')[0] || '🌤️') + '</div>' +
          '<div class="world-engine-weather-info">' +
            '<div style="font-size:16px;font-weight:600;">' + escHtml(weather) + '</div>' +
            '<div style="font-size:13px;color:#8b949e;">' + season + '季</div>' +
          '</div>' +
        '</div>' +
        '<div class="world-engine-weather-controls" style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<div class="fg" style="flex:1;min-width:120px;"><label>天气</label>' +
            '<select id="world-engine-weather-select">' + weatherOpts.map(function(w) { return '<option' + (w === weather ? ' selected' : '') + '>' + w + '</option>'; }).join('') + '</select></div>' +
          '<div class="fg" style="flex:0 0 80px;"><label>季节</label>' +
            '<select id="world-engine-season-select">' + seasonOpts.map(function(s) { return '<option' + (s === season ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
          '<div class="fa" style="border:none;padding:0;margin:0;align-self:flex-end;">' +
            '<button class="btn btn-primary btn-sm" id="world-engine-weather-save">💾 保存</button></div>' +
        '</div>' +
      '</div>';
    container.appendChild(html);

    setTimeout(function() {
      var saveBtn = document.getElementById('world-engine-weather-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', function() {
          var st = core.loadState();
          var ws = document.getElementById('world-engine-weather-select');
          var ss = document.getElementById('world-engine-season-select');
          if (ws) st.weather = ws.value;
          if (ss) st.season = ss.value;
          core.saveState(st);
          toast('✅ 天气/季节已更新');
        });
      }
    }, 50);
  }

    // ===== Feature 10: 加载更多/分页 =====
  var _memPageSize = 20;
  var _memPageCurrent = 0;

  function applyMemPageFilter() {
    var container = document.querySelector('.tab-content.active');
    if (!container) return;
    var memItems = container.querySelectorAll('.mem-item, [class*="mem-item"]');
    if (!memItems.length) return;
    var start = _memPageCurrent * _memPageSize;
    var end = start + _memPageSize;
    for (var i = 0; i < memItems.length; i++) {
      memItems[i].style.display = (i >= start && i < end) ? '' : 'none';
    }
  }

  function renderMemPagination(container, state) {
    var memories = state.memories || [];
    var totalPages = Math.max(1, Math.ceil(memories.length / _memPageSize));
    if (_memPageCurrent >= totalPages) _memPageCurrent = totalPages - 1;
    if (_memPageCurrent < 0) _memPageCurrent = 0;

    var html =
      '<div class="world-engine-mem-pagination">' +
      '<button class="btn btn-sm world-engine-mem-page-btn" data-page="prev" ' + (_memPageCurrent <= 0 ? 'disabled' : '') + '>◀ 上一页</button>' +
      '<span class="world-engine-mem-page-info" id="world-engine-page-info">第 ' + (_memPageCurrent + 1) + '/' + totalPages + ' 页（共 ' + memories.length + ' 条）</span>' +
      '<button class="btn btn-sm world-engine-mem-page-btn" data-page="next" ' + (_memPageCurrent >= totalPages - 1 ? 'disabled' : '') + '>下一页 ▶</button>' +
      '</div>';
    container.appendChild(html);

    setTimeout(function() {
      container.querySelectorAll('.world-engine-mem-page-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var dir = this.getAttribute('data-page');
          if (dir === 'prev' && _memPageCurrent > 0) _memPageCurrent--;
          if (dir === 'next' && _memPageCurrent < totalPages - 1) _memPageCurrent++;
          var st = core.loadState();
          applyMemPageFilter();
          var infoEl = document.getElementById('world-engine-page-info');
          if (infoEl) {
            var total = (st.memories || []).length;
            var tp = Math.max(1, Math.ceil(total / _memPageSize));
            infoEl.textContent = '第 ' + (_memPageCurrent + 1) + '/' + tp + ' 页（共 ' + total + ' 条）';
          }
          container.querySelectorAll('.world-engine-mem-page-btn').forEach(function(b) {
            var p = b.getAttribute('data-page');
            var tp2 = Math.max(1, Math.ceil((st.memories || []).length / _memPageSize));
            if (p === 'prev') b.disabled = _memPageCurrent <= 0;
            if (p === 'next') b.disabled = _memPageCurrent >= tp2 - 1;
          });
        });
      });
    }, 50);
  }

// ===== Feature 11: 记忆回收站 =====
  function renderRecycleBin(container, state) {
    var bin = state.recycleBin || [];
    var html =
      '<div class="card" id="world-engine-recycle-section">' +
        '<div class="card-title">🗑️ 记忆回收站 <span class="bdg">' + bin.length + ' 条</span>' +
          '<button class="btn btn-sm world-engine-recycle-toggle" style="margin-left:auto;color:#8b949e;" id="world-engine-recycle-toggle">' +
            (window._world_engine_showRecycle ? '🔼 收起' : '🗑️ 打开回收站') +
          '</button>' +
        '</div>';
    if (window._world_engine_showRecycle) {
      if (!bin.length) {
        html += '<div class="sm gray">回收站为空</div>';
      } else {
        for (var i = 0; i < bin.length; i++) {
          var mem = bin[i];
          html +=
            '<div class="world-engine-recycle-item" style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #21262d;">' +
              '<div style="flex:1;"><span class="sm gray">#' + (mem._deletedAt || '?') + '</span> <span style="font-size:12px;">' + escHtml(mem.text || mem.content || '(无内容)') + '</span></div>' +
              '<div style="display:flex;gap:4px;flex-shrink:0;">' +
                '<button class="btn btn-sm world-engine-recycle-restore" data-idx="' + i + '" style="color:#7ee787;">↩️ 恢复</button>' +
                '<button class="btn btn-sm world-engine-recycle-perma" data-idx="' + i + '" style="color:#f85149;">🗑️ 删除</button>' +
              '</div>' +
            '</div>';
        }
        html += '<div style="margin-top:6px;"><button class="btn btn-sm btn-danger" id="world-engine-recycle-empty">🗑️ 清空回收站</button></div>';
      }
    }
    html += '</div>';
    container.appendChild(html);

    setTimeout(function() {
      var toggle = document.getElementById('world-engine-recycle-toggle');
      if (toggle) toggle.addEventListener('click', function() {
        window._world_engine_showRecycle = !window._world_engine_showRecycle;
        refreshCurrentTab();
      });
      container.querySelectorAll('.world-engine-recycle-restore').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = parseInt(this.getAttribute('data-idx'));
          var st = core.loadState();
          core.restoreFromRecycle(st, idx);
          toast('✅ 记忆已恢复');
          refreshCurrentTab();
        });
      });
      container.querySelectorAll('.world-engine-recycle-perma').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = parseInt(this.getAttribute('data-idx'));
          var st = core.loadState();
          core.permaDeleteFromRecycle(st, idx);
          toast('🗑️ 已永久删除');
          refreshCurrentTab();
        });
      });
      var emptyBtn = document.getElementById('world-engine-recycle-empty');
      if (emptyBtn) emptyBtn.addEventListener('click', function() {
        if (!confirm('确定清空回收站？此操作不可恢复。')) return;
        var st = core.loadState();
        core.emptyRecycleBin(st);
        toast('🗑️ 回收站已清空');
        refreshCurrentTab();
      });
    }, 50);
  }

  // ===== Feature 12: 记忆关联图 =====
  function renderMemAssocCanvas(container, state) {
    var assocs = state.memoryAssociations || [];
    var memories = state.memories || [];
    if (assocs.length < 1 || memories.length < 2) return;

    var wrap = document.createElement('div');
    wrap.className = 'world-engine-mem-assoc-wrap card';
    wrap.innerHTML = '<div class="card-title">🔗 记忆关联网络</div><canvas class="world-engine-mem-assoc-canvas" width="400" height="250"></canvas>';
    container.appendChild(wrap);

    var canvas = wrap.querySelector('canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 收集涉及的记忆索引
    var involved = {};
    assocs.forEach(function(a) { involved[a.a] = true; involved[a.b] = true; });
    var memIds = Object.keys(involved).map(Number);
    if (memIds.length < 2) return;

    var nodes = memIds.map(function(mi, i) {
      return {
        id: i, memIdx: mi,
        label: (memories[mi] && (memories[mi].text || memories[mi].content || '').substring(0, 15)) || '记忆' + mi,
        x: Math.random() * 350 + 25, y: Math.random() * 200 + 25, vx: 0, vy: 0
      };
    });

    // 力导向
    for (var iter = 0; iter < 15; iter++) {
      for (var a = 0; a < nodes.length; a++) {
        for (var b = a + 1; b < nodes.length; b++) {
          var dx = nodes[b].x - nodes[a].x;
          var dy = nodes[b].y - nodes[a].y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          var force = 300 / (dist * dist);
          nodes[a].vx -= (dx / dist) * force;
          nodes[a].vy -= (dy / dist) * force;
          nodes[b].vx += (dx / dist) * force;
          nodes[b].vy += (dy / dist) * force;
        }
      }
      assocs.forEach(function(assoc) {
        var na = null, nb = null;
        for (var ni = 0; ni < nodes.length; ni++) {
          if (nodes[ni].memIdx === assoc.a) na = nodes[ni];
          if (nodes[ni].memIdx === assoc.b) nb = nodes[ni];
        }
        if (!na || !nb) return;
        var dx = nb.x - na.x;
        var dy = nb.y - na.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var force = dist * 0.005;
        na.vx += (dx / dist) * force;
        na.vy += (dy / dist) * force;
        nb.vx -= (dx / dist) * force;
        nb.vy -= (dy / dist) * force;
      });
      nodes.forEach(function(n) {
        n.x += n.vx;
        n.y += n.vy;
        n.vx *= 0.8;
        n.vy *= 0.8;
        if (n.x < 10) n.x = 10;
        if (n.x > 390) n.x = 390;
        if (n.y < 10) n.y = 10;
        if (n.y > 240) n.y = 240;
      });
    }

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, 400, 250);

    assocs.forEach(function(assoc) {
      var na = null, nb = null;
      for (var ni = 0; ni < nodes.length; ni++) {
        if (nodes[ni].memIdx === assoc.a) na = nodes[ni];
        if (nodes[ni].memIdx === assoc.b) nb = nodes[ni];
      }
      if (!na || !nb) return;
      ctx.beginPath();
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.strokeStyle = '#58a6ff';
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      // 标签
      var mx = (na.x + nb.x) / 2, my = (na.y + nb.y) / 2;
      ctx.fillStyle = '#8b949e';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(assoc.label || '', mx, my - 4);
    });

    nodes.forEach(function(n) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#1f6feb';
      ctx.fill();
      ctx.strokeStyle = '#58a6ff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#e6edf3';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y + 18);
    });

    // tooltip
    var tooltip = null;
    canvas.addEventListener('mousemove', function(e) {
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var found = null;
      for (var i = 0; i < nodes.length; i++) {
        var dx = mx - nodes[i].x, dy = my - nodes[i].y;
        if (dx * dx + dy * dy < 144) { found = nodes[i]; break; }
      }
      if (found) {
        if (!tooltip) { tooltip = document.createElement('div'); tooltip.className = 'world-engine-mem-assoc-tooltip'; wrap.appendChild(tooltip); }
        var fullText = (memories[found.memIdx] && (memories[found.memIdx].text || memories[found.memIdx].content || '')) || '';
        tooltip.textContent = fullText.substring(0, 50) + (fullText.length > 50 ? '...' : '');
        tooltip.style.left = (e.offsetX + 10) + 'px';
        tooltip.style.top = (e.offsetY + 10) + 'px';
        tooltip.style.display = 'block';
      } else if (tooltip) {
        tooltip.style.display = 'none';
      }
    });
  }

  // ===== Feature 13: 定时推演 =====
  var _scheduleTimerId = null;

  function renderScheduleEvolve(container, state) {
    var schedule = state.evolveSchedule || {};
    var isRunning = _scheduleTimerId !== null;
    var options = [
      { v: 0, l: '关闭' },
      { v: 300000, l: '每 5 分钟' },
      { v: 600000, l: '每 10 分钟' },
      { v: 1800000, l: '每 30 分钟' },
      { v: 3600000, l: '每 1 小时' }
    ];

    var html =
      '<div class="card"><div class="card-title">⏱️ 定时推演</div>' +
      '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
        '<div class="fg" style="flex:1;min-width:120px;"><label>推演间隔</label>' +
          '<select id="world-engine-schedule-interval">' +
            options.map(function(o) { return '<option value="' + o.v + '"' + (schedule.interval === o.v ? ' selected' : '') + '>' + o.l + '</option>'; }).join('') +
          '</select></div>' +
        '<div class="world-engine-schedule-status ' + (isRunning ? 'running' : 'stopped') + '" id="world-engine-schedule-status">' +
          (isRunning ? '🟢 运行中' : '⚪ 已停止') +
        '</div>' +
      '</div>' +
      '<div class="fa"><button class="btn btn-primary" id="world-engine-schedule-start">' + (isRunning ? '🔄 重启' : '▶️ 启动') + '</button>' +
      '<button class="btn btn-sm" id="world-engine-schedule-stop"' + (!isRunning ? ' disabled' : '') + '>⏹️ 停止</button></div>' +
      '</div>';
    container.appendChild(html);

    setTimeout(function() {
      var startBtn = document.getElementById('world-engine-schedule-start');
      var stopBtn = document.getElementById('world-engine-schedule-stop');
      if (startBtn) startBtn.addEventListener('click', function() {
        startScheduleEvolve();
      });
      if (stopBtn) stopBtn.addEventListener('click', function() {
        stopScheduleEvolve();
      });
    }, 50);
  }

  function startScheduleEvolve() {
    stopScheduleEvolve();
    var sel = document.getElementById('world-engine-schedule-interval');
    var interval = sel ? parseInt(sel.value) || 0 : 0;
    if (interval <= 0) { toast('⚠️ 请选择有效间隔'); return; }
    var st = core.loadState();
    if (!st.evolveSchedule) st.evolveSchedule = {};
    st.evolveSchedule.interval = interval;
    st.evolveSchedule.enabled = true;
    core.saveState(st);

    _scheduleTimerId = setInterval(function() {
      var s = core.loadState();
      if (evolution && typeof evolution.evolve === 'function') {
        evolution.evolve(s);
      }
    }, interval);

    toast('✅ 定时推演已启动，间隔 ' + (interval / 1000 / 60) + ' 分钟');
    var statusEl = document.getElementById('world-engine-schedule-status');
    if (statusEl) {
      statusEl.className = 'world-engine-schedule-status running';
      statusEl.textContent = '🟢 运行中';
    }
  }

  function stopScheduleEvolve() {
    if (_scheduleTimerId) {
      clearInterval(_scheduleTimerId);
      _scheduleTimerId = null;
    }
    var st = core.loadState();
    if (st.evolveSchedule) {
      st.evolveSchedule.enabled = false;
      core.saveState(st);
    }
    var statusEl = document.getElementById('world-engine-schedule-status');
    if (statusEl) {
      statusEl.className = 'world-engine-schedule-status stopped';
      statusEl.textContent = '⚪ 已停止';
    }
  }

  // ===== Feature 14: 推演预览模式 =====
  function renderPreviewModal(previewData, onConfirm, onCancel) {
    var overlay = document.createElement('div');
    overlay.className = 'world-engine-preview-modal';
    overlay.id = 'world-engine-preview-overlay';
    var html =
      '<div class="card" style="max-width:500px;">' +
        '<div class="card-title">👁️ 推演预览</div>' +
        '<div class="world-engine-preview-content">';
    if (previewData && previewData.length) {
      previewData.forEach(function(item) {
        html += '<div class="world-engine-preview-item">' +
          '<span class="world-engine-evolve-tag" style="background:' + (item.type === 'add' ? '#1a3a1a' : item.type === 'change' ? '#3a2a1a' : '#3a1a1a') + ';color:' + (item.type === 'add' ? '#7ee787' : item.type === 'change' ? '#d29922' : '#f85149') + ';padding:1px 6px;border-radius:4px;font-size:10px;margin-right:6px;">' + item.label + '</span>' +
          escHtml(item.text) +
        '</div>';
      });
    } else {
      html += '<div class="sm gray">暂无可预览的变化</div>';
    }
    html += '</div><div class="world-engine-preview-actions" style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">' +
      '<button class="btn btn-sm" id="world-engine-preview-cancel">取消</button>' +
      '<button class="btn btn-primary" id="world-engine-preview-confirm">✅ 确认执行</button>' +
      '</div></div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    if (window.WORLD_ENGINE_UI && typeof window.WORLD_ENGINE_UI.makeDraggableModal === 'function') {
      window.WORLD_ENGINE_UI.makeDraggableModal(overlay, { boxSelector: '.card', handleSelector: '.card-title' });
    }

    document.getElementById('world-engine-preview-confirm').addEventListener('click', function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (typeof onConfirm === 'function') onConfirm();
    });
    document.getElementById('world-engine-preview-cancel').addEventListener('click', function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (typeof onCancel === 'function') onCancel();
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        overlay.parentNode.removeChild(overlay);
        if (typeof onCancel === 'function') onCancel();
      }
    });
  }

  function generatePreview(state) {
    var previews = [];
    // 时间推进
    var nextTime = (state.inWorldMinutes || 0) + 30;
    var dayPhase = getDayPhase(nextTime);
    previews.push({ type: 'change', label: '⏰', text: '时间推进 → ' + dayPhase + '（' + nextTime + '分钟）' });
    // NPC活动
    var npcCount = Object.keys(state.emotionMap || {}).length;
    if (npcCount > 0) {
      previews.push({ type: 'add', label: '👥', text: npcCount + ' 个角色情感状态将更新' });
    }
    // 事件
    if (state.events && state.events.length > 0) {
      var recent = state.events[state.events.length - 1];
      if (recent) previews.push({ type: 'change', label: '📌', text: '最新事件: ' + (recent.text || recent.description || '').substring(0, 30) });
    }
    return previews;
  }

  function getDayPhase(minutes) {
    var h = Math.floor((minutes / 60) % 24);
    if (h < 6) return '🌙 深夜';
    if (h < 9) return '🌅 清晨';
    if (h < 12) return '☀️ 上午';
    if (h < 14) return '🌤️ 正午';
    if (h < 18) return '🌇 下午';
    if (h < 21) return '🌆 黄昏';
    return '🌙 夜晚';
  }

  // ===== Feature 15: API连接状态实时监控 =====
  function setupApiMonitor() {
    var header = document.querySelector('.hdr');
    if (!header) return;
    var monitor = document.createElement('div');
    monitor.className = 'world-engine-api-monitor';
    monitor.id = 'world-engine-api-monitor';
    monitor.style.marginLeft = 'auto';
    monitor.innerHTML =
      '<span class="world-engine-api-monitor-dot yellow" id="world-engine-api-dot"></span>' +
      '<span class="world-engine-api-monitor-text" id="world-engine-api-monitor-text" style="font-size:10px;color:#8b949e;margin-left:4px;">检测中...</span>';
    header.appendChild(monitor);

    // 立即检测
    pingApi();

    // 每30秒检测
    setInterval(pingApi, 30000);

    // 点击手动检测
    monitor.addEventListener('click', function() {
      var dot = document.getElementById('world-engine-api-dot');
      var text = document.getElementById('world-engine-api-monitor-text');
      if (dot) dot.className = 'world-engine-api-monitor-dot yellow';
      if (text) text.textContent = '检测中...';
      pingApi();
      toast('🔄 API 状态检测中...');
    });
  }

  function pingApi() {
    var textEl = document.getElementById('world-engine-api-monitor-text');
    var dot = document.getElementById('world-engine-api-dot');
    var latencyEl = document.getElementById('world-engine-api-latency');

    try {
      var settings = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
      var apiUrl = settings.apiUrl || 'http://localhost:5001/api';
      var startTime = Date.now();

      var xhr = new XMLHttpRequest();
      xhr.open('GET', apiUrl + '/v1/model/info', true);
      xhr.timeout = 5000;
      xhr.onload = function() {
        var latency = Date.now() - startTime;
        if (dot) { dot.className = 'world-engine-api-monitor-dot green'; dot.title = latency + 'ms'; }
        if (textEl) textEl.textContent = '在线';
        updateApiLatency(latency);
      };
      xhr.onerror = function() {
        if (dot) dot.className = 'world-engine-api-monitor-dot red';
        if (textEl) textEl.textContent = '离线';
        updateApiLatency(null);
      };
      xhr.ontimeout = function() {
        if (dot) dot.className = 'world-engine-api-monitor-dot red';
        if (textEl) textEl.textContent = '超时';
        updateApiLatency(null);
      };
      xhr.send();
    } catch(e) {
      if (dot) dot.className = 'world-engine-api-monitor-dot red';
      if (textEl) textEl.textContent = '离线';
      updateApiLatency(null);
    }
  }

  function updateApiLatency(latency) {
    var existing = document.getElementById('world-engine-api-latency');
    if (latency !== null) {
      if (!existing) {
        var textEl = document.getElementById('world-engine-api-monitor-text');
        if (textEl) {
          var span = document.createElement('span');
          span.id = 'world-engine-api-latency';
          span.style.cssText = 'font-size:10px;color:#8b949e;margin-left:4px;';
          span.textContent = latency + 'ms';
          textEl.parentNode.insertBefore(span, textEl.nextSibling);
        }
      } else {
        existing.textContent = latency + 'ms';
      }
    } else if (existing) {
      existing.parentNode.removeChild(existing);
    }
  }

  // ===== Feature 16: 角色深度资料卡 =====
  function renderDeepProfile(container, state, charName) {
    if (!charName || !state) return;
    var emo = state.emotionMap || {};
    var e = emo[charName] || {};
    var emoLabel = e.state || '中立';
    var emoValue = e.value || 0;
    var lifecycle = core.getCharacterLifecycle ? core.getCharacterLifecycle(state, charName) : '存活';
    var portrait = (state.characterPortraits && state.characterPortraits[charName]) || {};
    var relations = portrait.relations || [];
    var events = portrait.keyEvents || [];
    var tags = portrait.tags || [];

    var html =
      '<div class="world-engine-deep-profile-card card">' +
        '<div class="world-engine-deep-profile-header" style="display:flex;align-items:center;gap:12px;">' +
          '<div class="world-engine-deep-profile-avatar" style="font-size:40px;">' + (portrait.emoji || '👤') + '</div>' +
          '<div><div style="font-size:16px;font-weight:600;">' + escHtml(charName) + '</div>' +
          '<div style="font-size:11px;color:#8b949e;">' + lifecycle + ' · ' + emoLabel + ' (' + (emoValue > 0 ? '+' : '') + emoValue + ')</div></div>' +
        '</div>' +
        '<div class="world-engine-deep-profile-stats" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">' +
          '<span style="background:#21262d;padding:2px 8px;border-radius:4px;font-size:11px;">❤️ 关系: ' + relations.length + '</span>' +
          '<span style="background:#21262d;padding:2px 8px;border-radius:4px;font-size:11px;">📌 事件: ' + events.length + '</span>' +
          '<span style="background:#21262d;padding:2px 8px;border-radius:4px;font-size:11px;">🏷️ 标签: ' + tags.length + '</span>' +
        '</div>';

    // 关键事件
    if (events.length) {
      html += '<div class="world-engine-deep-profile-events" style="margin:6px 0;"><div style="font-size:11px;color:#f0c040;margin-bottom:4px;">📜 关键事件</div>';
      var evtSlice = events.slice(-5);
      evtSlice.forEach(function(ev) {
        html += '<div style="font-size:11px;color:#8b949e;padding:2px 0;border-bottom:1px solid #21262d;">#' + (ev.round || '?') + ' ' + escHtml(ev.text || ev.description || '') + '</div>';
      });
      html += '</div>';
    }

    // 关系
    if (relations.length) {
      html += '<div class="world-engine-deep-profile-relations"><div style="font-size:11px;color:#f0c040;margin-bottom:4px;">🤝 关系</div>';
      relations.forEach(function(r) {
        var relEmoji = r.attitude === 'friendly' ? '💚' : r.attitude === 'hostile' ? '❤️' : '💛';
        html += '<div style="font-size:11px;color:#8b949e;padding:2px 0;">' + relEmoji + ' ' + escHtml(r.name || '?') + ': ' + escHtml(r.label || r.relation || '') + '</div>';
      });
      html += '</div>';
    }

    // 个性标签
    if (tags.length) {
      html += '<div style="margin-top:6px;">';
      tags.forEach(function(t) {
        html += '<span class="tag tag-ent">' + escHtml(t) + '</span> ';
      });
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  // ===== Feature 17: 章节手动管理 =====
  function renderChapterManager(container, state) {
    var chapters = state.chapters || [];
    var activeChapter = state.activeChapter || null;

    var html =
      '<div class="world-engine-chapter-manager card">' +
        '<div class="card-title">📚 章节管理 <span class="bdg">' + chapters.length + ' 章</span></div>';

    if (chapters.length === 0) {
      html += '<div class="sm gray">暂无章节，点击下方按钮创建</div>';
    } else {
      chapters.forEach(function(ch, i) {
        var isActive = activeChapter === i || activeChapter === ch.name;
        html += '<div class="world-engine-chapter-item' + (isActive ? ' editing' : '') + '" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #21262d;">' +
          '<div style="flex:1;">' +
            '<span style="font-size:12px;font-weight:' + (isActive ? '600' : '400') + ';">' + escHtml(ch.name || '第' + (i + 1) + '章') + '</span>' +
            '<span style="font-size:10px;color:#8b949e;margin-left:8px;">#' + (ch.startRound || '?') + ' - ' + (ch.endRound || '进行中') + '</span>' +
          '</div>' +
          '<div class="ch-actions" style="display:flex;gap:4px;flex-shrink:0;">' +
            (!isActive ? '<button class="btn btn-sm world-engine-chapter-activate" data-idx="' + i + '" style="color:#7ee787;">📌 激活</button>' : '<span style="font-size:10px;color:#f0c040;">✅ 当前</span>') +
            '<button class="btn btn-sm world-engine-chapter-rename" data-idx="' + i + '" style="color:#58a6ff;">✏️</button>' +
            '<button class="btn btn-sm world-engine-chapter-delete" data-idx="' + i + '" style="color:#f85149;">🗑️</button>' +
          '</div>' +
        '</div>';
      });
    }

    html += '<div class="fa" style="border:none;padding:0;margin-top:8px;">' +
      '<button class="btn btn-primary btn-sm" id="world-engine-chapter-create">➕ 新建章节</button>' +
      '<button class="btn btn-sm" id="world-engine-chapter-auto">📖 自动生成章节</button></div>' +
      '</div>';
    container.appendChild(html);

    setTimeout(function() {
      document.getElementById('world-engine-chapter-create') && document.getElementById('world-engine-chapter-create').addEventListener('click', function() {
        var name = prompt('请输入章节名称：');
        if (!name) return;
        var st = core.loadState();
        if (!st.chapters) st.chapters = [];
        st.chapters.push({ name: name, startRound: st.round || 0, endRound: null });
        core.saveState(st);
        toast('✅ 章节「' + name + '」已创建');
        refreshCurrentTab();
      });

      container.querySelectorAll('.world-engine-chapter-activate').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = parseInt(this.getAttribute('data-idx'));
          var st = core.loadState();
          st.activeChapter = idx;
          core.saveState(st);
          toast('📌 已切换章节');
          refreshCurrentTab();
        });
      });

      container.querySelectorAll('.world-engine-chapter-rename').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = parseInt(this.getAttribute('data-idx'));
          var st = core.loadState();
          var ch = (st.chapters || [])[idx];
          if (!ch) return;
          var name = prompt('重命名章节：', ch.name);
          if (!name) return;
          ch.name = name;
          core.saveState(st);
          toast('✅ 章节已重命名');
          refreshCurrentTab();
        });
      });

      container.querySelectorAll('.world-engine-chapter-delete').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = parseInt(this.getAttribute('data-idx'));
          if (!confirm('确定删除此章节？')) return;
          var st = core.loadState();
          (st.chapters || []).splice(idx, 1);
          core.saveState(st);
          toast('🗑️ 章节已删除');
          refreshCurrentTab();
        });
      });

      document.getElementById('world-engine-chapter-auto') && document.getElementById('world-engine-chapter-auto').addEventListener('click', function() {
        var st = core.loadState();
        if (!st.chapters) st.chapters = [];
        if (st.chapters.length === 0) {
          st.chapters.push({ name: '序章', startRound: 0, endRound: null });
        }
        toast('📖 已自动生成章节结构');
        refreshCurrentTab();
      });
    }, 50);
  }

  // ===== Feature 18: 战斗记录统计图表 =====
  function renderCombatChart(container, state) {
    var combat = state.combat || {};
    var log = combat.log || [];
    if (!log.length) return;

    // 取最近10轮战斗
    var recentLog = log.slice(-10);
    var maxCount = 1;
    var roundCounts = {};
    recentLog.forEach(function(l) {
      var r = l.round || 0;
      roundCounts[r] = (roundCounts[r] || 0) + 1;
      if (roundCounts[r] > maxCount) maxCount = roundCounts[r];
    });
    var rounds = Object.keys(roundCounts).map(Number).sort();

    var html =
      '<div class="card"><div class="card-title">📊 战斗统计</div>' +
      '<div class="world-engine-combat-summary-strip" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;">' +
        '<span style="font-size:11px;color:#8b949e;">⚔️ 总战斗: <b style="color:#e6edf3;">' + (combat.totalBattles || 0) + '</b></span>' +
        '<span style="font-size:11px;color:#8b949e;">🏆 胜率: <b style="color:#7ee787;">' + (combat.totalBattles > 0 ? Math.round(((combat.wins || 0) / combat.totalBattles) * 100) : 0) + '%</b></span>' +
        '<span style="font-size:11px;color:#8b949e;">🔥 连胜: <b style="color:#f0c040;">' + (combat.bestStreak || 0) + '</b></span>' +
        '<span style="font-size:11px;color:#8b949e;">👑 Boss击杀: <b style="color:#bc8cff;">' + ((combat.bossesDefeated || []).length) + '</b></span>' +
      '</div>' +
      '<div class="world-engine-combat-chart-wrap" style="display:flex;gap:4px;align-items:flex-end;height:80px;padding:4px 0;">';

    rounds.forEach(function(r) {
      var cnt = roundCounts[r] || 0;
      var pct = (cnt / maxCount) * 100;
      html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;">' +
        '<div class="world-engine-combat-chart-bar" style="height:' + pct + '%;width:80%;background:linear-gradient(180deg,#f85149,#b62324);border-radius:3px 3px 0 0;min-height:2px;"></div>' +
        '<div class="world-engine-combat-chart-label" style="font-size:8px;color:#8b949e;margin-top:2px;">#' + r + '</div>' +
      '</div>';
    });

    html += '</div></div>';
    container.appendChild(html);
  }

  // ===== Feature 19: 条目预览弹窗（世界书） =====
  function showEntryPreview(entry) {
    if (!entry) return;
    var overlay = document.createElement('div');
    overlay.className = 'world-engine-entry-preview-overlay';
    overlay.innerHTML =
      '<div class="world-engine-entry-preview-modal card" style="max-width:550px;">' +
        '<div class="world-engine-entry-preview-header" style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #21262d;padding-bottom:8px;margin-bottom:8px;">' +
          '<div><span style="font-size:13px;font-weight:600;color:#f0c040;">' + escHtml(entry.name || entry.title || '条目') + '</span>' +
          '<span style="font-size:11px;color:#8b949e;margin-left:8px;">📖 ' + escHtml(entry.bookName || '') + '</span></div>' +
          '<button class="btn btn-sm" id="world-engine-close-preview" style="color:#f85149;">✕ 关闭</button>' +
        '</div>' +
        '<div class="world-engine-entry-preview-body" style="font-size:12px;color:#e6edf3;line-height:1.7;max-height:300px;overflow-y:auto;white-space:pre-wrap;">' +
          escHtml(entry.content || entry.text || entry.description || '(无内容)') +
        '</div>' +
        '<div class="world-engine-entry-preview-tags" style="margin-top:8px;padding-top:8px;border-top:1px solid #21262d;">' +
          '<span style="font-size:10px;color:#8b949e;">索引: ' + (entry.index || entry.id || '#') + '</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    if (window.WORLD_ENGINE_UI && typeof window.WORLD_ENGINE_UI.makeDraggableModal === 'function') {
      window.WORLD_ENGINE_UI.makeDraggableModal(overlay, { boxSelector: '.world-engine-entry-preview-modal', handleSelector: '.world-engine-entry-preview-header' });
    }
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay || e.target.id === 'world-engine-close-preview') {
        overlay.parentNode.removeChild(overlay);
      }
    });
  }

  // ===== Feature 20: 触发条件测试（世界书） =====
  function renderTriggerTest(container, state) {
    var html =
      '<div class="card"><div class="card-title">🔍 触发条件测试</div>' +
      '<div class="sm gray" style="margin-bottom:6px;">分析当前聊天上下文，显示哪些世界书条目会被触发</div>' +
      '<button class="btn btn-primary btn-sm" id="world-engine-trigger-test-run">🔍 开始分析</button>' +
      '<div id="world-engine-trigger-results" style="margin-top:8px;"></div></div>';
    container.appendChild(html);

    document.getElementById('world-engine-trigger-test-run') && document.getElementById('world-engine-trigger-test-run').addEventListener('click', function() {
      var resultsEl = document.getElementById('world-engine-trigger-results');
      if (!resultsEl) return;
      resultsEl.innerHTML = '<div class="sm gray">⏳ 分析中...</div>';

      // 尝试调用世界书模块
      var wb = window.WORLD_ENGINE_WORLDBOOK;
      var st = core.loadState();

      try {
        if (wb && typeof wb.analyzeTrigger === 'function') {
          wb.analyzeTrigger(st, function(results) {
            renderTriggerResults(resultsEl, results);
          });
        } else {
          // 本地模拟
          var mockResults = [];
          var books = st.selectedWorldbooks || [];
          books.forEach(function(b) {
            mockResults.push({ book: b, entries: [], matchScore: Math.random() * 100 });
          });
          renderTriggerResults(resultsEl, mockResults);
        }
      } catch(e) {
        resultsEl.innerHTML = '<div class="red sm">分析异常: ' + escHtml(e.message) + '</div>';
      }
    });
  }

  function renderTriggerResults(container, results) {
    if (!results || !results.length) {
      container.innerHTML = '<div class="sm gray">无匹配的触发条目</div>';
      return;
    }
    var html = '';
    results.forEach(function(r) {
      var matched = r.matchScore > 50;
      html += '<div class="world-engine-trigger-result ' + (matched ? 'match' : 'nomatch') + '" style="padding:4px 0;border-bottom:1px solid #21262d;display:flex;justify-content:space-between;align-items:center;">' +
        '<span style="font-size:11px;">' + escHtml(r.book || '未知') + '</span>' +
        '<span class="world-engine-trigger-score" style="font-size:10px;color:' + (matched ? '#7ee787' : '#8b949e') + ';">' + Math.round(r.matchScore) + '%</span>' +
      '</div>';
    });
    if (results.length === 0) {
      html += '<div class="sm gray">无结果</div>';
    }
    container.innerHTML = html;
  }

  // ===== Feature 21: 条目批量操作（世界书） =====
  function setupBatchBar() {
    var container = document.querySelector('.world-engine-panel .tab-content.active');
    if (!container) return;
    var batchBar = document.createElement('div');
    batchBar.className = 'world-engine-batch-bar';
    batchBar.id = 'world-engine-batch-bar';
    batchBar.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<span class="world-engine-batch-count" id="world-engine-batch-count" style="font-size:12px;color:#8b949e;">已选 0 项</span>' +
        '<button class="btn btn-sm" id="world-engine-batch-select-all">全选</button>' +
        '<button class="btn btn-sm" id="world-engine-batch-invert">反选</button>' +
        '<button class="btn btn-sm btn-success" id="world-engine-batch-enable">✅ 全部激活</button>' +
        '<button class="btn btn-sm btn-danger" id="world-engine-batch-disable">⛔ 全部取消</button>' +
        '<button class="btn btn-sm" id="world-engine-batch-export">📤 导出选中</button>' +
      '</div>';
    container.insertBefore(batchBar, container.firstChild);

    // 绑定事件
    setTimeout(function() {
      document.getElementById('world-engine-batch-select-all') && document.getElementById('world-engine-batch-select-all').addEventListener('click', function() {
        var cbs = container.querySelectorAll('.world-engine-wb-entry-cb, .world-engine-wb-book-cb');
        cbs.forEach(function(cb) { cb.checked = true; });
        updateBatchCount();
        toast('✅ 已全选');
      });
      document.getElementById('world-engine-batch-invert') && document.getElementById('world-engine-batch-invert').addEventListener('click', function() {
        var cbs = container.querySelectorAll('.world-engine-wb-entry-cb, .world-engine-wb-book-cb');
        cbs.forEach(function(cb) { cb.checked = !cb.checked; });
        updateBatchCount();
        toast('🔄 已反选');
      });
      document.getElementById('world-engine-batch-enable') && document.getElementById('world-engine-batch-enable').addEventListener('click', function() {
        container.querySelectorAll('.world-engine-wb-entry-cb:checked').forEach(function(cb) {
          var related = cb.closest('.world-engine-wb-entry') || cb.parentNode;
          var toggle = related && related.querySelector('.world-engine-wb-entry-active, [data-toggle]');
          if (toggle && toggle.checked !== undefined) toggle.checked = true;
        });
        toast('✅ 已激活选中项');
      });
      document.getElementById('world-engine-batch-disable') && document.getElementById('world-engine-batch-disable').addEventListener('click', function() {
        container.querySelectorAll('.world-engine-wb-entry-cb:checked').forEach(function(cb) {
          var related = cb.closest('.world-engine-wb-entry') || cb.parentNode;
          var toggle = related && related.querySelector('.world-engine-wb-entry-active, [data-toggle]');
          if (toggle && toggle.checked !== undefined) toggle.checked = false;
        });
        toast('⛔ 已取消选中项');
      });
      document.getElementById('world-engine-batch-export') && document.getElementById('world-engine-batch-export').addEventListener('click', function() {
        var selected = [];
        container.querySelectorAll('.world-engine-wb-entry-cb:checked').forEach(function(cb) {
          var parent = cb.closest('.world-engine-wb-entry') || cb.parentNode;
          var nameEl = parent && parent.querySelector('.world-engine-wb-entry-name, [data-name]');
          if (nameEl) selected.push(nameEl.textContent.trim());
        });
        if (selected.length === 0) { toast('⚠️ 未选中任何条目'); return; }
        var blob = new Blob([selected.join('\n')], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'world-engine-wb-export.txt'; a.click();
        URL.revokeObjectURL(url);
        toast('📤 已导出 ' + selected.length + ' 项');
      });
    }, 50);
  }

  function updateBatchCount() {
    var container = document.querySelector('.world-engine-panel .tab-content.active');
    if (!container) return;
    var cbs = container.querySelectorAll('.world-engine-wb-entry-cb:checked, .world-engine-wb-book-cb:checked');
    var countEl = document.getElementById('world-engine-batch-count');
    if (countEl) countEl.textContent = '已选 ' + cbs.length + ' 项';
  }

  // ===== Feature 22: 面板自动隐藏 =====
  function setupAutoHide() {
    var panel = document.querySelector('.world-engine-panel');
    if (!panel) return;
    if (window._world_engine_autoHideActive) return;
    window._world_engine_autoHideActive = true;

    var hideTimer = null;

    panel.addEventListener('mouseleave', function() {
      if (!window._world_engine_autoHideEnabled) return;
      hideTimer = setTimeout(function() {
        panel.classList.add('auto-hide');
        // 显示边缘触发条
        var trigger = document.createElement('div');
        trigger.className = 'world-engine-panel.peek-trigger';
        trigger.id = 'world-engine-peek-trigger';
        trigger.style.cssText = 'position:fixed;right:20px;bottom:80px;width:20px;height:40px;cursor:pointer;z-index:10000;background:transparent;';
        document.body.appendChild(trigger);
        trigger.addEventListener('mouseenter', function() {
          panel.classList.remove('auto-hide');
          var t = document.getElementById('world-engine-peek-trigger');
          if (t) t.parentNode.removeChild(t);
        });
      }, 2000);
    });

    panel.addEventListener('mouseenter', function() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      panel.classList.remove('auto-hide');
      var t = document.getElementById('world-engine-peek-trigger');
      if (t) t.parentNode.removeChild(t);
    });

    // 右上角添加开关按钮
    var header = panel.querySelector('.hdr');
    if (header) {
      var toggleBtn = document.createElement('button');
      toggleBtn.className = 'btn btn-sm';
      toggleBtn.id = 'world-engine-auto-hide-toggle';
      toggleBtn.style.cssText = 'font-size:10px;padding:2px 6px;margin-left:4px;';
      toggleBtn.textContent = window._world_engine_autoHideEnabled ? '👁️ 固定' : '👻 自动隐藏';
      toggleBtn.title = '切换面板自动隐藏模式';
      header.appendChild(toggleBtn);
      toggleBtn.addEventListener('click', function() {
        window._world_engine_autoHideEnabled = !window._world_engine_autoHideEnabled;
        this.textContent = window._world_engine_autoHideEnabled ? '👁️ 固定' : '👻 自动隐藏';
        savePanelState();
        toast(window._world_engine_autoHideEnabled ? '👻 自动隐藏已开启' : '👁️ 面板已固定');
      });
    }
  }

  // ===== Feature 23: 数据仪表盘 =====
  function renderDashboard(container, state) {
    if (!state) return;
    var combat = state.combat || {};
    var metrics = [
      { label: '🔄 推演轮数', value: state.round || 0, trend: '+' + (state.round % 10) },
      { label: '🧠 记忆总数', value: (state.memories || []).length, trend: '' },
      { label: '🏆 成就解锁', value: state.achievements ? state.achievements.totalUnlocked || 0 : 0, trend: '' },
      { label: '⚔️ 战斗次数', value: combat.totalBattles || 0, trend: '' },
      { label: '👥 活跃角色', value: Object.keys(state.emotionMap || {}).length, trend: '' },
      { label: '🏛️ 势力数', value: (state.factions || []).length, trend: '' },
      { label: '📜 剧情线数', value: (state.plotThreads || []).length, trend: '' },
      { label: '📌 事件数', value: (state.events || []).length, trend: '' },
      { label: '⏰ 时间(分)', value: state.inWorldMinutes || 0, trend: '' },
      { label: '🗂️ 章节数', value: (state.chapters || []).length, trend: '' }
    ];

    var html = '<div class="world-engine-dashboard-grid card"><div class="card-title">📊 数据仪表盘</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px;">';
    metrics.forEach(function(m) {
      html += '<div class="world-engine-dashboard-card" style="background:#0d1117;border-radius:6px;padding:8px 4px;text-align:center;border:1px solid #21262d;">' +
        '<div class="metric-value" style="font-size:18px;font-weight:700;color:#f0c040;">' + m.value + '</div>' +
        '<div class="metric-label" style="font-size:9px;color:#8b949e;margin-top:2px;">' + m.label + '</div>' +
        (m.trend ? '<div class="metric-trend" style="font-size:9px;color:#7ee787;">' + m.trend + '</div>' : '') +
      '</div>';
    });
    html += '</div></div>';
    container.appendChild(html);
  }

  // ===== Feature 24: 多步撤销历史 =====
  function renderUndoHistoryPanel(container, state) {
    var history = core.getUndoList(state);
    var html =
      '<div class="card"><div class="card-title">↩️ 多步撤销历史 <span class="bdg">' + history.length + '/50</span></div>';
    if (!history.length) {
      html += '<div class="sm gray">暂无撤销快照，推演时将自动创建</div>';
      html += '</div>';
      container.appendChild(html);
      return;
    }

    // 当前状态标记
    var currentIdx = history.length - 1;

    for (var i = history.length - 1; i >= 0; i--) {
      var h = history[i];
      var isCurrent = (i === currentIdx);
      html += '<div class="world-engine-undo-history-item' + (isCurrent ? ' current' : '') + '" style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid #21262d;' + (isCurrent ? 'background:rgba(240,192,64,0.08);border-left:3px solid #f0c040;' : '') + '">' +
        '<div>' +
          '<span class="sm" style="color:#8b949e;">#' + h.round + '</span> ' +
          '<span style="font-size:12px;">' + escHtml(h.desc) + '</span>' +
          '<span class="sm" style="color:#484f58;margin-left:6px;">' + (h.time ? new Date(h.time).toLocaleTimeString() : '') + '</span>' +
        '</div>' +
        '<div>' +
          (isCurrent ? '<span style="font-size:10px;color:#f0c040;margin-right:6px;">◀ 当前</span>' : '') +
          (!isCurrent ? '<button class="btn btn-sm world-engine-undo-history-rollback" data-idx="' + h.index + '" style="color:#d29922;">↩️ 回滚到此</button>' : '') +
        '</div>' +
      '</div>';
    }
    html += '</div>';
    container.appendChild(html);

    setTimeout(function() {
      container.querySelectorAll('.world-engine-undo-history-rollback').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = parseInt(this.getAttribute('data-idx'));
          var st = core.loadState();
          if (core.rollbackToUndo(st, idx)) {
            toast('✅ 已回滚到 #' + st.round + ' 状态，请刷新面板查看');
            refreshCurrentTab();
          } else {
            toast('❌ 回滚失败', true);
          }
        });
      });
    }, 50);
  }

  // ============================================================
  // 第三部分：MutationObserver + 后渲染钩子
  // ============================================================

  function enhanceCurrentTab() {
    var container = document.querySelector('.tab-content.active');
    if (!container) return;

    // 获取当前Tab名称
    var activeTab = document.querySelector('.tab-btn.active');
    var tabName = activeTab ? activeTab.textContent.trim() : '';

    var state = core.loadState();

    // 根据Tab执行增强
    if (tabName.indexOf('总览') >= 0 || tabName.indexOf('Overview') >= 0) {
      enhanceOverviewTab(container, state);
    } else if (tabName.indexOf('成就') >= 0 || tabName.indexOf('Achievements') >= 0) {
      enhanceAchievementTab(container, state);
    } else if (tabName.indexOf('世界') >= 0 || tabName.indexOf('World') >= 0) {
      enhanceWorldTab(container, state);
    } else if (tabName.indexOf('记忆') >= 0 || tabName.indexOf('Memory') >= 0) {
      enhanceMemoryTab(container, state);
    } else if (tabName.indexOf('引擎') >= 0 || tabName.indexOf('Engine') >= 0) {
      enhanceEngineTab(container, state);
    } else if (tabName.indexOf('故事') >= 0 || tabName.indexOf('Story') >= 0) {
      enhanceStoryTab(container, state);
    } else if (tabName.indexOf('世界书') >= 0 || tabName.indexOf('Worldbook') >= 0) {
      enhanceWorldbookTab(container, state);
    } else if (tabName.indexOf('设置') >= 0 || tabName.indexOf('Settings') >= 0) {
      enhanceSettingsTab(container, state);
    }
  }

  function markEnhanced(tabKey) {
    _enhancedTabs[tabKey] = true;
  }

  function enhanceOverviewTab(container, state) {
    if (_enhancedTabs['overview']) return;
    renderLastEvolveCard(container, state);
    renderUndoList(container, state);
    renderDashboard(container, state);
    markEnhanced('overview');
  }

  function enhanceAchievementTab(container, state) {
    if (_enhancedTabs['ach']) return;
    renderDonutChart(container, state);
    renderAchTypeTabs(container, state);
    markEnhanced('ach');
  }

  function enhanceWorldTab(container, state) {
    if (_enhancedTabs['world']) return;
    renderBondCanvas(container, state);
    renderWeatherPanel(container, state);
    setupDeepProfileClick(container, state);
    markEnhanced('world');
  }

  function enhanceMemoryTab(container, state) {
    if (_enhancedTabs['memory']) return;
    renderMemPagination(container, state);
    renderRecycleBin(container, state);
    renderMemAssocCanvas(container, state);
    applyMemPageFilter();
    markEnhanced('memory');
  }

  function enhanceEngineTab(container, state) {
    if (_enhancedTabs['engine']) return;
    renderScheduleEvolve(container, state);
    setupPreviewMode(container, state);
    markEnhanced('engine');
  }

  function enhanceStoryTab(container, state) {
    if (_enhancedTabs['story']) return;
    renderChapterManager(container, state);
    renderCombatChart(container, state);
    markEnhanced('story');
  }

  function enhanceWorldbookTab(container, state) {
    if (_enhancedTabs['wb']) return;
    renderTriggerTest(container, state);
    setupBatchBar();
    setupEntryPreviewClick(container);
    markEnhanced('wb');
  }

  function enhanceSettingsTab(container, state) {
    if (_enhancedTabs['settings']) return;
    renderUndoHistoryPanel(container, state);
    markEnhanced('settings');
  }

  // --- 辅助：绑定角色深度资料卡点击 ---
  function setupDeepProfileClick(container, state) {
    var cards = container.querySelectorAll('.ent-card, .port-card');
    cards.forEach(function(card) {
      card.addEventListener('dblclick', function() {
        var nameEl = card.querySelector('.ename');
        if (!nameEl) return;
        var name = nameEl.textContent.trim();
        var detail = renderDeepProfile(container, state, name);
        if (detail) {
          var existing = card.querySelector('.world-engine-deep-profile-card');
          if (existing) {
            existing.style.display = existing.style.display === 'none' ? '' : 'none';
          } else {
            card.insertAdjacentHTML('afterend', detail);
          }
        }
      });
    });
  }

  // --- 辅助：绑定世界书条目预览点击 ---
  function setupEntryPreviewClick(container) {
    // 监听由世界书模块渲染的条目
    container.querySelectorAll('.world-engine-wb-entry, .wb-entry, [class*="entry"]').forEach(function(el) {
      var nameEl = el.querySelector('.world-engine-wb-entry-name, .entry-name, [data-name]');
      if (nameEl && !el._hasPreview) {
        el._hasPreview = true;
        el.style.cursor = 'pointer';
        el.addEventListener('dblclick', function() {
          var entry = {
            name: nameEl.textContent.trim(),
            content: el.querySelector('.world-engine-wb-entry-content, .entry-content, [data-content]') ? el.querySelector('.world-engine-wb-entry-content, .entry-content, [data-content]').textContent.trim() : '',
            bookName: getClosestBookName(el),
            index: el.getAttribute('data-id') || el.getAttribute('data-index') || ''
          };
          showEntryPreview(entry);
        });
      }
    });
  }

  function getClosestBookName(el) {
    var book = el.closest('.world-engine-wb-book, .wb-book, [class*="book"]');
    if (book) {
      var title = book.querySelector('.world-engine-wb-book-title, .book-title, [data-book-name]');
      if (title) return title.textContent.trim();
    }
    return '';
  }

  // --- 辅助：预览模式 ---
  function setupPreviewMode(container, state) {
    var evolveBtn = container.querySelector('[id*="evolve"], [id*="evol"], .world-engine-evolve-btn, [class*="evolve"]');
    if (evolveBtn && !evolveBtn._hasPreviewHook) {
      evolveBtn._hasPreviewHook = true;
      var origClick = evolveBtn.click;
      evolveBtn.addEventListener('click', function(e) {
        if (state.driveMode === 'semi' || state.driveMode === '半自动') {
          e.preventDefault();
          e.stopPropagation();
          var preview = generatePreview(state);
          renderPreviewModal(preview, function() {
            // 确认后调用原始演化
            if (evolution && typeof evolution.evolve === 'function') {
              evolution.evolve(core.loadState());
            }
          });
        }
      });
    }
  }

  // --- MutationObserver 设置 ---
  var _enhObserver = null;
  var _enhTimer = null;
  var _enhInProgress = false;
  var _enhancedTabs = {};

  function clearEnhancedFlags() {
    _enhancedTabs = {};
  }

  function setupMutationObserver() {
    var target = document.querySelector('.world-engine-panel');
    if (!target) {
      setTimeout(setupMutationObserver, 500);
      return;
    }

    // 只监控tab切换（不监控内容变化，防止自循环）
    var tabBar = target.querySelector('.tab-bar');
    if (tabBar) {
      var tabObserver = new MutationObserver(function() {
        clearEnhancedFlags();
        scheduleEnhance();
      });
      tabObserver.observe(tabBar, { attributes: true, childList: true, subtree: true });
    }

    // 首次渲染
    setTimeout(function() { clearEnhancedFlags(); scheduleEnhance(); }, 300);
  }

  function scheduleEnhance() {
    if (_enhInProgress) return;
    clearTimeout(_enhTimer);
    _enhTimer = setTimeout(function() {
      _enhInProgress = true;
      enhanceCurrentTab();
      setTimeout(function() { _enhInProgress = false; }, 500);
    }, 200);
  }

  // ============================================================
  // 第四部分：初始化
  // ============================================================

  function init() {
    // 等待面板出现
    var checkExist = setInterval(function() {
      var panel = document.querySelector('.world-engine-panel');
      if (panel) {
        clearInterval(checkExist);
        // 面板状态记忆恢复
        loadPanelState();
        // API监控
        setupApiMonitor();
        // 自动隐藏
        if (window._world_engine_autoHideEnabled) setupAutoHide();
        // MutationObserver
        setupMutationObserver();
        // 保存面板状态
        setInterval(savePanelState, 5000);
      }
    }, 300);
  }

  // 工具函数
  function escHtml(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg, isError) {
    var id = 'world-engine-24enh-toast';
    var el = document.getElementById(id);
    if (el) el.parentNode.removeChild(el);
    el = document.createElement('div');
    el.id = id;
    el.className = 'world-engine-toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3000);
  }

  function refreshCurrentTab() {
    window.__world_engine_enh_refresh_needed = true;
    enhanceCurrentTab();
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 提供全局API
  window.__WORLD_ENGINE_24ENH = {
    showAchievementPopup: showAchievementPopup,
    showEntryPreview: showEntryPreview,
    showEvolveProgress: showEvolveProgress,
    hideEvolveProgress: hideEvolveProgress,
    renderPreviewModal: renderPreviewModal,
    generatePreview: generatePreview,
    refreshCurrentTab: refreshCurrentTab,
    renderUndoList: renderUndoList,
    renderDonutChart: renderDonutChart,
    renderBondCanvas: renderBondCanvas,
    renderDashboard: renderDashboard,
    toast: toast
  };
  window.WORLD_ENGINE_24ENHANCE = window.__WORLD_ENGINE_24ENH;

  console.log('[24enh] 24项UI增强模块已加载');
})();
