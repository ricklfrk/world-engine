// world-engine-tags.js — 预测标签生成（四层流水线 v2.2.0）
// ============================================================
// ★ 修改记录 ★
// 2026-06-05 v2.1.0
//   - 增强实体/地点/势力检测模式
//   - 支持从记忆库提取活跃实体
//   - 支持从自定义实体列表动态加载
//   - 支持中英文混合文本
//   - 添加话题优先级排序
// 2026-06-05 v2.2.0
//   - 四层流水线架构：
//     ① 面板状态标签（extractFromState，不变）
//     ② AI 语义提取（extractByAI，新增）
//     ③ 规则补漏（extractFromChat，改造）
//     ④ 评分+去重+合并（generatePredictionTags，改 async）
//   - extractFromChat 移除硬编码词库，改用世界书+自定义实体+正则
//   - generatePredictionTags 改为 async，使用评分系统
// ============================================================

window.WORLD_ENGINE_TAGS = (function() {
  // 获取自定义实体列表（从设置）
  function getCustomEntities() {
    try {
      const settings = JSON.parse(window.WORLD_ENGINE_STORAGE.getItem('world_engine_settings') || '{}');
      const customEntitiesStr = settings.customEntities || '';
      if (customEntitiesStr) {
        return customEntitiesStr.split(/[,，、]/).map(s => s.trim()).filter(s => s.length >= 2);
      }
    } catch(e) {}
    return [];
  }

  // ========== 第③层：规则补漏（改造版） ==========
  // 从聊天记录提取标签（使用世界书+自定义实体+正则，移除硬编码词库）
  function extractFromChat(chatHistory, state, maxLen = 5) {
    const entities = new Set();
    const locations = new Set();
    const factions = new Set();
    const topics = new Set();
    const emotions = new Set();

    const recent = chatHistory.slice(-maxLen);
    const text = recent.map(msg => (msg.mes || msg.content || '')).join(' ');

    // 清理地名：去掉句末助词后缀，过滤无效碎片
    function cleanLocation(loc) {
      var suffixes = ['上', '下', '里', '中', '前', '后', '旁', '边', '内', '外', '附近'];
      var cleaned = loc;
      for (var si = 0; si < suffixes.length; si++) {
        if (cleaned.endsWith(suffixes[si])) {
          cleaned = cleaned.slice(0, -suffixes[si].length);
          break;
        }
      }
      if (cleaned.length < 2) return null;
      var locBlacklist = new Set([
        '什么','怎么','这个','那个','没有','可以','哪里','那里',
        '头顶','身边','眼前','背后','地上','手上','身上','心中',
        '身后','面前','对面','旁边','周围','楼下','楼上','窗外',
        '门口','半空','一侧','各处'
      ]);
      if (locBlacklist.has(cleaned)) return null;
      return cleaned;
    }

    // --- 1. 从世界书名称补充 ---
    const worldbook = window.WORLD_ENGINE_WORLDBOOK;
    if (worldbook && worldbook.getCache) {
      const cache = worldbook.getCache();
      if (Array.isArray(cache)) {
        for (const entry of cache) {
          // entry.tags 是世界书条目的触发关键词（实体/名字/概念）
          if (entry.tags && Array.isArray(entry.tags)) {
            for (const tag of entry.tags) {
              const t = tag.trim();
              if (t.length >= 2 && text.includes(t)) {
                entities.add(t);
              }
            }
          }
        }
      }
    }

    // --- 2. 自定义实体 ---
    const customEntities = getCustomEntities();
    for (const ce of customEntities) {
      if (text.includes(ce)) {
        entities.add(ce);
      }
    }

    // --- 3. 动态抓取人物名：X 说 / 对 X 说 / X 表示 等模式 ---
    const namePatterns = [
      /[""「『]([\u4e00-\u9fa5]{2,4})[""」』]/g,                     // "张三"说的模式
      /([\u4e00-\u9fa5]{2,4})(?:说|道|讲|问|答|喊|叫|骂|哭|笑|怒|叹)/g,  // 张三说模式
      /(?:对|向|和|跟|与)([\u4e00-\u9fa5]{2,4})(?:说|道|讲|问)/g,       // 对张三说模式
      /(?:把|被|让|给|为)([\u4e00-\u9fa5]{2,4})/g,                    // 把张三/被张三
      /(?:只见|但见|却见|看见|见到)([\u4e00-\u9fa5]{2,4})/g,          // 见张三
    ];

    const blacklist = new Set([
      '什么','怎么','这个','那个','没有','可以','知道','但是','因为',
      '所以','已经','还是','或者','并且','一个','就是','不是','如果',
      '虽然','然后','而且','不过','只是','可能','应该','不要','他们',
      '你们','我们','大家','自己','时候','地方','东西','事情','样子',
      '发现','看见','听到','知道','觉得','开始','继续','准备','打算',
      '突然','终于','原来','其实','根本','完全','还是','只有','只是',
      '这些','那些','一些','所有','全部','整个','之间','之中'
    ]);

    for (const pattern of namePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1];
        if (name.length >= 2 && !blacklist.has(name)) {
          entities.add(name);
        }
      }
    }

    // --- 4. 动态抓取地点：在/去/到/回/前往 + 地名 ---
    const locPattern = /(?:在|去|到|回|前往|来到|进入|离开|前往|位于|抵达)([\u4e00-\u9fa5]{2,4})/g;
    const locBlacklist = new Set([
      '什么','怎么','这个','那个','没有','可以','哪里','那里',
      '头顶','身边','眼前','背后','地上','手上','身上','心中',
      '身后','面前','对面','旁边','周围','楼下','楼上','窗外',
      '门口','半空','一侧','各处','地下'
    ]);
    while ((match = locPattern.exec(text)) !== null) {
      const loc = match[1];
      const cleaned = cleanLocation(loc);
      if (cleaned) {
        locations.add(cleaned);
      }
    }

    // --- 5. 情感词汇映射 ---
    const emotionKeywords = {
      '温馨': ['温馨','温暖','感动','欣慰','幸福','甜蜜'],
      '紧张': ['紧张','压迫','危急','紧急','剑拔弩张'],
      '悲伤': ['悲伤','哀伤','悲痛','凄惨','绝望','落泪'],
      '愤怒': ['愤怒','怒火','暴怒','愤恨','怒气冲天'],
      '恐惧': ['恐惧','害怕','惊惧','恐慌','战栗'],
      '欢乐': ['欢乐','喜悦','开心','高兴','愉快','欢笑'],
      '神秘': ['神秘','诡异','奇怪','古怪','蹊跷','可疑'],
      '浪漫': ['浪漫','爱意','暧昧','柔情','心动']
    };
    for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
      for (const kw of keywords) {
        if (text.includes(kw)) {
          emotions.add(emotion);
          break;
        }
      }
    }

    // --- 6. 话题关键词映射 ---
    const topicKeywords = {
      '战斗': ['战斗','打斗','厮杀','对决','交战','比武','单挑'],
      '阴谋': ['阴谋','诡计','陷阱','算计','圈套','暗算'],
      '交易': ['交易','买卖','买卖','采购','交易','议价','讨价'],
      '逃亡': ['逃亡','逃跑','逃命','逃脱','追杀','追捕'],
      '调查': ['调查','侦查','探听','打听','查探','暗访'],
      '谈判': ['谈判','商议','协商','交涉','谈判','约定'],
      '营救': ['营救','救援','救出','解救','搭救'],
      '拜师': ['拜师','收徒','徒弟','师父','学艺'],
      '寻宝': ['寻宝','宝藏','宝物','秘籍','神兵'],
      '复仇': ['复仇','报仇','报复','恩怨','血仇']
    };
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      for (const kw of keywords) {
        if (text.includes(kw)) {
          topics.add(topic);
          break;
        }
      }
    }

    // --- 7. 势力关键词映射 ---
    const factionKeywords = {
      '血刀门': ['血刀','血刀门','血刀老祖'],
      '天机阁': ['天机','天机阁'],
      '蜀山派': ['蜀山','蜀山派'],
      '丐帮': ['丐帮','乞丐','打狗棒'],
      '少林': ['少林','少林寺','和尚'],
      '武当': ['武当','武当派'],
      '明教': ['明教','明教教众'],
      '官府': ['官府','朝廷','官兵','衙门','捕快'],
    };
    for (const [faction, keywords] of Object.entries(factionKeywords)) {
      for (const kw of keywords) {
        if (text.includes(kw)) {
          factions.add(faction);
          break;
        }
      }
    }

    // 返回分类结果（Set 转 Array）
    return {
      entities: Array.from(entities),
      locations: Array.from(locations),
      factions: Array.from(factions),
      topics: Array.from(topics),
      emotions: Array.from(emotions)
    };
  }

  // ========== 第①层：面板状态标签（不变） ==========
  function extractFromState(state) {
    const tags = [];

    // 事件链
    for (const ev of state.events || []) {
      const remaining = ev.totalRounds - ev.currentRound;
      if (remaining <= 0) tags.push(`event_immediate:${ev.name}`);
      else if (remaining <= 2) tags.push(`event_critical:${ev.name}`);
      else tags.push(`event:${ev.name}`);
      // 如果有爆发事件，自动加入话题标签
      if (ev.stage === '已爆发') tags.push('topic:event_erupted');
    }

    // 势力
    for (const f of state.factions || []) {
      tags.push(`faction:${f.name}`);
      if (f.attentionToUser === '排斥' || f.attentionToUser === '拉拢') {
        tags.push(`faction_active:${f.name}`);
      }
    }

    // 血仇
    if (state.bloodFeudMemo && state.bloodFeudMemo.length > 0) {
      tags.push('topic:revenge');
      let hasActive = false;
      for (const bf of state.bloodFeudMemo) {
        tags.push(`bloodfeud:${bf.faction}`);
        if (bf.status === '追杀中') {
          hasActive = true;
          tags.push(`bloodfeud_active:${bf.faction}`);
        }
      }
      if (hasActive) tags.push('bloodfeud_active');
    }

    // 声誉变化
    if (state.reputation) {
      if (state.reputation.jianghu !== '默默无闻') tags.push('topic:reputation');
      if (state.reputation.official !== '默默无闻') tags.push('topic:official_reputation');
      if (state.reputation.underworld !== '默默无闻') tags.push('topic:underworld_reputation');
    }

    // 流言
    if (state.rumors && state.rumors.length > 0) {
      tags.push('topic:rumor');
      // 把高热度的流言内容提取为标签
      const hotRumors = state.rumors.filter(r => (r.heatLevel || r.heat || '中') === '热');
      for (const r of hotRumors.slice(0, 3)) {
        // 提取流言中的实体关键词
        const words = r.content.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
        for (const w of words.slice(0, 3)) {
          if (w.length >= 2) tags.push(`rumor:${w}`);
        }
      }
    }

    // 因果链
    if (state.causalChain && state.causalChain.length > 0) {
      tags.push('topic:causality');
    }

    // 经济事件
    if (state.economy && (state.economy.fundsStatus !== '手头紧' || (state.economy.keyResources || []).length > 0)) {
      tags.push('topic:economy');
    }

    // 从情感地图提取活跃 NPC
    if (state.emotionMap) {
      const activeNpcs = Object.entries(state.emotionMap)
        .filter(([_, e]) => e.attitude === '敌意' || e.attitude === '信任' || e.attitude === '友善')
        .slice(0, 5)
        .map(([name]) => name);
      for (const npc of activeNpcs) {
        tags.push(npc);
      }
    }

    return tags;
  }

  // ========== 第②层：AI 语义提取（新增） ==========
  async function extractByAI(chatHistory, state) {
    const evolution = window.WORLD_ENGINE_EVOLUTION;
    if (!evolution || typeof evolution.callApi !== 'function') {
      console.warn('[World Engine Tags] 演化模块不可用，跳过AI标签提取');
      return null;
    }

    // 取最近 10 轮对话作为上下文
    const recent = chatHistory.slice(-10);
    const conversationText = recent.map(msg => {
      const name = msg.name || (msg.is_user ? '用户' : (msg.is_system ? '系统' : 'AI'));
      return `${name}: ${(msg.mes || msg.content || '').substring(0, 300)}`;
    }).join('\n');

    if (!conversationText.trim()) return null;

    const systemPrompt = `你是一个标签提取专家。根据对话内容，提取出现的重要信息。

输出 JSON 数组，每个元素是字符串，要求：
1. 实体名（人名、地名、势力名、物品名）直接输出名称
2. 地名加前缀 "location:"，如 "location:蜀山"
3. 势力名加前缀 "faction:"，如 "faction:蜀山派"
4. 核心话题加前缀 "topic:"，如 "topic:拜师"
5. 当前情绪氛围加前缀 "emotion:"，如 "emotion:温馨"
6. 不要输出其他文字，只输出 JSON 数组

示例：
["林月如", "location:蜀山", "faction:蜀山派", "topic:修行", "emotion:温馨"]`;

    const userMessages = `## 对话内容\n${conversationText}\n\n## 输出\n请根据以上对话输出标签 JSON 数组，不要有其他文字。`;

        const result = await evolution.callApi(systemPrompt + '\n\n' + userMessages, 1000, 0.3);
    if (!result || typeof result !== 'string' || !result.trim()) return null;

    // ★ v3.1.2: 多层 JSON 恢复解析（修复 AI 返回截断 JSON）
    function tryParseTagsJSON(str) {
      if (!str) return null;
      var s = str.trim();
      s = s.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      var arrIdx = s.indexOf('[');
      if (arrIdx === -1) return null;
      if (arrIdx > 0) s = s.substring(arrIdx);
      try { var p = JSON.parse(s); if (Array.isArray(p)) return p; } catch(e) {}
      // 修复未闭合字符串
      var inStr = false, esc = false;
      for (var i = 0; i < s.length; i++) {
        if (esc) { esc = false; continue; }
        if (s[i] === '\\') { esc = true; continue; }
        if (s[i] === '"' && !esc) inStr = !inStr;
      }
      if (inStr) s += '"';
      // 修复截断数组
      var lcb = s.lastIndexOf(']'), lob = s.lastIndexOf('[');
      if (lcb < lob) {
        var ac = s.substring(s.indexOf('[') + 1);
        var lie = ac.lastIndexOf('"');
        if (lie === -1) lie = ac.lastIndexOf(',');
        s = s.substring(0, s.indexOf('[') + 1) + ac.substring(0, Math.max(lie + 1, 0)) + ']';
      }
      try { var p2 = JSON.parse(s); if (Array.isArray(p2)) return p2; } catch(e2) {}
      // 回退：逗号分割提取标签
      var lns = s.split(/\n|,/);
      var its = [];
      for (var li = 0; li < lns.length; li++) {
        var ln = lns[li].replace(/^[\s\[\],']+|[\s\]\],']+$/g, '').trim();
        if (ln && ln.length >= 2 && !ln.includes(' ') && !its.includes(ln)) its.push(ln);
      }
      return its.length >= 2 ? its : null;
    }

    var parsed = tryParseTagsJSON(result);
    if (parsed && Array.isArray(parsed)) {
      return parsed.filter(function(t) { return typeof t === 'string' && t.length >= 2; });
    }
    return null;
  }

  // ========== 评分函数 ==========
  function scoreTag(tag) {
    if (tag.startsWith('event_immediate:')) return 10;
    if (tag.startsWith('event_critical:')) return 9;
    if (tag.startsWith('bloodfeud_active')) return 9;
    if (tag.startsWith('bloodfeud:')) return 8;
    if (tag.startsWith('faction_active:')) return 8;
    if (tag.startsWith('faction:')) return 7;
    if (tag.startsWith('event:')) return 7;
    if (tag.startsWith('location:')) return 6;
    // 实体（无前缀）→ 高分
    if (!tag.includes(':')) return 6;
    if (tag.startsWith('rumor:')) return 5;
    if (tag.startsWith('topic:')) return 4;
    if (tag.startsWith('emotion:')) return 3;
    return 2;
  }

  // 标签类型判定（用于 UI 显示）
  function getTagType(tag) {
    if (tag.startsWith('location:')) return 'location';
    if (tag.startsWith('faction:')) return 'faction';
    if (tag.startsWith('bloodfeud')) return 'state';
    if (tag.startsWith('event_')) return 'state';
    if (tag.startsWith('event:')) return 'state';
    if (tag.startsWith('topic:')) return 'topic';
    if (tag.startsWith('emotion:')) return 'emotion';
    if (tag.startsWith('rumor:')) return 'topic';
    if (tag.startsWith('faction_active')) return 'faction';
    if (tag.startsWith('bloodfeud_active')) return 'state';
    return 'entity';
  }

  // 合并自定义实体
  function mergeCustomEntities(tags) {
    const customs = getCustomEntities();
    for (const ce of customs) {
      if (!tags.includes(ce)) tags.push(ce);
    }
    return tags;
  }

  // ========== 第④层：评分+去重+合并（改 async） ==========
  async function generatePredictionTags(chatHistory, worldState) {
    // 第②层：AI 提取（异步）
    let aiResult = null;
    try {
      aiResult = await extractByAI(chatHistory, worldState);
    } catch(e) {
      console.warn('[World Engine Tags] AI标签提取失败，降级规则', e.message);
    }

    // 第①层 + 第③层：状态 + 规则
    const stateTags = extractFromState(worldState);
    const ruleTags = extractFromChat(chatHistory, worldState);

    // 转换规则标签为带前缀字符串
    const ruleTagStrings = [];
    for (const entity of ruleTags.entities) ruleTagStrings.push(entity);
    for (const loc of ruleTags.locations) ruleTagStrings.push(`location:${loc}`);
    for (const faction of ruleTags.factions) ruleTagStrings.push(`faction:${faction}`);
    for (const topic of ruleTags.topics) ruleTagStrings.push(`topic:${topic}`);
    for (const emotion of ruleTags.emotions) ruleTagStrings.push(`emotion:${emotion}`);

    // 用 Map 去重，优先保留高分
    const tagMap = new Map();

    // 第①层：状态标签（最高优先级）直接加入评分
    for (const tag of stateTags) {
      const existing = tagMap.get(tag);
      if (!existing || scoreTag(tag) > existing.score) {
        tagMap.set(tag, {
          tag: tag,
          score: scoreTag(tag),
          source: 'state'
        });
      }
    }

    // 第②层：AI 标签（第二优先级）
    if (aiResult && Array.isArray(aiResult)) {
      for (const tag of aiResult) {
        const s = scoreTag(tag);
        const existing = tagMap.get(tag);
        if (!existing || s > existing.score) {
          tagMap.set(tag, {
            tag: tag,
            score: Math.max(s, 5),  // AI 标签保底 5 分
            source: 'ai'
          });
        }
      }
    }

    // 第③层：规则标签（第三优先级）
    for (const tag of ruleTagStrings) {
      const s = scoreTag(tag);
      const existing = tagMap.get(tag);
      if (!existing || s > existing.score) {
        tagMap.set(tag, {
          tag: tag,
          score: s,
          source: 'rule'
        });
      }
    }

    // 按分数降序排序
    const sorted = Array.from(tagMap.values()).sort((a, b) => b.score - a.score);

    // 取前 20 个标签，但确保保留紧急事件和血仇
    const urgent = sorted.filter(t =>
      t.tag.startsWith('event_immediate:') ||
      t.tag.startsWith('event_critical:') ||
      t.tag.startsWith('bloodfeud_active')
    );
    const nonUrgent = sorted.filter(t => !urgent.includes(t));
    let combined = [...urgent, ...nonUrgent].slice(0, 20);

    // 提取标签名列表
    let finalTags = combined.map(t => t.tag);

    // 合并自定义实体（确保 100% 出现）
    finalTags = mergeCustomEntities(finalTags);

    // 最终去重
    finalTags = [...new Set(finalTags)];

    // 确保上限 20 个，但紧急事件优先保留
    const urgentFinal = finalTags.filter(t =>
      t.startsWith('event_immediate:') ||
      t.startsWith('event_critical:') ||
      t.startsWith('bloodfeud_active')
    );
    const restFinal = finalTags.filter(t => !urgentFinal.includes(t));
    finalTags = [...urgentFinal, ...restFinal].slice(0, 20);

    console.log(`[World Engine Tags] 预测标签 (${finalTags.length}个):`, finalTags);
    return finalTags;
  }

  // 导出 getTagType 用于 UI 展示
  return {
    generatePredictionTags,
    getTagType
  };
})();
