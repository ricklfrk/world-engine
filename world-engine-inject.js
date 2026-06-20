// world-engine-inject.js — 构建注入上下文（记忆+面板状态+世界书[可选]），支持当前地点和活跃实体权重，增加长度限制
// 完整版：包含事件链、势力、流言、血仇、声誉、情感、因果链、势力关系、经济
// v2.4.0：世界书默认不注入主AI，通过 options.includeWorldbook 控制
// v2.5.0：接入预设系统（触发门槛、标签、排除规则、section 开关）
// v2.6.0：新增 NPC 动态 + 剧情线索注入段落
window.WORLD_ENGINE_INJECT = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const memory = window.WORLD_ENGINE_MEMORY;
  const tagsGen = window.WORLD_ENGINE_TAGS;
  const worldbook = window.WORLD_ENGINE_WORLDBOOK;

  // ★ v3.0.0: 智能折叠 — 区块优先级（数字越小越优先保留）
  var BLOCK_PRIORITY = {
    panel:      1,  // 核心状态摘要
    emotion:    1,  // 情感（简练）
    memory:     2,  // 相关记忆
    npc:        2,  // NPC 动态
    plotThread: 2,  // 剧情线索
    portrait:   3,  // 角色画像（长篇）
    combat:     3,  // 战斗统计
    worldbook:  3,  // 世界书条目（篇幅不定）
  };

  // Token 预算（硬上限 4000 字符 + 软预算 3000 字符）
  var TOKEN_BUDGET_HARD = 4000;
  var TOKEN_BUDGET_SOFT = 3000;

  // ★ v3.0.0: Token 动态预算
  function estimateTokens(text) {
    // 简单估算：汉字约 1.5 字符/token，英文约 4 字符/token
    if (!text) return 0;
    var chineseChars = 0;
    var otherChars = 0;
    for (var ti = 0; ti < text.length; ti++) {
      var code = text.charCodeAt(ti);
      if (code > 0x4E00 && code < 0x9FFF) chineseChars++;
      else otherChars++;
    }
    return Math.round(chineseChars / 1.5 + otherChars / 4);
  }

  function getDynamicBudget() {
    var base = TOKEN_BUDGET_HARD;
    // 尝试获取 ST 的 token 计数
    try {
      if (typeof getTokenCount === 'function') {
        var used = getTokenCount();
        var max = 4096; // 默认最大上下文
        try {
          // 尝试从 ST 获取最大上下文
          var maxCtx = getContext().maxContextLength || power_user.max_context || 4096;
          if (typeof maxCtx === 'number' && maxCtx > 0) max = maxCtx;
        } catch(e) {}
        var remaining = max - used - 200; // 留 200 token 余量
        if (remaining < 500) return 500;  // 至少 500 token
        if (remaining < base) return remaining;
      }
    } catch(e) {}
    return base;
  }

  function renderCustomTemplate(template, values) {
    var raw = String(template || '').trim();
    if (!raw) return '';
    return raw.replace(/\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g, function(match, key) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
      return values[key] == null ? '' : String(values[key]);
    }).trim();
  }

  async function buildContext(chatHistory, worldState, tags, options = {}) {
    // ★ v2.5.0: 加载预设
    const presets = window.WORLD_ENGINE_PRESETS;
    const preset = presets ? presets.getActivePreset() : null;

    // ───── 触发门槛检查（P1） ─────
    if (preset) {
      if (preset.minRoundCount > 0 && worldState.round < preset.minRoundCount) return '';
      if (preset.skipEmptyState && presets.isWorldStateEmpty(worldState)) return '';
      if (preset.minChatLength > 0) {
        var totalLen = 0;
        if (chatHistory && chatHistory.length) {
          for (var ci = 0; ci < chatHistory.length; ci++) {
            var msg = chatHistory[ci];
            if (msg && msg.mes) totalLen += msg.mes.length;
            if (totalLen > preset.minChatLength) break;
          }
        }
        if (totalLen < preset.minChatLength) return '';
      }
    }

    // 预设的 sections 覆盖 options（worldbook 同时受两者控制）
    var includeWorldbook = options.includeWorldbook === true;
    if (preset && !preset.sections.worldbook) includeWorldbook = false;

    // 提取当前地点（从标签中获取第一个location类型）
    const currentLocation = tags.find(t => t.startsWith('location:'))?.split(':')[1] || null;
    // 提取活跃实体
    const activeEntities = tags.filter(t => worldState.emotionMap[t] !== undefined);
    
    // 使用预设的限制值
    var maxMemories = preset ? preset.maxMemories : 10;
    var maxRumors = preset ? preset.maxRumors : 3;
    var maxEmotions = preset ? preset.maxEmotions : 5;
    var showEmpty = preset ? preset.showEmptySections : true;
    var lbl = preset ? preset.labels : null;

    try {
    const recalled = memory.recallMemories(worldState, tags, maxMemories, currentLocation);
    const worldbookTexts = includeWorldbook ? worldbook.matchEntries(tags, 5) : [];

    // ───── 记忆部分 ─────
    const memoryEnabled = !preset || preset.sections.memory;
    let memoryText = '';
    if (memoryEnabled) {
      if (recalled.length) {
        memoryText = recalled.map(m => {
          const star = '★'.repeat(Math.min(3, m.importance));
          let line = `[${star}] ${m.summary}（第${m.round}轮）`;
          if (m.tags.entities?.length) line += ` 涉及：${m.tags.entities.join(',')}`;
          if (m.emotion && Object.keys(m.emotion).length) line += ` 情感：${JSON.stringify(m.emotion)}`;
          return line;
        }).join('\n');
      } else {
        memoryText = lbl ? lbl.emptyMemory : '无相关记忆';
      }
    }

    // ───── 面板部分 ─────
    // 各数据块标签（由预设控制）
    var eventsLabel = lbl ? lbl.eventsLabel : '事件链';
    var factionsLabel = lbl ? lbl.factionsLabel : '势力';
    var relationsLabel = lbl ? lbl.factionRelationsLabel : '势力关系';
    var rumorsLabel = lbl ? lbl.rumorsLabel : '流言';
    var bloodLabel = lbl ? lbl.bloodFeudLabel : '血仇';
    var causalLabel = lbl ? lbl.causalChainLabel : '因果链';
    var economyLabel = lbl ? lbl.economyLabel : '经济';
    var repLabel = lbl ? lbl.reputationLabel : '声誉';
    var emotionLabel = lbl ? lbl.emotionLabel : '关键情感';
    var emptyEvents = lbl ? lbl.emptyEvents : '无';

    const eventsText = worldState.events.map(e => {
      const remaining = e.totalRounds - e.currentRound;
      let status = '';
      if (remaining <= 0) status = '🔥 立即爆发';
      else if (remaining === 1) status = '⚠️ 剩余1轮，即将爆发';
      else status = `剩余${remaining}轮`;
      return `${e.name}(Lv.${e.level}) ${e.stage} ${status}`;
    }).join('；') || emptyEvents;
    
    const factionsText = worldState.factions.map(f => `${f.name}(凝聚力:${f.cohesion})`).join('；') || emptyEvents;
    const rumorsText = worldState.rumors.slice(0, maxRumors).map(r => r.content).join('；') || emptyEvents;
    
    // 血仇详情（强化）
    let bloodText = emptyEvents;
    if (worldState.bloodFeudMemo && worldState.bloodFeudMemo.length) {
      bloodText = worldState.bloodFeudMemo.map(b => 
        `${b.faction}（${b.status}，原因：${b.reason}，下次攻击约${b.nextAttackRound || '?'}轮后）`
      ).join('；');
    }
    
    // 声誉
    const rep = worldState.reputation;
    const repText = `江湖:${rep.jianghu} 官府:${rep.official} 民间:${rep.folk} 黑道:${rep.underworld}`;
    
    // 情感（按预设限制）
    const emotionEnabled = !preset || preset.sections.emotion;
    let emotionText = '';
    if (emotionEnabled) {
      emotionText = Object.entries(worldState.emotionMap).slice(0, maxEmotions).map(([n, e]) => `${n}:${e.attitude}(${e.level})`).join(', ') || emptyEvents;
    }
    
    // 因果链
    const causalEnabled = !preset || preset.sections.causalChain;
    let causalText = emptyEvents;
    if (causalEnabled && worldState.causalChain && worldState.causalChain.length) {
      causalText = worldState.causalChain.map(c => 
        `${c.event}：${c.progress} → ${c.manifestation || '无具体表现'}`
      ).join('；');
    }
    
    // 势力关系
    const relEnabled = !preset || preset.sections.factionRelations;
    let relationText = emptyEvents;
    if (relEnabled && worldState.factionRelations && worldState.factionRelations.length) {
      relationText = worldState.factionRelations.map(r => 
        `${r.factionA} ↔ ${r.factionB}：${r.relation}（趋势：${r.trend || '稳定'}）`
      ).join('；');
    }
    
    // 经济与物资
    const economyEnabled = !preset || preset.sections.economy;
    let economyText = '';
    if (economyEnabled) {
      const econ = worldState.economy || {};
      const hasEconData = (econ.marketTrend && econ.marketTrend !== '平稳') ||
                          (econ.fundsStatus && econ.fundsStatus !== '手头紧') ||
                          (econ.keyResources && econ.keyResources.length > 0);
      if (hasEconData || showEmpty) {
        economyText = `市场趋势：${econ.marketTrend || '平稳'}，资金状况：${econ.fundsStatus || '手头紧'}，关键资源：${(econ.keyResources || []).join('、') || '无'}`;
      }
    }

    // 组装 panel 文本（使用预设标签）
    var panelTitle = lbl ? lbl.panelTitle : '【世界状态摘要】';
    var roundLabel = lbl ? lbl.roundLabel : '轮次';
    var worldDigestLabel = lbl ? lbl.worldDigestLabel : '世界大势';

    var panelLines = [];
    if (panelTitle) panelLines.push(panelTitle);
    panelLines.push(`${roundLabel}：${worldState.round}`);
    panelLines.push(`${worldDigestLabel}：${worldState.worldDigest}`);
    if (worldState.events && worldState.events.length > 0 || showEmpty) {
      panelLines.push(`${eventsLabel}：${eventsText}`);
    }
    if (worldState.factions && worldState.factions.length > 0 || showEmpty) {
      panelLines.push(`${factionsLabel}：${factionsText}`);
    }
    if (relEnabled && (worldState.factionRelations && worldState.factionRelations.length > 0 || showEmpty)) {
      panelLines.push(`${relationsLabel}：${relationText}`);
    }
    if (worldState.rumors && worldState.rumors.length > 0 || showEmpty) {
      panelLines.push(`${rumorsLabel}：${rumorsText}`);
    }
    if (worldState.bloodFeudMemo && worldState.bloodFeudMemo.length > 0 || showEmpty) {
      panelLines.push(`${bloodLabel}：${bloodText}`);
    }
    if (causalEnabled && (worldState.causalChain && worldState.causalChain.length > 0 || showEmpty)) {
      panelLines.push(`${causalLabel}：${causalText}`);
    }
    if (economyEnabled && showEmpty) {
      panelLines.push(`${economyLabel}：${economyText}`);
    } else if (economyEnabled && economyText) {
      panelLines.push(`${economyLabel}：${economyText}`);
    }
    panelLines.push(`${repLabel}：${repText}`);
    if (emotionEnabled && showEmpty) {
      panelLines.push(`${emotionLabel}：${emotionText}`);
    } else if (emotionEnabled && emotionText && emotionText !== emptyEvents) {
      panelLines.push(`${emotionLabel}：${emotionText}`);
    }

    // ───── v2.6.0：NPC 动态文本 ─────
    var npcActivityEnabled = !preset || preset.sections.npcActivity !== false;
    var npcActivityText = '';
    if (npcActivityEnabled && worldState.npcActivityLog && worldState.npcActivityLog.length) {
      var recentNpcActs = [];
      for (var ni = 0; ni < worldState.npcActivityLog.length && ni < 3; ni++) {
        var a = worldState.npcActivityLog[ni];
        recentNpcActs.push(a.npc + '：' + a.activity + (a.location && a.location !== '未知' ? '（' + a.location + '）' : ''));
      }
      if (recentNpcActs.length) {
        npcActivityText = recentNpcActs.join('；');
      }
    }

    // ───── v2.6.0：剧情线索文本 ─────
    var plotThreadEnabled = !preset || preset.sections.plotThread !== false;
    var plotThreadText = '';
    if (plotThreadEnabled && worldState.plotThreads && worldState.plotThreads.length) {
      var activeThreads = worldState.plotThreads.filter(function(t) { return t.status === 'active' || t.status === 'frozen'; });
      if (activeThreads.length) {
        plotThreadText = activeThreads.slice(0, 3).map(function(t) {
          var progressStr = '';
          var bars = Math.floor(t.progress / 20);
          for (var bi = 0; bi < 5; bi++) {
            progressStr += bi < bars ? '▓' : '░';
          }
          return t.title + ' (' + t.progress + '% ' + progressStr + ') ' + (t.phase || '');
        }).join('；');
      }
    }

    // ───── v2.8.0：角色画像摘要 ─────
    var portraitEnabled = !preset || preset.sections.portrait !== false;
    var portraitText = '';
    if (portraitEnabled && worldState.characterPortraits) {
      var activeNpcs = [];
      if (worldState.emotionMap) {
        for (var pn in worldState.emotionMap) { if (activeNpcs.length < 3) activeNpcs.push(pn); }
      }
      var portraitParts = [];
      for (var pi2 = 0; pi2 < activeNpcs.length; pi2++) {
        var sum = core.getPortraitSummary ? core.getPortraitSummary(worldState, activeNpcs[pi2]) : '';
        if (sum) portraitParts.push(activeNpcs[pi2] + '：' + sum);
      }
      if (portraitParts.length) portraitText = portraitParts.join('\n');
    }

    // ───── v2.8.0：战斗统计 ─────
    var combatEnabled = !preset || preset.sections.combat !== false;
    var combatText = '';
    if (combatEnabled && worldState.combat && (worldState.combat.totalBattles || 0) > 0 && worldState.combat.totalBattles > 0) {
      var cs = core.getCombatSummary ? core.getCombatSummary(worldState) : '';
      if (cs) combatText = cs;
    }

    const panelText = panelLines.join('\n');

    var memoryTitle = lbl ? lbl.memoryTitle : '【相关记忆】';
    var worldbookTitle = lbl ? lbl.worldbookTitle : '【世界书参考】';

    const worldbookSection = includeWorldbook && worldbookTexts.length ?
      (worldbookTitle ? worldbookTitle + '\n' : '') + worldbookTexts.map((t,i) => `${i+1}. ${t.substring(0, 300)}`).join('\n') :
      '';

    // 组装最终文本（使用预设的前/后框架）
    var preamble = lbl ? lbl.preamble : '';
    var postscript = lbl ? lbl.postscript : '注意：以上是世界背景和近期记忆，请在剧情中自然地融入，不要生硬复述。';
    var separator = '\n\n';
    if (preset) {
      if (preset.separatorStyle === 'none' || !preset.useSeparators) {
        separator = '\n';
      } else if (preset.separatorStyle === 'thin') {
        separator = '\n\n────\n\n';
      }
    }

    var blocks = [];
    var blockMeta = [];

    function pushBlock(text, key) {
      if (!text || text.trim() === '') return;
      blocks.push(text);
      blockMeta.push({ key: key || 'unknown', charCount: text.length });
    }

    // 状态面板（始终保留）
    var panelStr = '';
    if (!preset || preset.sections.statePanel) {
      panelStr = panelText;
      pushBlock(panelStr, 'panel');
    }

    // NPC 动态
    var npcStr = '';
    if (npcActivityEnabled && npcActivityText) {
      var npcLabelText = (lbl && lbl.npcActivityLabel) ? lbl.npcActivityLabel : '【活跃 NPC 动态】';
      npcStr = npcLabelText + '\n' + npcActivityText;
      pushBlock(npcStr, 'npc');
    }

    // 剧情线索
    var ptStr = '';
    if (plotThreadEnabled && plotThreadText) {
      var ptLabelText = (lbl && lbl.plotThreadLabel) ? lbl.plotThreadLabel : '【进行中的剧情线索】';
      ptStr = ptLabelText + '\n' + plotThreadText;
      pushBlock(ptStr, 'plotThread');
    }

    // 角色画像
    var portStr = '';
    if (portraitEnabled && portraitText) {
      var portraitLabel = (lbl && lbl.portraitLabel) ? lbl.portraitLabel : '【重要角色】';
      portStr = portraitLabel + '\n' + portraitText;
      pushBlock(portStr, 'portrait');
    }

    // 战斗统计
    var combatStr = '';
    if (combatEnabled && combatText) {
      combatStr = '【战斗统计】\n' + combatText;
      pushBlock(combatStr, 'combat');
    }

    // 记忆
    var memStr = '';
    if (memoryEnabled && (recalled.length > 0 || showEmpty)) {
      memStr = memoryTitle + '\n' + memoryText;
      pushBlock(memStr, 'memory');
    }

    // 世界书
    var wbStr = '';
    if (worldbookSection) {
      wbStr = worldbookSection;
      pushBlock(wbStr, 'worldbook');
    }

    // ★ v3.0.0: 智能折叠 — 按优先级裁切
    var finalSeparator = (preset && preset.separatorStyle === 'none') ? '\n' : '\n\n';
    // 先按优先级排序（低优先级在后）
    blockMeta.sort(function(a, b) {
      var pa = BLOCK_PRIORITY[a.key] || 9;
      var pb = BLOCK_PRIORITY[b.key] || 9;
      return pa - pb;
    });

    // 从低优先级开始累积，超出预算就丢弃后面的
    var selectedBlocks = [];
    var totalChars = 0;
    for (var bi = 0; bi < blockMeta.length; bi++) {
      // 找到索引对应在 blocks 中的原始文本
      var meta = blockMeta[bi];
      var blockText = '';
      for (var ci = 0; ci < blocks.length; ci++) {
        // 按 meta 的 key 匹配（简单匹配：根据 key 找对应的 block）
        var cmpKey = blocks[ci] === panelStr ? 'panel' :
                     blocks[ci] === npcStr ? 'npc' :
                     blocks[ci] === ptStr ? 'plotThread' :
                     blocks[ci] === portStr ? 'portrait' :
                     blocks[ci] === combatStr ? 'combat' :
                     blocks[ci] === memStr ? 'memory' :
                     blocks[ci] === wbStr ? 'worldbook' : 'unknown';
        if (cmpKey === meta.key && selectedBlocks.indexOf(blocks[ci]) === -1) {
          blockText = blocks[ci];
          break;
        }
      }
      if (!blockText) continue;
      var nextTotal = totalChars + (totalChars > 0 ? finalSeparator.length : 0) + blockText.length;
      var budget = getDynamicBudget();
      if (budget < 2000) console.debug('[World Engine] token预算紧张:', budget);
      if (nextTotal > budget) {
        // 预算不足，跳过此块及后续所有低优先级块
        continue;
      }
      selectedBlocks.push(blockText);
      totalChars = nextTotal;
    }

    var finalContext = preamble ? preamble + '\n\n' : '';
    finalContext += selectedBlocks.join(finalSeparator);
    finalContext += '\n\n' + postscript;
    finalContext = finalContext.trim();

    // ★ v2.5.0: 排除规则清洗（P0）
    if (preset && presets && preset.excludeRanges && preset.excludeRanges.length) {
      finalContext = presets.cleanContext(finalContext, preset.excludeRanges);
    }

    // ★ v3.0.0: 成就回响注入
    var echoes = core && typeof core.getAchievementEchoes === 'function' ? core.getAchievementEchoes(worldState, 3) : [];
    if (echoes.length > 0) {
      var echoText = '【成就回响】\n';
      for (var ei = 0; ei < echoes.length; ei++) {
        echoText += '• ' + echoes[ei].name + '\n';
      }
      finalContext = echoText + '\n' + finalContext;
    }

    if (worldState.customInjectTemplate && String(worldState.customInjectTemplate).trim()) {
      var customContext = renderCustomTemplate(worldState.customInjectTemplate, {
        era: worldState.era || '',
        time: worldState.timeText || '',
        world: worldState.worldDescription || worldState.worldDigest || '',
        worldDigest: worldState.worldDigest || '',
        description: worldState.worldDescription || '',
        characters: Object.keys(worldState.emotionMap || {}).join(', '),
        memories: memoryText || '',
        events: eventsText || '',
        worldbook: worldbookSection || '',
        panel: panelText || '',
        context: finalContext || '',
        story: worldState.storyTemplate || worldState.storyArc || '',
        tone: worldState.storyTone || worldState.tone || ''
      });
      if (customContext) finalContext = customContext;
    }

    return finalContext;
    } catch (e) {
      console.error('[World Engine] buildContext 模块异常', e);
      return '[World Engine] 世界状态构建异常，已降级';
    }
  }

  return { buildContext };
})();
