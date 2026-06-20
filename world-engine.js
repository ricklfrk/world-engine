// world-engine.js — 入口：动态加载所有模块，初始化，事件绑定，主API注入
// ============================================================
// ★ 修改记录 ★
// 2026-06-09 v3.0.0 — World Engine 全员投票集成版
//   - Phase-0: 全局错误边界(#5) · 自动存档/快照(#8) · 事件链统一索引(#4) · 记忆Tag索引(#6)
//   - Phase-1: 成就连击&徽章(#18) · A/B提示词(#23) · 配置/状态分离(#9) · 存储层统一接口(#10)
//              面板虚拟滚动(#7) · 注入智能折叠(#1) · Token预算动态裁剪(#3)
//   - Phase-2: 个人传奇(#16) · 世界事件时间轴(#13) · 记忆冷热分离(#2) · 羁绊树(#15)
//              成就回响(#14) · 情感状态机升级(#11)
//   - Phase-3: 里程碑之路(#21) · 角色生命周期(#12)
// 2026-06-05 v2.1.1
//   - [Bug 1 强化] onMessageReceived 添加 chat.length<=2 守卫，开场白不触发推演
//   - [Bug 4+5] 注入架构重写：addOneMessage → registerInjection / extensionPrompts
//   - [Bug 1] 新聊天冻结：init() 末尾不再调用 onChatLoaded()，改为惰性加载 worldbook
//   - [Bug 1] onChatLoaded 添加聊天空判断 + lastInjectedRound 重置
//   - [Bug 6] onChatLoaded 中调用 ui.resetUI()
//   - 添加防重入锁 window.__WORLD_ENGINE_INJECTING__
//   - 推演流程异常时自动恢复界面
// 2026-06-05 v2.2.0
//   - beforeMessageSend 中 await tagsGen.generatePredictionTags (异步化)
//   - 配合标签系统四层流水线改造
// ============================================================

