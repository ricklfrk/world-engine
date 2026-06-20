// world-engine-evolution.js — 演化API调用 + 事件链强制触发 + 血仇自动追杀
// ============================================================
// ★ 修改记录 ★
// 2026-06-05 v2.1.0
//   - forceTriggerEvents 增强：倒计时归零事件强制爆发，给出合理剧情表现
//   - advanceBloodFeud 增强：血仇永不挂起，每5-10轮生成追杀行动
//   - 事件链挂起机制：允许"挂起-外围准备"状态并记录原因和恢复条件
//   - 事件链催熟：剩余 1 轮时自动标记为"即将爆发"以影响预测标签
//   - decayRumors 增强：增加流言异变（可能变异为其他流言）
// 2026-06-05 v2.2.0
//   - callEvolutionAPI 中 await tagsGen.generatePredictionTags (配合异步改造)
//
// 2026-06-06 v2.4.0 迭代B
//   - callEvolutionAPI prompt 三段式重构（因果推理+规则+状态）
//   - 新增 validateEvolution() 后处理验证
//   - 新增重试机制（retryCount 参数）
//   - 已有事件/势力标记 locked 字段防止 AI 误改
//
// 2026-06-11 v3.1.0 修复版
//   - 【关键】API 字段名统一：callApi 读取 settings.apiUrl/apiKey/apiModel（与 UI 保存一致）
//   - 【关键】generateRaw 降级链：对象格式 → 字符串格式 → generate → textCompletion → 自动回退自定义 API
//   - 【增强】callCustomApi 独立函数，响应兼容 KoboldCPP/Ooba 等非标准格式
//   - 【增强】normalizeApiUrl 兼容 /api/v1 路徑
// ============================================================

