// world-engine-memory.js — 记忆提取、存储、三层摘要、召回、情感
// ============================================================
// ★ 修改记录 ★
// 2026-06-05 v2.1.0
//   - 情感系统增强：支持更多情感态度级别（友好→亲切→信任→至交）
//   - 情感变化检测：对比旧态度，记录变化原因
//   - 情感持久化强化：updateEmotion 调用更完整
//   - 记忆详情存储优化：不再截取原文做 summary，使用 AI 摘要
//   - 修复 shouldStore 对中文字数不足的误判
//   - 添加情感变化日志以便追溯
// ============================================================

window.WORLD_ENGINE_MEMORY = (function() {
  const core = window.WORLD_ENGINE_CORE;

  let callApiFn = null;
  function getCallApi() {
    if (!callApiFn && window.WORLD_ENGINE_EVOLUTION && window.WORLD_ENGINE_EVOLUTION.callApi) {
      callApiFn = window.WORLD_ENGINE_EVOLUTION.callApi;
    }
    return callApiFn;
  }

  // ========== 自定义实体 ==========
  function getCustomEntities() {
    const settings = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
    const customEntitiesStr = settings.customEntities || '';
    if (customEntitiesStr) {
      return customEntitiesStr.split(/[,，、]/).map(s => s.trim()).filter(s => s.length >= 2);
    }
    return [];
  }

  function determineLevel(attitude, currentLevel) {
    // 扩展等级体系：更细粒度的情感递进
    const levelHierarchy = ['陌生人', '一面之缘', '旧识', '熟人', '朋友', '挚友', '至交', '生死之交', '家人'];
    const negativeHierarchy = ['陌生人', '可疑对象', '防备', '敌人', '死敌', '不共戴天'];

    if (attitude === '不共戴天') return '死敌';
    if (attitude === '敌意' || attitude === '敌对') return '敌人';
    if (attitude === '警惕') {
      var negIdx = negativeHierarchy.indexOf(currentLevel);
      if (negIdx < 1) return '可疑对象';
      if (negIdx < 3) return negativeHierarchy[Math.min(negIdx + 1, negativeHierarchy.length - 1)];
      return currentLevel;
    }
    if (attitude === '信任') {
      var idx = levelHierarchy.indexOf(currentLevel);
      if (idx < 0) idx = 0;
      // 信任提升2级
      var newIdx = Math.min(idx + 2, levelHierarchy.length - 1);
      return levelHierarchy[newIdx];
    }
    if (attitude === '友善' || attitude === '友好') {
      var idx = levelHierarchy.indexOf(currentLevel);
      if (idx < 0) idx = 0;
      // 友善只提升1级，不再直接跳到"朋友"
      var newIdx = Math.min(idx + 1, levelHierarchy.length - 1);
      return levelHierarchy[newIdx];
    }
    if (attitude === '中立') return currentLevel || '陌生人';

    return currentLevel || '陌生人';
  }

  // ========== 智能摘要 + 标签生成 ==========
  async function generateSmartSummaryWithTags(userMsg, aiMsg, round, locationHint = null) {
    const callApi = getCallApi();
    if (!callApi) {
      console.warn('[World Engine] 无法获取 callApi，智能摘要不可用');
      return null;
    }

    const locationText = locationHint ? `当前地点：${locationHint}\n` : '';
    const prompt = `你是一个客观的剧情记录员和标签提取专家。请根据以下对话，完成两项任务：
1. 用约150字总结本轮剧情（只陈述客观事实，不要评价）。
2. 提取对话中出现的所有重要标签，按类别填写。

轮次：第${round}轮
${locationText}
用户消息：${userMsg.substring(0, 600)}
AI回复：${aiMsg.substring(0, 600)}

请严格按照以下 JSON 格式输出，不要包含其他任何文字：
{
  "summary": "你的总结内容...",
  "tags": {
    "entities": ["实体名1", "实体名2"],
    "locations": ["地点1"],
    "factions": ["势力1"],
    "topics": ["话题1", "话题2"],
    "emotions": ["情绪1"]
  }
}

注意：
- entities：人名、怪物名、特殊物品名等具体个体。
- locations：具体地点（城市、房间、建筑等）。
- factions：帮派、组织、家族等。
- topics：核心事件主题（如"交易"、"追杀"、"结盟"）。
- emotions：本轮的主要氛围（如"紧张"、"友善"、"悲伤"）。
- 每个数组最多填5个最相关的标签，如果没有就留空数组 []。`;

    try {
      const result = await callApi(prompt, 1000, 0.4);
      let content = result.trim();
      content = content.replace(/```json\s*/, '').replace(/```\s*/, '');
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) content = jsonMatch[0];
      const parsed = JSON.parse(content);
      return {
        summary: parsed.summary || "（无摘要）",
        tags: parsed.tags || { entities: [], locations: [], factions: [], topics: [], emotions: [] }
      };
    } catch(e) {
      console.error('[World Engine] 智能摘要+标签提取失败:', e);
      return null;
    }
  }

  // ========== 规则回退：基于实体合成摘要 ==========
  function generateRuleBasedSummary(userMsg, aiMsg, round, tags) {
    const entities = tags.entities?.slice(0, 3) || [];
    const locations = tags.locations?.slice(0, 2) || [];
    const topics = tags.topics?.slice(0, 3) || [];
    const emotions = tags.emotions?.slice(0, 2) || [];

    let summary = `第${round}轮`;
    if (locations.length) summary += `，在${locations.join('、')}`;
    if (entities.length) summary += `，${entities.join('、')}`;
    if (topics.length) summary += ` 涉及 ${topics.join('、')}`;
    if (emotions.length) summary += `，气氛${emotions.join('、')}`;

    const actionMatch = (userMsg + ' ' + aiMsg).match(/(?:[，,。]?\s*)([\u4e00-\u9fa5]{2,10}(?:了|着|到|给|向)[\u4e00-\u9fa5]{2,20})/);
    if (actionMatch && actionMatch[1].length < 30) {
      summary += `，${actionMatch[1]}`;
    }
    if (summary.length < 20) {
      summary = `第${round}轮：用户和AI进行了对话。`;
    }
    return summary;
  }

  // ========== 结构化事件列表生成 ==========
  async function generateStructuredEvents(historyText, roundRange, type = 'chapter') {
    const callApi = getCallApi();
    if (!callApi) return null;

    const prompt = `你是一个剧情分析专家。请总结以下对话历史中的所有重要情节，按时间顺序列出。
格式要求：
【重要历史情节】
[事件名称]：简明扼要的事件描述（只陈述客观事实，不加评判和修饰，不遗漏关键转折点）

对话历史：
${historyText.substring(0, 2500)}

要求：
- 仅陈述客观事实
- 按时间顺序
- 保留关键转折点
- 使用简洁清晰的语言

输出格式示例：
【重要历史情节】
[初次相遇]：张三在醉仙楼向李四透露了血刀门的劫商计划。
[设伏]：李四将情报传递给官府，在青石关设下埋伏。`;

    try {
      const result = await callApi(prompt, 800, 0.6);
      return result.trim();
    } catch(e) {
      console.warn('[World Engine] 生成结构化事件失败', e);
      return null;
    }
  }

  // ========== 规则提取标签（降级用） ==========
  function shouldStore(text) {
    if (!text || text.length < 10) return false;
    const trash = ['你好', '嗯', '哦', '好的', '再见', '谢谢', '哈哈', '嗯嗯', '是吗', '好吧', '然后呢', '这样啊', '知道了', '没事'];
    if (trash.some(t => text === t || text.trim() === t)) return false;
    // 如果全是无意义的语气词，不存
    if (/^[\s嗯哦啊哈唉诶咦唔噢呃嘛呗吧呀了么]*$/.test(text)) return false;
    return true;
  }

  function extractTagsByRules(text) {
    const tags = { entities: [], locations: [], factions: [], topics: [], emotions: [], objects: [] };

    let entityDict = new Set([
      '张三','李四','王五','赵六','琉璃','九条晓','正辉','美琴','神宫寺','大小姐',
      '血刀门','天机阁','官府','黑市','商会','帮派','联盟','朝廷','丐帮','少林','武当',
      '醉仙楼','青石关','公爵家','会客厅','学园','九条家'
    ]);
    const custom = getCustomEntities();
    custom.forEach(e => entityDict.add(e));

    const entityPattern = new RegExp(`(?<![\\u4e00-\\u9fa5])(?:${Array.from(entityDict).join('|')})(?![\\u4e00-\\u9fa5])`, 'g');
    let match;
    while ((match = entityPattern.exec(text)) !== null) {
      const word = match[0];
      if (['琉璃','九条晓','正辉','美琴','神宫寺','大小姐','张三','李四'].includes(word)) tags.entities.push(word);
      else if (['公爵家','会客厅','醉仙楼','青石关','学园'].includes(word)) tags.locations.push(word);
      else if (['血刀门','天机阁','官府','朝廷','丐帮','九条家'].includes(word)) tags.factions.push(word);
      else tags.entities.push(word);
    }

    const locPattern = /(?:在|去|到|回|前往|来到|进入|离开|位于|抵达)([\u4e00-\u9fa5]{2,4})/g;
    while ((match = locPattern.exec(text)) !== null) {
      let loc = match[1];
      const blacklist = ['什么','怎么','这个','那个','没有','可以','知道','但是','因为','所以','已经','还是','或者','并且'];
      if (!blacklist.includes(loc) && loc.length >= 2) tags.locations.push(loc);
    }

    const topicKeywords = ['情报','交易','报复','刺杀','结盟','背叛','悬赏','保护','追杀','谈判','秘密','计划','承诺','威胁','求助','帮助','信任','婚约','避嫌','盯视','紧张','战斗','偷窃','欺骗','逃亡','追踪','埋伏','进攻','防御','侦查','卧底','贿赂','审判','处决','越狱','绑架','营救','复仇'];
    tags.topics = topicKeywords.filter(k => text.includes(k));

    const emotionKeywords = ['紧张','威严','害怕','开心','愤怒','悲伤','惊讶','厌恶','信任','喜欢','讨厌','恨','爱','恐惧','安心','感动','愧疚','激动','绝望','希望'];
    tags.emotions = emotionKeywords.filter(k => text.includes(k));

    for (let k in tags) tags[k] = [...new Set(tags[k])];
    return tags;
  }

  function calculateImportance(text, tags) {
    let score = 1;
    if (tags.entities && tags.entities.length > 0) score += 1;
    if (tags.topics && tags.topics.length > 0) score += 2;
    if (text.includes('杀') || text.includes('死') || text.includes('血') || text.includes('仇')) score += 2;
    if (text.includes('承诺') || text.includes('威胁') || text.includes('交易') || text.includes('结盟')) score += 1;
    if (text.includes('爱') || text.includes('恨') || text.includes('喜欢')) score += 1;
    if (text.length > 100) score += 1;
    if (tags.topics && (tags.topics.includes('报复') || tags.topics.includes('追杀'))) score += 2;
    return Math.min(5, Math.max(1, score));
  }

  // ========== 情感提取（增强版） ==========
  function isPotentialNpc(name) {
    if (!name || name.length < 2) return false;
    const NON_NPC_KEYWORDS = new Set([
      '废弃便当','秘籍','桌椅','丹药','银两','信件','玉佩','包袱','灯笼','马车',
      '宝剑','长刀','短剑','匕首','飞镖','令牌','符咒','灵药','药丸','药瓶',
      '包裹','箱子','木盒','瓷瓶','酒壶','酒杯','茶壶','饭碗','筷子','菜盘',
      '烛台','香炉','屏风','画卷','书信','纸张','毛笔','墨砚','古琴','棋子',
      '罗盘','地图','钥匙','铜钱','银票','首饰','钗环','手镯','戒指','项链',
      '衣服','长衫','披风','头盔','铠甲','盾牌','弓箭','弩机','火药','暗器',
      '宝物','神器','遗物','供品','令牌','腰牌','通行证','请帖','婚书',
      '地契','房契','账本','名册','密函','情报','卷宗','档案'
    ]);
    if (NON_NPC_KEYWORDS.has(name)) return false;
    const itemSuffix = ['的','箱','包','袋','盒','瓶','罐','碗','筷','盘','碟',
      '剑','刀','枪','戟','斧','锤','棍','棒','鞭','锏','钩','叉','矛',
      '盾','甲','盔','袍','衣','裤','鞋','帽','巾','带','绳','索',
      '丹','丸','散','膏','汤','茶','酒','菜','饭','饼','药',
      '书','信','帖','函','卷','册','纸','笔','墨','砚',
      '灯','烛','炉','鼎','壶','杯','盘','盆','桶','勺'];
    for (const suffix of itemSuffix) {
      if (name.endsWith(suffix)) return false;
    }
    return true;
  }

  // 情感提取（增强版）- v2.5.2: 使用 tryAttitude 权重排序，避免 if 顺序覆盖
  function extractEmotion(text, entities) {
    const emotions = [];
    for (const entity of entities) {
      // v2.4.0：跳过明显非NPC实体
      if (!isPotentialNpc(entity)) {
        console.log('[World Engine Emotion] 跳过非NPC实体:', entity);
        continue;
      }
      let candidate = null, candReason = '', candLevel = null, candStrength = 0;

      function tryAttitude(newAtt, newReason, newLevel, strength) {
        if (candidate === null || strength > candStrength) {
          candidate = newAtt; candReason = newReason; candLevel = newLevel; candStrength = strength;
        }
      }

      // 权重决定优先级，顺序无关
      // 正向情感
      if (text.includes('喜欢') || text.includes('爱') || text.includes('深爱')) {
        tryAttitude('友善', '对话中表露好感', '熟人', 30);
      }
      if (text.includes('信任') || text.includes('信赖') || text.includes('放心')) {
        tryAttitude('信任', '建立了信任关系', '熟人', 40);
      }
      if (text.includes('帮助') || text.includes('帮忙') || text.includes('救') || text.includes('保护')) {
        tryAttitude('友善', '提供帮助', '一面之缘', 20);
      }
      if (text.includes('感谢') || text.includes('感激') || text.includes('谢谢')) {
        tryAttitude('友善', '表示感谢', '一面之缘', 10);
      }
      if (text.includes('生死') || text.includes('托付') || text.includes('誓死')) {
        tryAttitude('深厚信任', '生死托付', null, 90);
      }
      if (text.includes('深爱') || text.includes('至爱')) {
        tryAttitude('深厚信任', '至深情感', null, 85);
      }

      // 负向情感（更高权重的覆盖）
      if (text.includes('恨') || text.includes('仇恨') || text.includes('怨恨')) {
        tryAttitude('不共戴天', '产生深仇大恨', null, 99);
      }
      if (text.includes('讨厌') || text.includes('厌恶')) {
        tryAttitude('敌意', '表现出反感', null, 60);
      }
      if (text.includes('杀') || text.includes('报仇') || text.includes('复仇')) {
        tryAttitude('敌意', '涉及暴力冲突', null, 80);
      }
      if (text.includes('威胁') || text.includes('警告')) {
        tryAttitude('警惕', '受到威胁或警告', null, 50);
      }
      if (text.includes('恐惧') || text.includes('害怕')) {
        tryAttitude('恐惧', '表现出恐惧', null, 55);
      }

      if (candidate) {
        emotions.push({ entity, attitude: candidate, reason: candReason, impliedLevel: candLevel });
      }
    }
    return emotions;
  }

  // ========== 主存储函数 ==========
  async function storeMemoryFromRound(state, userMsg, aiMsg, round) {
    const combined = (userMsg + ' ' + aiMsg).substring(0, 1500);
    if (!shouldStore(combined)) return null;

    let summary = null;
    let tags = null;
    let importance = 2;
    const settings = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
    const useSmart = settings.smartTagging !== false;

    if (useSmart) {
      try {
        let locationHint = null;
        const locMatch = combined.match(/(?:在|于)([\u4e00-\u9fa5]{2,4})/);
        if (locMatch) locationHint = locMatch[1];
        const smartResult = await generateSmartSummaryWithTags(userMsg, aiMsg, round, locationHint);
        if (smartResult) {
          summary = smartResult.summary || "（无摘要）";
          tags = {
            entities: smartResult.tags.entities || [],
            locations: smartResult.tags.locations || [],
            factions: smartResult.tags.factions || [],
            topics: smartResult.tags.topics || [],
            emotions: smartResult.tags.emotions || [],
            objects: smartResult.tags.objects || []
          };
          importance = calculateImportance(combined, tags);
        } else {
          tags = extractTagsByRules(combined);
          summary = generateRuleBasedSummary(userMsg, aiMsg, round, tags);
          importance = calculateImportance(combined, tags);
        }
      } catch(e) {
        console.warn('[World Engine] 智能摘要失败，回退规则', e);
        tags = extractTagsByRules(combined);
        summary = generateRuleBasedSummary(userMsg, aiMsg, round, tags);
        importance = calculateImportance(combined, tags);
      }
    } else {
      tags = extractTagsByRules(combined);
      summary = generateRuleBasedSummary(userMsg, aiMsg, round, tags);
      importance = calculateImportance(combined, tags);
    }

    // 合并自定义实体
    const customEntities = getCustomEntities();
    if (customEntities.length && tags) {
      for (const ce of customEntities) {
        if (!tags.entities.includes(ce)) tags.entities.push(ce);
      }
    }

    const memory = {
      id: `mem_${Date.now()}_${round}`,
      type: 'round',
      summary: summary,
      context: summary,  // 存 AI 生成的摘要作为 context（非原文）
      tags: tags,
      emotion: {},
      importance: importance,
      round: round,
      roundRange: null
    };
    core.addMemory(state, memory);
    console.log(`[World Engine Memory] 存储记忆 (重要性${importance}): ${summary.substring(0, 80)}...`);

    // ===== 情感更新（增强版） =====
    const emotions = extractEmotion(combined, tags.entities || []);
    for (const em of emotions) {
      const currentEmotion = state.emotionMap[em.entity];
      const oldAttitude = currentEmotion?.attitude || '中立';
      const newLevel = em.impliedLevel || determineLevel(em.attitude, currentEmotion?.level || '陌生人');
      
      // 检测情感变化
      if (oldAttitude !== em.attitude) {
        console.log(`[World Engine Emotion] 情感变化: ${em.entity} ${oldAttitude} → ${em.attitude} (${em.reason})`);
        
        // 如果从友善变成敌意，记录为血仇备忘录
        if (em.attitude === '不共戴天' && (oldAttitude === '友善' || oldAttitude === '信任')) {
          if (!state.bloodFeudMemo.some(b => b.faction === em.entity)) {
            state.bloodFeudMemo.push({
              faction: em.entity,
              reason: em.reason || '情感逆转：从友善变为不共戴天',
              status: '追踪中',
              lastActionRound: state.round,
              nextAttackRound: state.round + Math.floor(Math.random() * 6) + 5,
              attackCount: 0
            });
            console.log(`[World Engine Emotion] 血仇记录新增: ${em.entity}`);
          }
        }
      }

      // v2.4.0：二次过滤 — 确保不把非NPC写入情感地图
      if (isPotentialNpc(em.entity)) {
        core.updateEmotion(state, em.entity, em.attitude, newLevel, em.reason);
      } else {
        console.log('[World Engine Emotion] 二次过滤跳过:', em.entity);
      }
    }

    
      // ★ v3.1.2: keyword combat detection fallback
      if (window.WORLD_ENGINE_CORE && typeof window.WORLD_ENGINE_CORE.addCombatLog === "function" && state) {
        var battleKws = ["打起来了","砍翻","砍倒","单挑","决斗","大战","厮杀","战斗","打斗","击倒","斩杀","击败","险胜","交手","血战","搏斗","杀死","击杀","追杀","扇了","打了一架","刀剑","挥剑","砍杀","刺中","流血","负伤","受伤","重伤","伤口","击败了","杀了","一刀","一剑","打了一架"];
        var hasBattle = false;
        for (var k = 0; k < battleKws.length; k++) { if (combined.indexOf(battleKws[k]) !== -1) { hasBattle = true; break; } }
        if (hasBattle) {
          var outcome = "win";
          if (combined.indexOf("险胜") === -1 && (combined.indexOf("受伤") !== -1 || combined.indexOf("败") !== -1 || combined.indexOf("逃") !== -1)) outcome = "loss";
          var killCnt = 0;
          var km = combined.match(/砍翻[\u4e00-\u9fa5\d]+|杀死[\u4e00-\u9fa5\d]+|击杀[\u4e00-\u9fa5\d]+|斩[杀][了]?[\u4e00-\u9fa5\d]+/g);
          if (km) { for (var ki = 0; ki < km.length; ki++) killCnt++; }
          var participants = [];
          var pMatch = combined.match(/([\u4e00-\u9fa5]{2,6})(?:寨主|阁主|首领|帮主|头目|山贼|喽啰|护卫|信使|掌门|教主|将军)/);
          if (pMatch) participants.push(pMatch[1]);
          window.WORLD_ENGINE_CORE.addCombatLog(state, {
            type: "keyword_detected",
            participants: participants.length > 0 ? participants : ["未知对手"],
            outcome: outcome,
            kills: Math.max(1, killCnt),
            injuries: [],
            description: (userMsg || "").substring(0, 200),
            weapon: "未知",
            damageDealt: 10,
            damageTaken: 5,
            isBossFight: combined.indexOf("寨主") !== -1 || combined.indexOf("阁主") !== -1 || combined.indexOf("掌门") !== -1 || combined.indexOf("教主") !== -1,
            turnCount: 1
          });
          console.log("[World Engine Combat] keyword detected: " + killCnt + " kills, " + outcome);
        }
      }
      return memory;
  }

  // ========== 章节摘要 ==========
  async function mergeChapterSummary(state, startRound, endRound) {
    const memories = state.memories.filter(m => m.round >= startRound && m.round <= endRound && m.type === 'round');
    if (memories.length === 0) return;

    const combined = memories.map(m => `[第${m.round}轮] ${m.summary}`).join('\n');
    let structuredEvents = null;
    let fallbackSummary = `第${startRound}-${endRound}轮：${memories.map(m => m.summary).join('；')}`.substring(0, 500);

    const settings = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
    if (settings.smartTagging !== false) {
      try {
        structuredEvents = await generateStructuredEvents(combined, [startRound, endRound], 'chapter');
      } catch(e) { console.warn('[World Engine] 生成章节结构化事件失败', e); }
    }

    // 合并标签
    const mergedTags = { entities: new Set(), locations: new Set(), factions: new Set(), topics: new Set(), emotions: new Set() };
    for (const m of memories) {
      if (m.tags) {
        for (const key of Object.keys(mergedTags)) {
          if (Array.isArray(m.tags[key])) m.tags[key].forEach(t => mergedTags[key].add(t));
        }
      }
    }
    const tagsObj = {};
    for (const [k, v] of Object.entries(mergedTags)) tagsObj[k] = Array.from(v);

    const chapter = {
      id: `chap_${startRound}_${endRound}`,
      type: 'chapter_summary',
      summary: structuredEvents || fallbackSummary,
      context: structuredEvents ? combined : '',
      tags: tagsObj,
      emotion: {},
      importance: 4,
      round: endRound,
      roundRange: [startRound, endRound],
      structured: !!structuredEvents
    };
    core.addMemory(state, chapter);

    // 清理重要性低的原始记忆（保留章节摘要后，原始记忆可减量）
    const toDelete = memories.filter(m =>
      m.importance < 3 &&
      !m.tags.topics?.includes('报复') &&
      !m.tags.topics?.includes('追杀') &&
      !m.tags.topics?.includes('复仇')
    );
    for (const del of toDelete) {
      const idx = state.memories.findIndex(m => m.id === del.id);
      if (idx !== -1) state.memories.splice(idx, 1);
    }
    core.saveState(state);
    console.log(`[World Engine Memory] 章节摘要已生成 (${startRound}-${endRound})，保留${memories.length - toDelete.length}条核心记忆`);
  }

  async function mergeVolumeSummary(state, startRound, endRound) {
    const chapters = state.chapterSummaries.filter(m => m.round >= startRound && m.round <= endRound);
    if (chapters.length === 0) return;

    const combined = chapters.map(c => c.summary).join('\n\n');
    let structuredEvents = null;
    let fallbackSummary = `卷摘要(${startRound}-${endRound}): ${chapters.map(c => c.summary.substring(0, 100)).join('；')}`.substring(0, 800);

    const settings = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
    if (settings.smartTagging !== false) {
      try {
        structuredEvents = await generateStructuredEvents(combined, [startRound, endRound], 'volume');
      } catch(e) { console.warn('[World Engine] 生成卷结构化事件失败', e); }
    }

    const volume = {
      id: `vol_${startRound}_${endRound}`,
      type: 'volume_summary',
      summary: structuredEvents || fallbackSummary,
      context: structuredEvents ? combined : '',
      tags: { topics: ['summary', 'volume'] },
      emotion: {},
      importance: 5,
      round: endRound,
      roundRange: [startRound, endRound],
      structured: !!structuredEvents
    };
    core.addMemory(state, volume);
    core.saveState(state);
    console.log(`[World Engine Memory] 卷摘要已生成 (${startRound}-${endRound})`);
  }

  // ========== 召回记忆（增强：支持情感权重） ==========
  function recallMemories(state, tags, maxCount = 10, currentLocation = null) {
    let allMemories = [...state.memories, ...state.chapterSummaries, ...state.volumeSummaries];
    let scored = allMemories.map(mem => {
      let score = 0;
      const memTags = mem.tags || {};

      // 实体匹配（高权重）
      if (memTags.entities) {
        score += memTags.entities.filter(e => tags.includes(e)).length * 2;
      }
      // 地点匹配（含当前地点权重调整）
      if (memTags.locations) {
        let locScore = memTags.locations.filter(l => tags.includes(l)).length;
        if (currentLocation && memTags.locations.includes(currentLocation)) {
          locScore *= 1.5;  // 当前地点权重 x1.5
        } else if (currentLocation && memTags.locations.length && !memTags.locations.includes(currentLocation)) {
          locScore *= 0.3;  // 冲突地点权重 x0.3（不是清零）
        }
        score += locScore;
      }
      // 势力匹配
      if (memTags.factions) {
        score += memTags.factions.filter(f => tags.includes(f)).length;
      }
      // 话题匹配（高权重）
      if (memTags.topics) {
        score += memTags.topics.filter(t => tags.includes(t)).length * 1.5;
      }

      // 活跃实体额外加分
      const activeEntities = tags.filter(t => memTags.entities && memTags.entities.includes(t));
      score += activeEntities.length * 0.2 * (mem.importance || 1);

      // 重要性权重
      if (mem.importance >= 4) score += 3;
      else if (mem.importance === 3) score += 1;

      // 时效性权重
      const age = state.round - (mem.round || 0);
      if (age < 10) score += 2;
      else if (age < 30) score += 1;

      return { mem, score };
    });
    scored.sort((a,b) => b.score - a.score);

    // ★ v3.0.0: 冷热分离排序
    var config = state.settings || state.config || {};
    var hotList = [];
    var coldList = [];
    for (var mi = 0; mi < scored.length; mi++) {
      scored[mi].mem.lastAccessRound = scored[mi].mem.lastAccessRound || 0;
      if (core.isHotMemory(scored[mi].mem, state.round, config)) {
        hotList.push(scored[mi]);
      } else {
        coldList.push(scored[mi]);
      }
    }
    scored = hotList.concat(coldList);

    return scored.slice(0, maxCount).map(s => s.mem);
  }

  // ========== 调试工具 ==========
  window.WORLD_ENGINE_DEBUG_MEMORY = () => {
    const state = core.loadState();
    console.log('=== World Engine Memory Debug ===');
    console.log('原始记忆数量:', state.memories.length);
    console.log('章节摘要数量:', state.chapterSummaries.length);
    console.log('卷摘要数量:', state.volumeSummaries.length);
    console.log('情感实体:', Object.keys(state.emotionMap).length);
    console.log('最近5条记忆摘要:', state.memories.slice(0,5).map(m => ({ round: m.round, summary: m.summary })));
    console.log('情感快照:', state.emotionMap);
  };

  return {
    storeMemoryFromRound,
    recallMemories,
    mergeChapterSummary,
    mergeVolumeSummary
  };
})();
