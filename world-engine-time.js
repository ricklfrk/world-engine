// world-engine-time.js — 时间引擎模块 v2.4.0
// ============================================================
// 提供世界时间增量计算、格式化、阈值检测、关键词匹配
// v2.4.0 迭代B：新增 TIME_PRESETS 供 UI 使用
// ============================================================

window.WORLD_ENGINE_TIME = (function() {

  // ========== v2.4.0：时间预设常量 ==========
  const TIME_PRESETS = [
    { label: '片刻',   value: 2 },
    { label: '一刻钟',  value: 15 },
    { label: '半个时辰',value: 30 },
    { label: '一个时辰',value: 60 },
    { label: '半日',   value: 360 },
    { label: '一日',   value: 1440 },
    { label: '三日',   value: 4320 },
    { label: '七日',   value: 10080 },
    { label: '自定义',  value: -1 },
  ];

  // ---------- AI 时间估算提取 ----------
  function getAiTimeEstimate(evolveResult) {
    if (!evolveResult || typeof evolveResult !== 'object') return null;
    if (typeof evolveResult.timeEstimateMinutes === 'number' && !isNaN(evolveResult.timeEstimateMinutes)) {
      return Math.max(0, Math.round(evolveResult.timeEstimateMinutes));
    }
    return null;
  }

  // ---------- 智能关键词检测（手动模式下的拨片） ----------
  function detectTimeKeywords(text) {
    if (!text || typeof text !== 'string') return 0;

    const patterns = [
      // v2.4.1 Bugfix: 去掉 g 标记——test() 不需要全局搜索，且持久化正则对象的 lastIndex 会跨调用累积
      // 极短时间
      { regex: /(?:片刻|少顷|须臾|转瞬|瞬间|弹指|刹那)/, minutes: 2 },
      { regex: /(?:眨眼|一瞬|顷刻)/, minutes: 1 },
      // 一刻钟 / 半个时辰 / 一个时辰
      { regex: /一刻(?:钟)?/, minutes: 15 },
      { regex: /半个时辰/, minutes: 30 },
      { regex: /(?:一)?个?时辰/, minutes: 60 },
      // 半日 / 大半日 / 小半日
      { regex: /(?:半日|半天)/, minutes: 360 },
      // 一日 / 一天 / 整日 / 整夜
      { regex: /(?:一|整)(?:日|天|夜)/, minutes: 1440 },
      // 次日 / 翌日 / 第二天 / 第二天一早
      { regex: /(?:次日|翌日|第[二三]天|第二天)/, minutes: 1440 },
      // 数日后 / 数日
      { regex: /(?:数日(?:后)?)/, minutes: 4320 },
      // 几天后
      { regex: /几(?:天|日)(?:后|之[后内])?/, minutes: 4320 },
      // 三日后 / 三天后 / 三日 / 三天
      { regex: /[三三](?:日|天)(?:后|之[后内])?/, minutes: 4320 },
      // 五日后 / 五天
      { regex: /[五五](?:日|天)(?:后|之[后内])?/, minutes: 7200 },
      // 七日后 / 七天
      { regex: /[七七](?:日|天)(?:后|之[后内])?/, minutes: 10080 },
      // 十日后 / 十天
      { regex: /[十十](?:日|天)(?:后|之[后内])?/, minutes: 14400 },
      // 半月 / 半个月
      { regex: /半(?:个)?月/, minutes: 21600 },
      // 月余 / 一月 / 一个月
      { regex: /(?:月余|一月|一个月|一[个]?月[之]?[后内])/, minutes: 43200 },
      // 数月 / 几个月
      { regex: /(?:数月|几(?:个)?月)/, minutes: 129600 },
      // 转眼间 / 一转眼的功夫
      { regex: /转眼(?:间|的功夫)?/, minutes: 5 },
      // 这时 / 此刻（无时间推移）
      // v2.4.2 Bugfix: 移除残留的 g 标记（v2.4.1 漏修）
      { regex: /(?:这时|此刻|此时)/, minutes: 0 },
    ];

    let totalMinutes = 0;
    for (const p of patterns) {
      if (p.regex.test(text)) {
        totalMinutes += p.minutes;
      }
    }

    // 查数字 + 天/日/月 模式（如"7天后"、"12天后"）
    const numDayPattern = /(\d+)\s*(?:天|日)(?:后|之[后内])/g;
    let numMatch;
    while ((numMatch = numDayPattern.exec(text)) !== null) {
      const days = parseInt(numMatch[1], 10);
      if (!isNaN(days) && days > 0 && days <= 365) {
        totalMinutes += days * 1440;
      }
    }

    const numMonthPattern = /(\d+)\s*个?月(?:后|之[后内])/g;
    let numMonthMatch;
    while ((numMonthMatch = numMonthPattern.exec(text)) !== null) {
      const months = parseInt(numMonthMatch[1], 10);
      if (!isNaN(months) && months > 0 && months <= 12) {
        totalMinutes += months * 43200;
      }
    }

    return totalMinutes;
  }

  // ---------- 计算本轮世界时间增量 ----------
  function calculateTimeIncrement(evolveResult, chatText, settings) {
    const driveMode = settings.driveMode || 'ai';
    const minutesPerRound = parseInt(settings.minutesPerRound, 10) || 2;
    const smartKeywords = settings.smartKeywords !== false;
    const MIN_KEYWORD = 1;  // 关键词至少贡献 1 分钟（防零）

    if (driveMode === 'ai') {
      // AI 模式：取 AI 返回的时间估算
      const aiEstimate = getAiTimeEstimate(evolveResult);
      if (aiEstimate !== null && aiEstimate > 0) {
        // 与用户设置的 minutesPerRound 取平均，避免 AI 总是给极小值
        return Math.max(1, Math.round((aiEstimate + minutesPerRound) / 2));
      }
      // AI 没给时间，用基准值
      return minutesPerRound;
    }

    // 手动模式
    if (smartKeywords) {
      const kwMinutes = detectTimeKeywords(chatText || '');
      if (kwMinutes > 0) {
        // 关键词匹配到的时间 + 基准分钟取平均
        return Math.max(MIN_KEYWORD, Math.round((kwMinutes + minutesPerRound) / 2));
      }
    }
    return minutesPerRound;
  }

  // ---------- 时间格式化为可读字符串 ----------
  function formatWorldTime(totalMinutes) {
    if (totalMinutes === 0) return '第 0 天 0 小时';
    if (totalMinutes < 0) return '时间错乱';

    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const mins = totalMinutes % 60;

    let result = `第 ${days} 天`;
    if (hours > 0) result += ` ${hours} 小时`;
    if (mins > 0 && hours === 0) result += ` ${mins} 分钟`;
    return result;
  }

  // ---------- 检查是否触发事件链/摘要 ----------
  function shouldTriggerEvents(oldMinutes, newMinutes) {
    const thresholds = [
      // 事件链推进阈值（每 1 世界小时）
      { key: 'events', value: 60 },
      // 章节摘要阈值（每 8 世界小时 ≈ 半天篇章）
      { key: 'chapter', value: 480 },
      // 卷摘要阈值（每 3 世界天）
      { key: 'volume', value: 4320 },
      // 重大事件阈值（每 7 天）
      { key: 'major', value: 10080 },
    ];

    const triggered = [];
    for (const t of thresholds) {
      // 检查 oldMinutes 在阈值以下且 newMinutes 达到或跨过阈值
      // 同时修正倍数检测：如果是同一阈值区间内跨过了倍数（如 120 < 1440 < 2880）
      const oldBlock = Math.floor(oldMinutes / t.value);
      const newBlock = Math.floor(newMinutes / t.value);
      if (newBlock > oldBlock) {
        triggered.push(t.key);
      }
    }

    return triggered;
  }

  return {
    calculateTimeIncrement,
    formatWorldTime,
    shouldTriggerEvents,
    detectTimeKeywords,
    TIME_PRESETS
  };
})();