window.WORLD_ENGINE_EVOLUTION = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const memory = window.WORLD_ENGINE_MEMORY;
  const tagsGen = window.WORLD_ENGINE_TAGS;
  const worldbook = window.WORLD_ENGINE_WORLDBOOK;

  // ========== 通用 API 调用函数（参考旧版模式） ==========
  async function callApi(prompt, maxTokens = 2000, temperature = 0.7) {
    const settings = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
    const apiMode = settings.apiMode || 'tavern';
    let customUrl = settings.customUrl || settings.apiUrl || '';
    const customKey = settings.customKey || settings.apiKey || '';
    const customModel = settings.customModel || settings.apiModel || 'gpt-3.5-turbo';

    if (apiMode === 'tavern') {
      const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
      if (!ctx) throw new Error('无法获取 SillyTavern 上下文');
      if (typeof ctx.generateRaw !== 'function') throw new Error('当前环境不支持 generateRaw，请切换到自定义 API 模式');

      // ★ v3.1.2：改用 prompt 数组格式，ST 只认这个。删掉无效的 messages 格式。
      try {
        let result = await ctx.generateRaw({
          prompt: [{ role: 'user', content: prompt }],
          max_length: maxTokens,
        });
        if (typeof result !== 'string') result = result.text || String(result);
        return result;
      } catch (err) {
        console.warn('[World Engine] Tavern API 调用失败，尝试回退自定义 API:', err.message);
        if (customUrl) {
          const fallback = await callCustomApi(customUrl, customKey, customModel, prompt, maxTokens, temperature);
          if (fallback) return fallback;
        }
        throw new Error('Tavern API 调用失败: ' + err.message);
      }
    } else {
      if (!customUrl) throw new Error('未配置自定义 API URL');
      return await callCustomApi(customUrl, customKey, customModel, prompt, maxTokens, temperature);
    }
  }

  function normalizeApiUrl(url) {
    let u = (url || '').trim().replace(/\/+$/, '').replace(/\/api\/?$/i, '');
    if (!u) return '';
    if (u.endsWith('/chat/completions')) return u;
    if (u.endsWith('/v1')) return u + '/chat/completions';
    return u + '/v1/chat/completions';
  }

  // ★ v3.1.1: 独立的自定义 API 调用（支持 OpenAI/KoboldCPP/Ooba 等非标准格式）
  async function callCustomApi(url, key, model, prompt, maxTokens, temperature) {
    const fullUrl = normalizeApiUrl(url);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': key ? ('Bearer ' + key) : '' },
        body: JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }], temperature: temperature, max_tokens: maxTokens }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (data.choices && data.choices[0] && data.choices[0].message) return data.choices[0].message.content;
      if (data.results && data.results[0] && data.results[0].text) return data.results[0].text;
      if (Array.isArray(data)) return data.map(function(r){return r.choices?.[0]?.text || r.text || '';}).join('').trim();
      if (typeof data === 'object' && data.response) return data.response;
      throw new Error('API 返回格式异常');
    } catch (e) {
      clearTimeout(timeoutId);
      const baseNoApi = url.replace(/\/+$/, '').replace(/\/api$/i, '');
      try {
        const altUrl = baseNoApi + '/api/v1/generate';
        if (altUrl !== fullUrl) {
          const altResp = await fetch(altUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': key ? ('Bearer ' + key) : '' },
            body: JSON.stringify({ prompt: prompt, max_context_length: 4096, max_length: maxTokens, temperature: temperature }),
            signal: AbortSignal.timeout(15000)
          });
          if (altResp.ok) {
            const altData = await altResp.json();
            if (altData.results && altData.results[0] && altData.results[0].text) return altData.results[0].text;
          }
        }
      } catch (e2) {}
      throw e;
    }
  }

  // ========== 事件链硬触发（增强版） ==========
  function forceTriggerEvents(state) {
    let triggered = false;
    for (const ev of state.events) {
      const remaining = ev.totalRounds - ev.currentRound;

      // 处理挂起状态
      if (ev.stage === '挂起' && ev.suspendCondition) {
        // 每次轮询检查挂起条件是否满足（通过标签判断上下文是否变化）
        // 简单规则：挂起超过3轮自动恢复
        if (ev.suspendRounds === undefined) ev.suspendRounds = 0;
        ev.suspendRounds++;
        if (ev.suspendRounds >= 3) {
          ev.stage = '发酵';
          ev.suspendRounds = 0;
          delete ev.suspendCondition;
          delete ev.suspendReason;
          core.addMemory(state, {
            id: `event_resume_${Date.now()}_${ev.name}`,
            type: 'round',
            summary: `事件恢复：${ev.name} 已从挂起状态恢复。`,
            context: ev.suspendResumeNote || ev.desc,
            tags: { topics: ['event'] },
            importance: 3,
            round: state.round,
          });
          triggered = true;
        }
        ev.currentRound++;
        continue;
      }

      if (remaining <= 0 && ev.status !== '已爆发') {
        ev.status = '已爆发';
        ev.stage = '已爆发';
        triggered = true;

        // 记忆：事件爆发
        core.addMemory(state, {
          id: `event_${Date.now()}_${ev.name}`,
          type: 'round',
          summary: `‼️ 事件爆发：${ev.name}！${ev.desc}`,
          context: ev.desc,
          tags: { topics: ['event', 'critical', 'eruption'] },
          importance: 5,
          round: state.round,
        });
        console.log(`[World Engine Evolution] 🚨 强制触发事件: ${ev.name}`);

      } else if (remaining <= 1 && ev.stage !== '已爆发' && ev.stage !== '挂起') {
        // 剩余 1 轮：标记为即将爆发，但不强制推进
        // 标签生成时会影响预测标签权重
        ev.stage = '即将爆发';
        ev.currentRound++;
        console.log(`[World Engine Evolution] ⚠️ 事件即将爆发: ${ev.name}`);
      } else if (remaining > 0 && ev.stage !== '已爆发' && ev.stage !== '挂起') {
        ev.currentRound++;
        if (remaining <= 2) {
          // 剩余 2 轮进入发酵阶段
          if (ev.stage === '萌芽') ev.stage = '发酵';
          console.log(`[World Engine Evolution] 事件推进: ${ev.name} (${ev.currentRound}/${ev.totalRounds})`);
        }
      }
    }
    if (triggered) core.saveState(state);
    return triggered;
  }

  // ========== 血仇自动追杀（增强版：永不挂起，5-10轮循环） ==========
  function advanceBloodFeud(state) {
    if (!state.bloodFeudMemo || !state.bloodFeudMemo.length) return false;
    let advanced = false;
    for (const bf of state.bloodFeudMemo) {
      if (bf.status === '已终结') continue;

      // 初始化首次追杀周期
      if (!bf.nextAttackRound) {
        bf.nextAttackRound = state.round + Math.floor(Math.random() * 6) + 5; // 5-10轮后
        bf.status = bf.status || '追踪中';
        bf.attackCount = bf.attackCount || 0;
      }

      // 达到追杀轮次
      if (state.round >= bf.nextAttackRound) {
        bf.lastActionRound = state.round;
        bf.attackCount = (bf.attackCount || 0) + 1;

        if (bf.attackCount >= 5) {
          // 5次追杀后可能终结
          bf.status = '已终结';
          core.addMemory(state, {
            id: `bf_end_${Date.now()}_${bf.faction}`,
            type: 'round',
            summary: `血仇终结：${bf.faction} 的追杀告一段落。`,
            context: '',
            tags: { topics: ['revenge', 'settled'] },
            importance: 4,
            round: state.round,
          });
        } else {
          bf.status = '追杀中';
          // 下一次攻击：5-10轮后
          bf.nextAttackRound = state.round + Math.floor(Math.random() * 6) + 5;

          core.addMemory(state, {
            id: `bf_${Date.now()}_${bf.faction}`,
            type: 'round',
            summary: `⚠️ 血仇行动：${bf.faction} 派出追杀者（第${bf.attackCount}次）。原因：${bf.reason}`,
            context: '',
            tags: { topics: ['revenge', '追杀', '战斗'] },
            importance: 5,
            round: state.round,
          });
          console.log(`[World Engine Evolution] 🔪 血仇追杀 #${bf.attackCount}: ${bf.faction}`);
        }
        advanced = true;
      } else if (bf.status === '追杀中' && (state.round - bf.lastActionRound) >= 3) {
        // 追杀中但已过去3轮无行动 → 追踪中
        bf.status = '追踪中';
      }
    }
    if (advanced) core.saveState(state);
    return advanced;
  }

  // ========== 验证演化结果 ==========
  function validateEvolution(update, oldState, strictMode) {
    const warnings = [];
    let valid = true;

    // 检查事件是否回退
    if (update.events && oldState.events) {
      for (const newEv of update.events) {
        const oldEv = oldState.events.find(e => e.name === newEv.name);
        if (oldEv) {
          const stageOrder = ['萌芽', '发酵', '逼近', '即将爆发', '已爆发', '余波'];
          const oldStageIdx = stageOrder.indexOf(oldEv.stage);
          const newStageIdx = stageOrder.indexOf(newEv.stage);
          if (newStageIdx !== -1 && oldStageIdx !== -1 && newStageIdx < oldStageIdx) {
            warnings.push(`事件「${newEv.name}」stage 从 ${oldEv.stage} 回退到 ${newEv.stage}`);
            // 严格模式下拒绝，否则自动修复
            if (strictMode) {
              valid = false;
              // 保留旧版本
              const idx = update.events.findIndex(e => e.name === newEv.name);
              if (idx !== -1) update.events.splice(idx, 1);
            } else {
              const idx = update.events.findIndex(e => e.name === newEv.name);
              if (idx !== -1) update.events[idx] = { ...oldEv };
            }
          }
        }
      }
      // v2.4.1 Bugfix: 正确的静默删除检测——遍历 oldState 检查缺失
      for (const oldEv of oldState.events) {
        if (oldEv.stage !== '已爆发' && oldEv.stage !== '余波' && !update.events.some(e => e.name === oldEv.name)) {
          warnings.push(`已有事件「${oldEv.name}」被静默删除，已保留`);
          if (!oldEv.locked) update.events.push({ ...oldEv });
        }
      }
      // 检查事件一致性
      for (const ev of update.events) {
        if (ev.currentRound && ev.totalRounds && ev.currentRound > ev.totalRounds) {
          warnings.push(`事件「${ev.name}」currentRound(${ev.currentRound}) > totalRounds(${ev.totalRounds})，自动修正`);
          ev.currentRound = ev.totalRounds;
        }
      }
    }

    // 检查势力是否被静默删除
    if (update.factions && oldState.factions) {
      for (const oldF of oldState.factions) {
        if (!oldF.locked && !update.factions.some(f => f.name === oldF.name)) {
          warnings.push(`势力「${oldF.name}」被静默删除，已保留`);
          update.factions.push({ ...oldF });
        }
      }
    }

    // 检查是否全空
    const isEmpty = (
      (!update.events || update.events.length === 0) &&
      (!update.factions || update.factions.length === 0) &&
      (!update.rumors || update.rumors.length === 0) &&
      (!update.world_digest || update.world_digest === oldState.worldDigest)
    );
    if (isEmpty) {
      warnings.push('演化结果全空或完全无变化');
      valid = false;
    }

    return { valid, warnings, fixedUpdate: update };
  }

  // ========== 演化 API 调用（v2.4.0 增强版） ==========
  async function callEvolutionAPI(state, userMsg, aiMsg, retryCount = 0) {
    let chatHistory = [];
    try {
      const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
      if (ctx && ctx.chat) chatHistory = ctx.chat;
    } catch(e) { console.warn('[World Engine] 获取聊天历史失败', e); }

    let tags = [];
    if (tagsGen && typeof tagsGen.generatePredictionTags === 'function') {
      tags = await tagsGen.generatePredictionTags(chatHistory, state);
    }

    let worldbookTexts = [];
    if (worldbook && typeof worldbook.matchEntries === 'function') {
      worldbookTexts = worldbook.matchEntries(tags, 5);
    }

    var core2 = window.WORLD_ENGINE_CORE;
    var storyBlock = '';
    if (core2 && typeof core2.getStoryPromptBlock === 'function') {
      storyBlock = core2.getStoryPromptBlock(state);
    }
    var storyDirectionSection = '';
    if (storyBlock) {
      storyDirectionSection = '\n' + storyBlock + '\n';
    }
    const worldbookSection = worldbookTexts.length > 0
      ? `\n## 当前世界的背景知识（来自世界书）\n${worldbookTexts.map((t,i) => `${i+1}. ${t.substring(0, 300)}`).join('\n')}\n`
      : '';

    // 标记已锁定的事件和势力（防止 AI 误修改）
    const lockedEvents = state.events
      .filter(e => e.stage === '已爆发' || e.stage === '余波')
      .map(e => ({ name: e.name, stage: e.stage, locked: true }));
    const lockedFactions = state.factions
      .filter(f => f.locked === true)
      .map(f => ({ name: f.name, locked: true }));

    const engineRules = `
## 世界演化强制规则（必须严格遵守）

1. **事件链**：至少维护 1~3 个事件。每个事件必须有：name, level(1-4), stage(萌芽/发酵/逼近/爆发/余波), currentRound, totalRounds(3-8), desc, trigger。
   - 若存在血仇备忘，必须创建对应的事件链。
   - 已存在的事件链按轮次推进（currentRound++），若 currentRound >= totalRounds 则 stage 改为"已爆发"。
   - 不允许"剩余 1 轮持续 5 轮"的情况。如果剧情需要延迟，必须在面板说明挂起原因(reason/suspendCondition/suspendResumeNote)。
   - **下方 lockedEvents 列表中的事件已锁定，你只能推进它们，不可倒退或删除**。
2. **势力**：至少维护 3 个势力。每个势力必须有：name, cohesion(团结/松散/分裂), resources(充足/紧张/枯竭), currentGoal(字符串), attentionToUser(无/观察/拉拢/排斥)。
   - 若势力少于 3 个，必须创建新势力。
   - **下方 lockedFactions 列表中的势力已锁定，不可删除，只能更新属性**。
3. **流言**：至少生成 2 条流言。每条流言包含：content, scope(区域), credibility(高/中/低), source, heat(热度)。
4. **世界摘要(world_digest)**：150-200字，描述本轮世界后台推演（事件推进、流言演变、NPC独立行动、团体变化），**禁止提及{{user}}**。
   - 必须涉及至少一个势力的内部动向或至少一个NPC的非对话独立行动。
5. **声誉(economy/reputation)**：可根据对话内容微调 marketTrend, fundsStatus 等。
6. **世界每时每刻都在变化。如果你认为没有变化，请重新阅读对话。至少找出一件事来更新。**
7. **团体进度**：每个势力必须包含进度描述（纯文字），凝聚力、资源储备需定期波动。
8. **timeEstimateMinutes**：必填。根据对话内容估算实际经过的世界时间，单位分钟。闲聊1-5分钟，普通场景5-30分钟，跨越时间场景按实际估算（如"三天后"填4320）。最少1分钟，最多10080分钟（7天）。

9. **血仇备忘录（bloodFeudMemo）**：当剧情中产生了不可化解的血仇（如核心人物被杀、至亲被害），必须在此数组中添加条目。格式：[{ faction, reason, status, lastActionRound, nextAttackRound }]。status 初始为"追踪中"。已有条目可更新状态（如"追杀中"、"已终结"）。该数组由模型维护。
10. **势力关系（factionRelations）**：可选但推荐。当势力之间的关系发生变化时，输出此数组。每条格式：{ factionA, factionB, relation, level, trend }。relation 只能用：血盟/盟友/友好/中立/冷淡/紧张/敌对/世仇。无变化可不输出。
11. **因果链（causalChain）**：可选。当本轮发生了清晰的因果关系（事件A导致事件B，或玩家行为导致势力变化等）时输出。每条格式：{ event, progress, manifestation }。无强因果关系可不输出。
12. **一致性约束**：新生成的事件不可删除已有事件（除非已锁定）。新势力不应与旧势力内容冲突。

13. **NPC独立行动（npcActivities）**：可选数组。如果对话中涉及了重要NPC，或emotionMap中有活跃NPC，请为每个NPC生成本轮的独立行动（不在玩家面前的离线行为）。每条格式：{ npc, activity, location, type(work/scheming/travel/rest/social) }。这些行动让世界不在场时也保持活力。非活跃轮次可不输出。

14. **剧情线索（plotThreads）**：可选数组。每个世界有若干条并行的剧情线索在推进。每条格式：{ id, title, progress(0-100), phase, description, status(active/frozen/completed/failed) }。已存在的线索应按轮次推进进度；已完结的线索应标记completed或failed。
15. **成就检测（achievements）**：可选数组。如果本轮对话中发生了值得记录的特殊成就（如第一次杀人、经典台词等），请在此输出。每条格式：{ id, title, desc, icon, note }。预设成就ID从列表中选用；不在列表中的用auto_前缀。无特别事件可不输出。
16. **角色画像（characterPortraits）**：可选数组。如果本轮对话涉及了已有画像的角色，或出现了新的重要角色，请更新画像。每条格式：{ name, personalityTags:[{tag,evidence}], relationships:[{targetName,relation,attitude}], keyEvent:{event,type}, stats:{kills,injuries,goldEarned}, digestFragment:"摘要片段" }。只输出新增标签。
17. **战斗日志（combatLog）**：可选数组。如果本轮对话包含战斗场景，请输出结构化战斗日志。每条格式：{ type, participants:[], outcome, kills, injuries:[], description, weapon, damageDealt, damageTaken, isBossFight, bossName, techniques:[], style, turnCount }。伤害：轻伤1-15，中等15-40，重创40-80。日常不要输出。
`;

    // 重试提示
    const retryHint = retryCount > 0
      ? `\n\n**注意：上次返回的更新过于空洞或无变化，请重新分析对话！本轮必须输出有实质内容的更新！**`
      : '';

    // 世界法则约束
    var wlConstraints = '';
    if (state && state.worldLaws) {
      var wl = state.worldLaws;
      wlConstraints = '\n## 世界法则约束\n';
      wlConstraints += '此世界框架：' + (wl.frameworkName || '自定义') + '\n';
      Object.keys(wl.dimensions || {}).forEach(function(k) {
        wlConstraints += '- ' + wl.dimensions[k].label + '：' + wl.dimensions[k].value + '\n';
      });
      (wl.customRules || []).forEach(function(r) { if (r) wlConstraints += '- [自定义规则] ' + r + '\n'; });
      (wl.derivedConstraints || []).forEach(function(c) { if (c) wlConstraints += '- [约束] ' + c + '\n'; });
      wlConstraints += '以上规则必须遵守，违反世界法则的推演无效。\n';
    }

    const prompt = `你是一个世界演化引擎。每轮对话后，世界必须向前推进一步。
**严格按以下规则更新世界状态，只输出 JSON，不要有其他文字。**

## 因果链分析
阅读本轮对话，先回答一个问题：本轮对话中用户或AI的什么言行可能对世界产生了影响？
推理过程（不超过50字）：[这里写你的推理，但不输出到 JSON 中]

## 基于以上推理，按以下规则更新世界：

${engineRules}
${wlConstraints}
${storyDirectionSection}
${worldbookSection}

## 已锁定元素（不可删除/回退）
${JSON.stringify({ lockedEvents, lockedFactions }, null, 2)}

## 当前世界状态（第${state.round}轮）
${JSON.stringify({
  round: state.round,
  events: state.events.map(e => ({ name: e.name, stage: e.stage, currentRound: e.currentRound, totalRounds: e.totalRounds })),
  factions: state.factions.map(f => ({ name: f.name, cohesion: f.cohesion, resources: f.resources })),
  rumors: state.rumors.slice(0,3),
  reputation: state.reputation,
  economy: state.economy,
  bloodFeudMemo: state.bloodFeudMemo,
  factionRelations: state.factionRelations,
  causalChain: state.causalChain,
  activeNpcs: state.npcSchedules ? Object.keys(state.npcSchedules).slice(0,10) : [],
  activePlotThreads: state.plotThreads ? state.plotThreads.filter(t => t.status === 'active' || t.status === 'frozen').map(t => ({ id: t.id, title: t.title, progress: t.progress, status: t.status })) : []
}, null, 2)}

## 本轮对话
用户：${userMsg.substring(0, 500)}
AI：${aiMsg.substring(0, 500)}
${retryHint}
## 输出 JSON 格式示例
{
  "events": [
    { "name": "血刀门寻仇", "level": 2, "stage": "发酵", "currentRound": 2, "totalRounds": 4, "desc": "血刀门派出了追踪者", "trigger": "{{user}}杀了血刀门弟子" }
  ],
  "factions": [
    { "name": "血刀门", "cohesion": "团结", "resources": "充足", "currentGoal": "复仇", "attentionToUser": "排斥" }
  ],
  "rumors": [
    { "content": "有人在青石关见到官兵设卡", "scope": "青石关", "credibility": "高", "source": "目击商贩", "heat": "中" }
  ],
  "economy": { "marketTrend": "平稳", "fundsStatus": "手头紧" },
  "reputation": { "jianghu": "默默无闻", "official": "默默无闻", "folk": "默默无闻", "underworld": "默默无闻" },
  "world_digest": "血刀门复仇事件持续推进，已进入发酵阶段；青石关附近出现官兵设卡传闻，商旅开始绕路；城中帮派内部分歧加剧。",
  "causalChain": [
    { "event": "血刀门复仇", "progress": "悬赏令导致江湖人士开始注意{{user}}", "manifestation": "客栈老板看{{user}}的眼神变得异样" }
  ],
  "timeEstimateMinutes": 15,
  "factionRelations": [
    { "factionA": "血刀门", "factionB": "天机阁", "relation": "敌对", "level": 2, "trend": "恶化" }
  ],
  "bloodFeudMemo": [
    { "faction": "血刀门", "reason": "{{user}}杀了血刀门少主", "status": "追杀中", "lastActionRound": 2, "nextAttackRound": 7 }
  ],
  "npcActivities": [
    { "npc": "张铁匠", "activity": "在铁匠铺给血刀门弟子修刀", "location": "铁匠铺", "type": "work" },
    { "npc": "血刀门主", "activity": "在密室召集四大护法密议", "location": "血刀门密室", "type": "scheming" }
  ],
  "plotThreads": [
    { "id": "pt_001", "title": "血刀门复仇", "progress": 40, "phase": "追踪者已出动", "description": "血刀门因少主被杀而持续追杀玩家", "status": "active" },
    { "id": "pt_002", "title": "青石关商路危机", "progress": 100, "phase": "已解决", "description": "青石关的商路劫掠问题已平息", "status": "completed" }
  ],
  "achievements": [
    { "id": "first_kill", "title": "染血之手", "desc": "第一次夺走生命", "icon": "🔧", "note": "杀死了血刀门弟子" }
  ],
  "characterPortraits": [
    { "name": "张铁匠", "personalityTags": [{"tag": "重义气", "evidence": "为血刀门弟子修刀以示支持"}], "stats": { "kills": 0, "injuries": 0 } }
  ],
  "combatLog": [
    { "type": "pve", "participants": ["玩家", "血刀门弟子"], "outcome": "win", "kills": 1, "injuries": ["轻伤"], "description": "与血刀门弟子交手", "weapon": "青锋剑", "damageDealt": 30, "damageTaken": 5, "isBossFight": false, "techniques": ["破绽一击"], "style": "近战/剑术", "turnCount": 3 }
  ]
}

注意：宁可生成合理的变化，也不要返回空数组。如果你觉得"没有变化"，请重新分析对话。`;

    try {
      const rawResult = await callApi(prompt, 2000, 0.7);
      let content = rawResult.trim();
      content = content.replace(/```json/g, '').replace(/```/g, '').trim();

      let update = null;
      try {
        update = JSON.parse(content);
      } catch(e) {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          try { update = JSON.parse(match[0]); } catch(e2) {}
        }
      }
      if (!update) update = {};

      // 字段名容错
      if (update.event && !update.events) update.events = [update.event];
      if (update.faction && !update.factions) update.factions = [update.faction];
      if (update.rumor && !update.rumors) update.rumors = [update.rumor];

      // 确保数组存在
      update.events = update.events || [];
      update.factions = update.factions || [];
      update.rumors = update.rumors || [];
      update.economy = update.economy || {};
      update.reputation = update.reputation || {};
      update.world_digest = update.world_digest || state.worldDigest;
      update.causalChain = update.causalChain || [];
      update.factionRelations = update.factionRelations || [];
      update.bloodFeudMemo = update.bloodFeudMemo || [];

      // v2.4.0：验证更新（严格模式检查）
      const settings = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
      const strictMode = settings.strictEvolution !== false;
      const validation = validateEvolution(update, state, strictMode);
      if (validation.warnings.length > 0) {
        console.warn('[World Engine Evolution] 演化验证:', validation.warnings.join('; '));
      }
      update = validation.fixedUpdate;

      // 如果无效且未重试过，重试一次（temperature 提高）
      if (!validation.valid && retryCount < 1) {
        console.warn('[World Engine Evolution] 演化验证失败，尝试重试...');
        return await callEvolutionAPI(state, userMsg, aiMsg, retryCount + 1);
      }

      // v2.4.0：全空时补一条默认（仅在严格模式关闭或重试后仍空时）
      if (update.rumors.length === 0 && update.events.length === 0 && update.factions.length === 0 && update.world_digest === state.worldDigest) {
        update.world_digest = `世界表面平静，但暗流涌动：${state.worldDigest}（细微变化持续发生）`;
        update.rumors.push({
          content: '市井间有细微传闻在流传，但还未形成明确说法',
          scope: '全域',
          credibility: '低',
          source: '街谈巷议',
          heat: '冷'
        });
      }

      // 应用更新
      for (const ev of update.events) core.addEvent(state, ev);
      for (const fac of update.factions) core.addFaction(state, fac);
      for (const rum of update.rumors) core.addRumor(state, rum);
      if (Object.keys(update.economy).length) Object.assign(state.economy, update.economy);
      if (Object.keys(update.reputation).length) Object.assign(state.reputation, update.reputation);
      if (update.world_digest) state.worldDigest = update.world_digest;

      // 因果链：去重合并
      if (update.causalChain.length) {
        for (const cc of update.causalChain) {
          const existingIdx = state.causalChain.findIndex(ex => ex.event === cc.event);
          if (existingIdx !== -1) {
            state.causalChain[existingIdx] = cc;
          } else {
            state.causalChain.unshift(cc);
          }
        }
        if (state.causalChain.length > 20) state.causalChain.pop();
      }

      // 势力关系：去重合并
      if (update.factionRelations.length) {
        for (const fr of update.factionRelations) {
          const existingIdx = state.factionRelations.findIndex(ex =>
            (ex.factionA === fr.factionA && ex.factionB === fr.factionB) ||
            (ex.factionA === fr.factionB && ex.factionB === fr.factionA)
          );
          if (existingIdx !== -1) {
            state.factionRelations[existingIdx] = fr;
          } else {
            state.factionRelations.unshift(fr);
          }
        }
        if (state.factionRelations.length > 30) state.factionRelations.pop();
      }

      // 血仇备忘录：合并
      if (update.bloodFeudMemo.length) {
        for (const bf of update.bloodFeudMemo) {
          const existingIdx = state.bloodFeudMemo.findIndex(ex => ex.faction === bf.faction);
          if (existingIdx !== -1) {
            state.bloodFeudMemo[existingIdx] = { ...state.bloodFeudMemo[existingIdx], ...bf };
          } else {
            state.bloodFeudMemo.unshift(bf);
          }
        }
        // 保留已终结条目一段时间以便追溯
        state.bloodFeudMemo = state.bloodFeudMemo.filter(bf => {
          if (bf.status === '已终结') {
            return (state.round - (bf.lastActionRound || 0)) < 20;
          }
          return true;
        });
        if (state.bloodFeudMemo.length > 15) state.bloodFeudMemo.pop();
      }

      // v2.6.0：NPC 独立行动处理
      if (update.npcActivities && update.npcActivities.length) {
        for (const act of update.npcActivities) {
          if (act.npc && act.activity) {
            core.addNpcActivity(state, act.npc, act.activity, act.location, act.type);
            // 同步更新 NPC 日程中的作业和个性（AI可能补充）
            if (act.type === 'work' || act.occupation) {
              core.updateNpcSchedule(state, act.npc, {
                occupation: act.occupation || undefined,
                lastKnownLocation: act.location,
                lastKnownActivity: act.activity
              });
            }
          }
        }
      }

      // v2.6.0：剧情线索处理
      if (update.plotThreads && update.plotThreads.length) {
        for (const pt of update.plotThreads) {
          if (pt.id && pt.title) {
            // 如果是现有线索，更新进度
            var existingThread = state.plotThreads.find(function(t) { return t.id === pt.id; });
            if (existingThread) {
              core.updatePlotThreadProgress(state, pt.id, pt.progress, pt.phase);
              if (pt.status === 'completed' || pt.status === 'failed') {
                core.completePlotThread(state, pt.id, pt.status);
              }
            } else {
              // 新线索
              core.addPlotThread(state, {
                id: pt.id,
                title: pt.title,
                type: 'custom',
                status: pt.status || 'active',
                progress: pt.progress || 0,
                phase: pt.phase || '',
                description: pt.description || '',
                participants: pt.participants || [],
                relatedFactions: pt.relatedFactions || [],
                connectedEventNames: pt.connectedEventNames || [],
                milestones: pt.milestones || []
              });
            }
          }
        }
      }

      // v2.6.0：自动创建剧情线索——血仇同步
      if (state.bloodFeudMemo && state.bloodFeudMemo.length) {
        for (const bf of state.bloodFeudMemo) {
          if (bf.status !== '已终结' && bf.status !== '追踪中') continue;
          var hasThread = state.plotThreads && state.plotThreads.some(function(t) {
            return t.type === 'bloodfeud' && t.title && t.title.indexOf(bf.faction) !== -1;
          });
          if (!hasThread) {
            core.addPlotThread(state, {
              id: core.generateThreadId(),
              title: bf.faction + '的复仇',
              type: 'bloodfeud',
              status: 'active',
              progress: 15,
              phase: '仇恨初始',
              description: bf.reason || '血仇已结下，正在酝酿报复',
              participants: ['玩家', bf.faction],
              relatedFactions: [bf.faction],
              connectedEventNames: [],
              milestones: [{ round: state.round, event: '🔪 血仇结下：' + (bf.reason || '未知原因') }]
            });
          }
        }
      }

      // v2.6.0：自动创建剧情线索——新事件同步
      if (state.events && state.events.length) {
        for (const ev of state.events) {
          if (ev.stage === '已爆发' || ev.stage === '余波') continue;
          var hasEventThread = state.plotThreads && state.plotThreads.some(function(t) {
            return t.connectedEventNames && t.connectedEventNames.indexOf(ev.name) !== -1;
          });
          if (!hasEventThread) {
            var remaining = ev.totalRounds - ev.currentRound;
            var initialProgress = Math.floor((1 - remaining / ev.totalRounds) * 40);
            core.addPlotThread(state, {
              id: core.generateThreadId(),
              title: ev.name,
              type: 'event',
              status: 'active',
              progress: initialProgress || 10,
              phase: ev.stage,
              description: ev.desc || '事件正在发展中',
              participants: ev.participants || [],
              relatedFactions: ev.relatedFactions || [],
              connectedEventNames: [ev.name],
              milestones: [{ round: state.round, event: '📜 事件开始：' + (ev.desc || ev.name) }]
            });
          }
        }
      }

      // v2.8.0: 角色画像解析
      if (update.characterPortraits && update.characterPortraits.length) {
        for (var ci = 0; ci < update.characterPortraits.length; ci++) {
          var cp = update.characterPortraits[ci];
          if (!cp || !cp.name) continue;
          core.ensureCharacterPortrait(state, cp.name);
          if (cp.personalityTags && cp.personalityTags.length) {
            for (var pti = 0; pti < cp.personalityTags.length; pti++) {
              core.updatePersonalityTag(state, cp.name, cp.personalityTags[pti].tag, cp.personalityTags[pti].evidence || '');
            }
          }
          if (cp.relationships && cp.relationships.length) {
            for (var rli = 0; rli < cp.relationships.length; rli++) {
              var rl = cp.relationships[rli];
              core.updateRelationship(state, cp.name, rl.targetName, rl.relation, rl.attitude);
            }
          }
          if (cp.keyEvent && cp.keyEvent.event) {
            core.addKeyEventToPortrait(state, cp.name, cp.keyEvent.event, cp.keyEvent.type || 'general');
            core.addMemory(state, { id:'portrait_'+Date.now()+'_'+cp.name, type:'round', summary:'📝 '+cp.name+'的画像更新：'+cp.keyEvent.event, importance:3, round:state.round });
          }
          if (cp.stats) {
            core.updatePortraitStats(state, cp.name, cp.stats);
          }
        }
      }
      // v2.8.0: 战斗日志解析
      if (update.combatLog && update.combatLog.length) {
        for (var cli = 0; cli < update.combatLog.length; cli++) {
          core.addCombatLog(state, update.combatLog[cli]);
        }
      }
      // v2.3.0：保存本次演化原始结果（含 timeEstimateMinutes）
      if (window.WORLD_ENGINE_STORAGE && typeof window.WORLD_ENGINE_STORAGE.appendEvolutionLog === 'function') {
        window.WORLD_ENGINE_STORAGE.appendEvolutionLog(state, {
          type: 'evolution',
          round: state.round,
          userMessage: userMsg,
          assistantMessage: aiMsg,
          rawResult: rawResult,
          parsedUpdate: update,
          validationWarnings: validation.warnings || []
        });
      }

      state.lastEvolveResult = update;
      core.saveState(state);
      return true;
    } catch(e) {
      console.error('演化API调用失败', e);
      return false;
    }
  }

  // ========== 流言老化与异变 ==========
  function decayRumors(state) {
    if (!state.rumors || state.rumors.length === 0) return;
    const now = state.round;
    const toRemove = [];
    const toMutate = [];
    for (let i = 0; i < state.rumors.length; i++) {
      const rumor = state.rumors[i];
      const age = now - (rumor.addedRound || now);
      const heatMap = { '冷': 0, '低': 1, '中': 2, '高': 3, '热': 4 };
      let heatVal = heatMap[rumor.heatLevel] || 2;
      let decay = 0.2 + age * 0.05;
      heatVal = Math.max(0, heatVal - decay);
      let newHeatLevel = '冷';
      if (heatVal >= 3) newHeatLevel = '热';
      else if (heatVal >= 2) newHeatLevel = '中';
      else if (heatVal >= 1) newHeatLevel = '低';
      else newHeatLevel = '冷';
      rumor.heatLevel = newHeatLevel;
      rumor.heat = newHeatLevel;

      const credibilityMap = { '高': 3, '中': 2, '低': 1 };
      let credVal = credibilityMap[rumor.credibility] || 2;
      credVal = Math.max(1, credVal - age * 0.1);
      if (credVal <= 1) rumor.credibility = '低';
      else if (credVal <= 2) rumor.credibility = '中';
      else rumor.credibility = '高';

      // 热度为冷且年龄超过 5 轮 → 移除
      if (newHeatLevel === '冷' && age >= 5) {
        toRemove.push(i);
      }
      // 热度为热且年龄超过 8 轮且随机命中 → 异变（旧流言异变为新版本）
      if (newHeatLevel === '热' && age >= 8 && Math.random() < 0.15) {
        toMutate.push(i);
      }
    }

    // 移除
    for (let i = toRemove.length - 1; i >= 0; i--) {
      state.rumors.splice(toRemove[i], 1);
    }

    // 异变
    for (const idx of toMutate) {
      const oldRumor = state.rumors[idx];
      const mutated = {
        content: `传闻有变：${oldRumor.content.substring(0, 20)}...（细节已经演化得面目全非）`,
        scope: oldRumor.scope,
        credibility: '低',
        source: '市井变异',
        heat: '冷',
        heatLevel: '冷',
        addedRound: now
      };
      state.rumors.push(mutated);
    }

    if (toRemove.length || toMutate.length) {
      core.saveState(state);
      console.log(`[World Engine Evolution] 流言老化：移除 ${toRemove.length} 条，异变 ${toMutate.length} 条，剩余 ${state.rumors.length} 条`);
    }
  }

  // ========== 统一演化入口 ==========
  async function evolve(state, userMsg, aiMsg) {
    const backup = JSON.parse(JSON.stringify(state));
    // ★ v2.5.1: 推演前保存状态快照（用于消息回退时还原）
    if (core.saveSavepoint) core.saveSavepoint(state);
    // 注意：forceTriggerEvents / advanceBloodFeud 已在每次 onMessageReceived 中调用
    // 此处不再重复，避免事件进度双倍增长（Bugfix v2.4.2）

    const apiSuccess = await callEvolutionAPI(state, userMsg, aiMsg);

    if (apiSuccess) {
      state.round++;
      state.lastEvolveRound = state.round;
      decayRumors(state);
      // ★ v3.0.0: 情感状态机 — 每轮衰减
      evolveEmotionStateMachine(state);
      // ★ v3.0.0: 生命周期演化（放在情感处理之后）
      evolveLifecycles(state);
      core.saveState(state);

      // v2.6.0: 推进故事阶段
      if (core && typeof core.advanceStoryPhase === 'function') {
        core.advanceStoryPhase(state);
      }

      // 每 20 轮清理一次记忆库
      if (state.round % 20 === 0) {
        core.cleanupState(state);
      }
      return true;
    } else {
      Object.assign(state, backup);
      core.saveState(state);
      console.warn('[World Engine Evolution] 演化失败，状态已回滚');
      return false;
    }
  }