(function() {
  if (window.__WORLD_ENGINE_LOADED__) return;

  const MODULES = [
    'world-engine-storage.js',
    'world-engine-core.js',
    'world-engine-memory.js',
    'world-engine-tags.js',
    'world-engine-presets.js',
    'world-engine-worldbook.js',
    'world-engine-inject.js',
    'world-engine-evolution.js',
    'world-engine-time.js',
    'world-engine-slash.js',
    'world-engine-ui.js',
    'world-engine-24enhance.js'
  ];

  const MODULE_EXPORTS = {
    'world-engine-storage.js': 'WORLD_ENGINE_STORAGE',
    'world-engine-core.js': 'WORLD_ENGINE_CORE',
    'world-engine-memory.js': 'WORLD_ENGINE_MEMORY',
    'world-engine-tags.js': 'WORLD_ENGINE_TAGS',
    'world-engine-presets.js': 'WORLD_ENGINE_PRESETS',
    'world-engine-worldbook.js': 'WORLD_ENGINE_WORLDBOOK',
    'world-engine-inject.js': 'WORLD_ENGINE_INJECT',
    'world-engine-evolution.js': 'WORLD_ENGINE_EVOLUTION',
    'world-engine-time.js': 'WORLD_ENGINE_TIME',
    'world-engine-slash.js': 'WORLD_ENGINE_SLASH',
    'world-engine-ui.js': 'WORLD_ENGINE_UI',
    'world-engine-24enhance.js': 'WORLD_ENGINE_24ENHANCE'
  };

  function getBaseUrl() {
    const scripts = document.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].src;
      if (src && src.includes('world-engine.js')) {
        return src.substring(0, src.lastIndexOf('/'));
      }
    }
    return './plugins/world-engine';
  }

  var WORLD_ENGINE_VERSION = '3.4.0';
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src + '?v=' + WORLD_ENGINE_VERSION;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  // v3.0.0: 强制重载 CSS（防浏览器缓存）
  function reloadCSS() {
    var links = Array.from(document.querySelectorAll('link[rel=stylesheet]')).filter(function(l) { return l.href && l.href.toLowerCase().indexOf('world-engine') >= 0; });
    links.forEach(function(link) {
      var oldHref = link.href.split('?')[0];
      link.href = oldHref + '?v=' + WORLD_ENGINE_VERSION;
    });
  }

  function showToast(message, isError = false, duration = 3000) {
    const id = 'world-engine-toast';
    let el = document.getElementById(id);
    if (el) el.remove();
    el = document.createElement('div');
    el.id = id;
    el.className = 'world-engine-toast' + (isError ? ' error' : '');
    el.innerText = message;
    document.body.appendChild(el);
    if (duration > 0) {
      setTimeout(() => el.remove(), duration);
    }
  }

  function showPersistToast(message, isError = false) {
    const id = 'world-engine-persist-toast';
    let el = document.getElementById(id);
    if (el) el.remove();
    el = document.createElement('div');
    el.id = id;
    el.className = 'world-engine-toast' + (isError ? ' error' : '');
    el.innerText = message;
    document.body.appendChild(el);
    return el;
  }

  function removePersistToast() {
    const el = document.getElementById('world-engine-persist-toast');
    if (el) el.remove();
  }

  // ========== 注入管理（registerInjection / extensionPrompts 双兼容） ==========
  const INJECTION_NAME = 'world-engine-world';

  function unregisterInjection() {
    try {
      const ctx = SillyTavern.getContext();
      if (typeof ctx.unregisterInjection === 'function') {
        ctx.unregisterInjection(INJECTION_NAME);
      } else if (Array.isArray(ctx.extensionPrompts)) {
        ctx.extensionPrompts = ctx.extensionPrompts.filter(p => p.name !== INJECTION_NAME);
      }
    } catch(e) { /* 忽略 */ }
  }

  function registerInjection(content) {
    try {
      const ctx = SillyTavern.getContext();
      // 方法1：registerInjection（新版 ST，推荐）
      if (typeof ctx.registerInjection === 'function') {
        // 先注销旧的再注册新的
        if (typeof ctx.unregisterInjection === 'function') {
          ctx.unregisterInjection(INJECTION_NAME);
        }
        ctx.registerInjection(INJECTION_NAME, content, { position: 'before', priority: 10 });
        return true;
      }
      // 方法2：setExtensionPrompt（中版 ST）
      if (typeof ctx.setExtensionPrompt === 'function') {
        ctx.setExtensionPrompt(INJECTION_NAME, content, 'before', 10);
        return true;
      }
      // 方法3：extensionPrompts 数组（旧版 ST，最兼容）
      if (Array.isArray(ctx.extensionPrompts)) {
        ctx.extensionPrompts = ctx.extensionPrompts.filter(p => p.name !== INJECTION_NAME);
        ctx.extensionPrompts.push({
          name: INJECTION_NAME,
          content: content,
          role: 'system',
          position: 'before',
          priority: 10
        });
        return true;
      }
      // 方法4：generateOpts（远古版，兜底）
      if (typeof ctx.generateOpts === 'object') {
        ctx.generateOpts.system_prompt = (ctx.generateOpts.system_prompt || '') + '\n\n' + content;
        return true;
      }
      console.warn('[World Engine] 所有注入方式均不可用');
      return false;
    } catch (e) {
      console.error('[World Engine] 注入失败', e);
      return false;
    }
  }

  async function init() {
    const baseUrl = getBaseUrl();
    console.log('[World Engine] 加载基础路径:', baseUrl);
    try {
      for (const mod of MODULES) {
        await loadScript(`${baseUrl}/${mod}`);
        console.log(`[World Engine] 已加载: ${mod}`);
        // ★ 运行时检查：验证模块全局变量已定义，防止语法错误静默失败
        const modVar = MODULE_EXPORTS[mod];
        if (!window[modVar]) {
          console.error(`[World Engine] ❌ ${mod} 加载异常：${modVar} 未定义，文件可能存在语法错误`);
        }
      }

      // v3.0.0: 强制刷新 CSS 缓存
      if (window.WORLD_ENGINE_STORAGE && typeof window.WORLD_ENGINE_STORAGE.initConfigFolder === 'function') {
        await window.WORLD_ENGINE_STORAGE.initConfigFolder();
      }

      reloadCSS();

      const core = window.WORLD_ENGINE_CORE;
      const memory = window.WORLD_ENGINE_MEMORY;
      const worldbook = window.WORLD_ENGINE_WORLDBOOK;
      const tagsGen = window.WORLD_ENGINE_TAGS;
      const evolution = window.WORLD_ENGINE_EVOLUTION;
      const timeModule = window.WORLD_ENGINE_TIME;
      const slash = window.WORLD_ENGINE_SLASH;
      const ui = window.WORLD_ENGINE_UI;
      const inject = window.WORLD_ENGINE_INJECT;

      if (!ui || typeof ui.buildUI !== 'function') {
        throw new Error('UI模块未正确加载');
      }

      ui.buildUI();
      slash.registerCommands();

      let isEvolving = false;
      let lastInjectedRound = -1;
      let worldbookLoaded = false;  // Bug 1：惰性加载 worldbook

      // ========== 主API注入：在用户发送消息之前（非消息注入，改用 prompt 注入） ==========
      async function beforeMessageSend() {
        // Bug 5：防重入锁
        if (window.__WORLD_ENGINE_INJECTING__) return;
        window.__WORLD_ENGINE_INJECTING__ = true;
        try {
          const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
          if (!ctx) return;
          const state = core.loadState();
          const currentRound = state.round;
          if (lastInjectedRound === currentRound) return;
          lastInjectedRound = currentRound;

          const chatHistory = ctx.chat || [];

          // Bug 1：首次发送时惰性加载 worldbook
          if (!worldbookLoaded) {
            worldbookLoaded = true;
            try { await worldbook.loadWorldbooks(); } catch(e) { console.warn('[World Engine] worldbook 模块失败', e); }
          }

          // v2.3.0：驱动模式检查 — 手动模式下按间隔触发推演
          const settings = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
          const driveMode = state.driveMode || settings.driveMode || 'ai';
          const evolveInterval = parseInt(settings.evolveInterval, 10) || 10;
          if (driveMode === 'manual' && currentRound > 0 && currentRound % evolveInterval === 0) {
            const lastMsg = chatHistory[chatHistory.length - 1];
            const userMsg = lastMsg?.is_user ? (lastMsg.mes || '') : '';
            const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '') : '';
            showPersistToast('⏳ 手动模式推演中...');
            try {
              await evolution.evolve(state, userMsg, aiMsg);
              removePersistToast();
            } catch(e) {
              removePersistToast();
              console.warn('[World Engine] 手动模式推演失败', e);
            }
          }

          let tags; try { tags = await tagsGen.generatePredictionTags(chatHistory, state); } catch(e) { console.warn('[World Engine] tags 模块失败', e); tags = []; }
          let context; try { context = await inject.buildContext(chatHistory, state, tags, { includeWorldbook: settings.injectWorldbook === true }); } catch(e) { console.warn('[World Engine] inject 模块失败', e); context = ''; }

          // 保存最后一次注入的内容供调试
          state.lastInjection = {
            timestamp: Date.now(),
            round: currentRound,
            context: context,
            tagsUsed: tags
          };
          core.saveState(state);
          if (window.WORLD_ENGINE_UI && window.WORLD_ENGINE_UI.refresh) window.WORLD_ENGINE_UI.refresh();

          // Bug 4+5：使用 prompt 注入代替 addOneMessage，不污染聊天记录
          const success = registerInjection(context);
          if (success) {
            console.log(`[World Engine] 注入成功 (round ${currentRound}, ${context.length} chars)`);
          } else {
            // 终极兜底：用 addOneMessage（带标记避免重复触发）
            if (typeof ctx.addOneMessage === 'function') {
              const systemMessage = {
                mes: `🧠 **World Engine 世界记忆**\n${context}`,
                name: '系统',
                is_system: true,
                send_date: new Date().toISOString(),
                is_user: false,
                extra: {},
                swipes: [],
                swiper_id: null,
                swipe_info: null,
              };
              ctx.addOneMessage(systemMessage);
            } else {
              console.warn('[World Engine] 无法注入上下文');
            }
          }
        } finally {
          window.__WORLD_ENGINE_INJECTING__ = false;
        }
      }

      // ========== 消息接收后的处理（存储记忆、推演 + v2.3.0 时间推进） ==========
      async function onMessageReceived() {
        if (isEvolving) return;
        isEvolving = true;

        const persistToast = showPersistToast('🌍 世界推演中...');

        try {
          const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
          if (!ctx) { isEvolving = false; return; }
          const state = core.loadState();
          const chat = ctx.chat || [];
          if (chat.length === 0) { isEvolving = false; return; }

          // ★ 2026-06-05 Bug 1 强化：新聊天冻结，等用户-模型完成至少一轮完整交互后再推演
          // chat.length: 1=角色开场白, 2=用户发了第一条但尚未收到回复, 3=第一轮完整交互
          if (chat.length <= 2) {
            console.log('[World Engine] 新聊天冻结：等待第一轮完整交互（chat.length=' + chat.length + '）');
            isEvolving = false;
            removePersistToast();
            ui.refresh();
            return;
          }
          const lastMsg = chat[chat.length - 1];
          const userMsg = lastMsg?.is_user ? (lastMsg.mes || '') : '';
          const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '') : '';

          // 存储本轮记忆
          try { await memory.storeMemoryFromRound(state, userMsg, aiMsg, state.round); } catch(e) { console.warn('[World Engine] memory 模块失败', e); }

          // 强制触发事件链 + 血仇追杀
          try { evolution.forceTriggerEvents(state); } catch(e) { console.warn('[World Engine] evolution 事件链模块失败', e); }
          try { evolution.advanceBloodFeud(state); } catch(e) { console.warn('[World Engine] evolution 血仇模块失败', e); }

          const settings = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
          let evolveSuccess = true;
          let evolveResult = null;
          const driveMode = state.driveMode || settings.driveMode || 'ai';
          // v2.3.0 Bugfix: 手动模式下不在此触发演化（由 beforeMessageSend 按间隔触发）
          if (settings.autoEvolve !== false && driveMode !== 'manual') {
            // v2.3.0：捕获演化结果以提取 timeEstimateMinutes
            // 这里在进化模块内，进化 API 返回 update 对象
            // 由于 evolution.evolve 内部调用 callEvolutionAPI，返回布尔值
            // 我们从 state 备份恢复中获取最新状态
            evolveSuccess = await evolution.evolve(state, userMsg, aiMsg);
            // 重新加载状态以获取最新数据
            if (evolveSuccess) {
              const updatedState = core.loadState();
              evolveResult = updatedState.lastEvolveResult || null;
            }
          }

          // v2.3.0：时间推进系统
          // v2.4.1 Bugfix: 使用 addTimeLog 记录时间日志，使 AI 模式的时间增量在 UI 中可见
          if (evolveSuccess && timeModule && typeof timeModule.calculateTimeIncrement === 'function') {
            const oldMinutes = state.inWorldMinutes || 0;
            const chatText = userMsg + ' ' + aiMsg;
            let increment; try { increment = timeModule.calculateTimeIncrement(evolveResult, chatText, settings); } catch(e) { console.warn('[World Engine] time 模块失败', e); increment = 0; }
            core.addTimeLog(state, increment, 'ai');
            state.lastTimeCheckRound = state.round;

            // 检查时间阈值触发
            const triggered = timeModule.shouldTriggerEvents(oldMinutes, state.inWorldMinutes);
            if (triggered.includes('events')) {
              console.log('[World Engine] ⏰ 时间到达事件链触发阈值');
            }
            if (triggered.includes('chapter')) {
              console.log('[World Engine] 📖 时间到达章节摘要触发阈值');
              // 取本轮之前最近 10 轮作为章节范围
              const startRound = Math.max(0, state.round - 9);
              await memory.mergeChapterSummary(state, startRound, state.round);
            }
            if (triggered.includes('volume')) {
              console.log('[World Engine] 📚 时间到达卷摘要触发阈值');
              const startRound = Math.max(0, state.round - 49);
              await memory.mergeVolumeSummary(state, startRound, state.round);
            }

            core.saveState(state);
          } else {
            // 降级：无时间模块时仍使用轮次触发摘要
            if (evolveSuccess && state.round % 10 === 0 && state.round > 0) {
              await memory.mergeChapterSummary(state, state.round - 9, state.round);
            }
            if (evolveSuccess && state.round % 50 === 0 && state.round > 0) {
              await memory.mergeVolumeSummary(state, state.round - 49, state.round);
            }
          }

          removePersistToast();

          // v2.6.0: 无条件推进故事阶段（即使 autoEvolve=false）
          if (core && typeof core.advanceStoryPhase === 'function') {
            var st = core.loadState();
            core.advanceStoryPhase(st);
            core.saveState(st);
          }

          // v2.6.0: 如果没有 NPC 活动但 emotionMap 有实体，生成默认 NPC 活动
          var latestState = core.loadState();
          if (latestState.npcActivityLog && latestState.npcActivityLog.length === 0 && Object.keys(latestState.emotionMap || {}).length > 0) {
            // 首次推演后有情感实体但没有 NPC 活动——生成默认活动
            var npcNames = Object.keys(latestState.emotionMap).slice(0, 3);
            for (var ni = 0; ni < npcNames.length; ni++) {
              var activityText = latestState.emotionMap[npcNames[ni]].attitude === '敌意' || latestState.emotionMap[npcNames[ni]].attitude === '不共戴天'
                ? '在暗中观察' : '在忙自己的事';
              core.addNpcActivity(latestState, npcNames[ni], activityText, '未知', 'rest');
            }
          }
          // v2.6.0: 确保每个活跃事件有对应的剧情线索
          if (latestState.events && latestState.events.length && latestState.plotThreads) {
            for (var ei = 0; ei < latestState.events.length; ei++) {
              var ev = latestState.events[ei];
              if (ev.stage === '已爆发' || ev.stage === '余波') continue;
              var hasThread = latestState.plotThreads.some(function(t) {
                return t.connectedEventNames && t.connectedEventNames.indexOf(ev.name) !== -1;
              });
              if (!hasThread) {
                var remaining = ev.totalRounds - ev.currentRound;
                var initialProgress = Math.floor((1 - remaining / ev.totalRounds) * 40) || 10;
                core.addPlotThread(latestState, {
                  id: core.generateThreadId(),
                  title: ev.name,
                  type: 'event',
                  status: 'active',
                  progress: initialProgress,
                  phase: ev.stage,
                  description: ev.desc || '事件正在发展',
                  participants: ev.participants || [],
                  relatedFactions: ev.relatedFactions || [],
                  connectedEventNames: [ev.name],
                  milestones: [{ round: latestState.round, event: '📜 事件开始：' + (ev.desc || ev.name) }]
                });
              }
            }
          }

          // v2.7.0: 成就检测——仅从演化结果 JSON 解析，AI 说发生才算发生，不轮询
          if (evolveSuccess && evolveResult && core && typeof core.checkAutoAchievements === 'function') {
            // 从演化结果解析成就
            var achNewly = core.checkAutoAchievements(latestState, evolveResult);
            if (achNewly && achNewly.length > 0) {
              for (var achi = 0; achi < achNewly.length; achi++) {
                var a = achNewly[achi];
                var aTitle = a.title || (core.ACHIEVEMENT_DEFS && core.ACHIEVEMENT_DEFS[a.id] ? core.ACHIEVEMENT_DEFS[a.id].title : a.id);
                showToast('🏆 成就解锁：' + aTitle);
                // 写入记忆
                if (typeof memory !== 'undefined' && memory.storeMemoryFromRound) {
                  try {
                    memory.storeMemoryFromRound(latestState, '', '🏆 成就解锁：' + (aTitle) + ' — ' + (a.note || a.desc || ''), latestState.round);
                  } catch(e) {}
                }
              }
              core.saveState(latestState);
            }
            // 自动解锁轮数/成就数条件成就
            var autoNewly = core.checkAutoUnlockAchievements(latestState);
            if (autoNewly && autoNewly.length > 0) {
              for (var ai2 = 0; ai2 < autoNewly.length; ai2++) {
                showToast('🏆 成就解锁：' + autoNewly[ai2].title);
              }
              core.saveState(latestState);
            }
          }

          // v2.8.0: 扫描新角色并自动创建画像
          if (core && typeof core.scanForNewCharacters === 'function') {
            try { core.scanForNewCharacters(latestState); } catch(e) {}
          }

          // v2.8.0: 战斗成就检测
          if (latestState.combat && latestState.combat.totalBattles > 0 && core && typeof core.checkCombatAchievements === 'function') {
            try {
              var combatNewly = core.checkCombatAchievements(latestState, null);
              if (combatNewly && combatNewly.length) {
                for (var cai = 0; cai < combatNewly.length; cai++) {
                  var caDef = core.ACHIEVEMENT_DEFS && core.ACHIEVEMENT_DEFS[combatNewly[cai]];
                  if (caDef) showToast('🏆 战斗成就：' + caDef.title);
                }
                core.saveState(latestState);
              }
            } catch(e) {}
          }

          // v2.8.0: 隐藏成就检测
          if (core && typeof core.checkHiddenAchievements === 'function') {
            try {
              var hiddenNewly = core.checkHiddenAchievements(latestState);
              if (hiddenNewly && hiddenNewly.length) {
                for (var hai = 0; hai < hiddenNewly.length; hai++) {
                  var haDef = core.ACHIEVEMENT_DEFS && core.ACHIEVEMENT_DEFS[hiddenNewly[hai]];
                  if (haDef) showToast('🏆 隐藏成就解锁：' + haDef.title);
                }
                core.saveState(latestState);
              }
            } catch(e) {}
          }

          if (evolveSuccess) {
            showToast('✅ 世界推演完成');
          } else {
            showToast('⚠️ 推演失败，轮次未增加', true);
          }
          // v3.0.0: 自动备份
          if (core && typeof core.autoBackup === 'function') {
            try { core.autoBackup(core.loadState()); } catch(e) { console.warn('[World Engine] 自动备份失败', e); }
          }
          ui.refresh();
        } catch (e) {
          console.error('[World Engine] 处理失败', e);
          removePersistToast();
          showToast(`推演异常: ${e.message}`, true);
        } finally {
          isEvolving = false;
        }
      }

      async function onChatLoaded() {
        // Bug 1：全新聊天，冻结所有推演
        const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
        const chat = ctx?.chat || [];
        if (chat.length === 0) {
          // ★ v2.5.1 Bugfix: 新聊天也清理
          if (core.clearSavepoints) core.clearSavepoints();
          const state = core.loadState();
          state.round = 0;
          core.saveState(state);
          // ★ v2.5.2 Bugfix: 空聊天也加载世界书（刷新 bookMetaCache，使设置页显示正确列表）
          if (typeof worldbook !== 'undefined' && worldbook.loadWorldbooks && worldbook.getAvailableBooks) {
            worldbook.loadWorldbooks().then(function() { }).catch(function(e) { console.warn('[World Engine] 空聊天预加载世界书失败', e); });
          }
          worldbookLoaded = false;
        } else {
          // ★ v2.5.1 Bugfix: 切聊天清理旧快照
          if (core.clearSavepoints) core.clearSavepoints();
          await worldbook.loadWorldbooks();
          worldbookLoaded = true;
        }

        // Bug 1：跨聊天重置
        lastInjectedRound = -1;
        // Bug 6：重置 UI 面板
        if (ui.resetUI) ui.resetUI();
        // 注销旧注入
        unregisterInjection();

        const state = core.loadState();
        ui.refresh();
        console.log('[World Engine] 聊天已加载，世界书同步完成');
      }

      function onMessageSwiped() {
        lastInjectedRound = -1;
        // ★ v2.5.1: 消息切换时自动回退世界状态
        if (core && core.rollbackToChatLength && core.getSavepoints) {
          try {
            var savepoints = core.getSavepoints();
            if (savepoints.length > 0) {
              var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
              var chatLen = ctx?.chat?.length || 0;
              if (chatLen > 0) {
                var restored = core.rollbackToChatLength(chatLen);
                if (restored) {
                  console.log('[World Engine] 消息切换，世界状态已回退 (chatLen=' + chatLen + ')');
                  if (ui && ui.refresh) ui.refresh();
                }
              }
            }
          } catch(e) {
            console.warn('[World Engine] 状态回退失败', e);
          }
        }
        console.log('[World Engine] 检测到消息切换，已重置注入标记');
      }

      // ★ v2.6.0: 消息删除时回退世界状态（修复 Bug-001/005）
      function onMessageDeleted() {
        try {
          var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
          var chatLen = ctx?.chat?.length || 0;
          if (chatLen <= 0) {
            // 聊天空了，清理全部存档
            if (core && core.clearSavepoints) core.clearSavepoints();
            lastInjectedRound = -1;
            if (ui && ui.refresh) ui.refresh();
            return;
          }
          if (core && core.rollbackToChatLength && core.getSavepoints) {
            var restored = core.rollbackToChatLength(chatLen);
            if (restored) {
              // 过滤掉已回退的存档
              var sps = core.getSavepoints() || [];
              sps = sps.filter(function(sp) { return sp.chatLen <= chatLen; });
              window.WORLD_ENGINE_STORAGE.setItem(core.getSavepointKey(), JSON.stringify(sps));
              if (ui && ui.refresh) ui.refresh();
            } else {
              // Bug-001 fix: 不删存档，只警告
              console.warn('[World Engine] 未找到匹配 chatLen=' + chatLen + ' 的 savepoint，保留现有存档');
            }
          }
        } catch(e) {
          console.warn('[World Engine] onMessageDeleted 处理失败', e);
        }
      }

      const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
      if (ctx && ctx.eventSource) {
        const messageSentEvent = ctx.event_types?.MESSAGE_SENT || 'message_sent';
        const messageReceivedEvent = ctx.event_types?.MESSAGE_RECEIVED || 'message_received';
        const chatLoadedEvent = ctx.event_types?.CHAT_LOADED || 'chat_loaded';
        const messageSwipedEvent = ctx.event_types?.MESSAGE_SWIPED || 'message_swiped';
        ctx.eventSource.on(messageSentEvent, beforeMessageSend);
        ctx.eventSource.on(messageReceivedEvent, onMessageReceived);
        ctx.eventSource.on(chatLoadedEvent, onChatLoaded);
        if (messageSwipedEvent) {
          ctx.eventSource.on(messageSwipedEvent, onMessageSwiped);
        } else {
          const messageEditedEvent = ctx.event_types?.MESSAGE_EDITED || 'message_edited';
          ctx.eventSource.on(messageEditedEvent, onMessageSwiped);
        }
        // ★ v2.5.1: 消息删除时清理过期快照
        var messageDeletedEvent = ctx.event_types?.MESSAGE_DELETED || 'message_deleted';
        ctx.eventSource.on(messageDeletedEvent, onMessageDeleted);
        console.log('[World Engine] 事件绑定成功');
      } else {
        console.warn('[World Engine] 无法绑定事件，自动推演和注入不可用');
      }

      // ★ v2.5.0: 初始化预设系统
      if (core && typeof core.initPresets === 'function') {
        core.initPresets();
      }
      // Bug 1：不再在 init() 末尾调用 onChatLoaded()，等 CHAT_LOADED 事件触发
      window.__WORLD_ENGINE_LOADED__ = true;
    } catch (err) {
      console.error('[World Engine] 初始化失败', err);
    }
  }

  init();
})();