// ★ v3.0.0: 情感状态机集成
function evolveEmotionStateMachine(worldState) {
  if (!worldState || !worldState.emotionMap) return;
  // 每轮衰减
  if (typeof core.decayEmotionStates === 'function') {
    core.decayEmotionStates(worldState.emotionMap, worldState.round || 0);
  }
}

// ★ v3.0.0: 根据事件触发情感状态转换
function applyEventEmotion(worldState, eventType, entity) {
  if (!worldState || !worldState.emotionMap || !entity) return;
  if (typeof core.applyEmotionState === 'function') {
    core.applyEmotionState(worldState.emotionMap, entity, eventType);
    // 日志记录
    if (!worldState.eventLog) worldState.eventLog = [];
    worldState.eventLog.push({
      type: 'emotion',
      timestamp: Date.now(),
      round: worldState.round || 0,
      event: '情感变化: ' + entity + ' → ' + eventType,
      entities: [entity]
    });
  }
}

// ★ v3.0.0: 生命周期演化
function evolveLifecycles(worldState) {
  if (!worldState || !worldState.characterLifecycles) return;

  var deaths = [];
  for (var name in worldState.characterLifecycles) {
    var lc = worldState.characterLifecycles[name];
    var roundsSinceChange = (worldState.round || 0) - (lc.lastStateChange || 0);

    // DYING → 过 3 轮随机死亡
    if (lc.state === 'DYING' && roundsSinceChange >= 3) {
      if (Math.random() < 0.4) {
        deaths.push(name);
      }
    }
    // DEAD → 过 10 轮可尝试转生
    if (lc.state === 'DEAD' && roundsSinceChange >= 10 && Math.random() < 0.1) {
      if (typeof core.applyLifecycleTransition === 'function') {
        core.applyLifecycleTransition(worldState, name, 'REBORN');
      }
    }
    // DORMANT → 过 5 轮可回归
    if (lc.state === 'DORMANT' && roundsSinceChange >= 5 && Math.random() < 0.3) {
      if (typeof core.applyLifecycleTransition === 'function') {
        core.applyLifecycleTransition(worldState, name, 'ALIVE');
      }
    }
  }

  // 批量执行死亡
  for (var di = 0; di < deaths.length; di++) {
    if (typeof core.applyLifecycleTransition === 'function') {
      core.applyLifecycleTransition(worldState, deaths[di], 'DEAD');
    }
  }
}

// ★ v3.0.0: 根据事件触发生命周期变化
function applyLifecycleEvent(worldState, eventType, entity) {
  if (!worldState || !entity) return;
  // 初始化生命周期（如果还没有）
  if (typeof core.initCharacterLifecycle === 'function') {
    core.initCharacterLifecycle(worldState, entity);
  }
  // 战斗失败 → 濒死
  if (eventType === 'combat_lose' || eventType === 'fatally_wounded') {
    if (typeof core.applyLifecycleTransition === 'function') {
      core.applyLifecycleTransition(worldState, entity, 'DYING');
    }
  }
  // 被背叛 → 休眠
  if (eventType === 'betrayed') {
    if (typeof core.applyLifecycleTransition === 'function') {
      core.applyLifecycleTransition(worldState, entity, 'DORMANT');
    }
  }
  // 救治/援助 → 从濒死恢复
  if (eventType === 'healed' || eventType === 'rescued') {
    if (typeof core.applyLifecycleTransition === 'function') {
      core.applyLifecycleTransition(worldState, entity, 'ALIVE');
    }
  }
}

  return { forceTriggerEvents, advanceBloodFeud, evolve, callApi, decayRumors, validateEvolution, evolveEmotionStateMachine, applyEventEmotion, evolveLifecycles, applyLifecycleEvent };
})();
