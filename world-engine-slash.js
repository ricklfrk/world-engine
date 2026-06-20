// world-engine-slash.js — Slash命令注册（完整版 v2.1.0）
// ============================================================
// ★ 修改记录 ★
// 2026-06-05 v2.1.0
//   - 添加 /world 命令（切换面板、状态、手动推演）
//   - 添加 /memory 命令（召回、摘要、统计）
//   - 添加 /engine status 命令（整体状态汇总）
//   - 添加 /engine evolve 命令（手动推演变体）
//   - 增强错误提示和用法说明
//   - 兼容 ST 新旧版本 slash 注册接口
// ============================================================

window.WORLD_ENGINE_SLASH = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const memory = window.WORLD_ENGINE_MEMORY;
  const evolution = window.WORLD_ENGINE_EVOLUTION;
  const ui = window.WORLD_ENGINE_UI;

  // ========== /world ==========
  async function handleWorld(args) {
    const state = core.loadState();
    if (args === 'status') {
      const eventsActive = state.events.filter(e => e.status !== '已爆发').length;
      const eventsErupted = state.events.filter(e => e.status === '已爆发').length;
      return `🌍 **世界状态**\n轮次：${state.round}\n摘要：${state.worldDigest}\n声誉：江湖「${state.reputation.jianghu}」官府「${state.reputation.official}」\n事件链：${eventsActive}个活跃 / ${eventsErupted}个已爆发\n血仇：${state.bloodFeudMemo.length}个\n记忆：${state.memories.length}条 / ${state.chapterSummaries.length}章摘要 / ${state.volumeSummaries.length}卷摘要\n情感实体：${Object.keys(state.emotionMap).length}个`;
    } else if (args === 'evolve' || args === '') {
      // 手动推演
      const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
      const lastMsg = ctx?.chat?.[ctx.chat.length - 1];
      const userMsg = lastMsg?.is_user ? (lastMsg.mes || '') : '';
      const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '') : '';
      const success = await evolution.evolve(state, userMsg, aiMsg);
      if (ui && ui.refresh) ui.refresh();
      return success ? '🔄 手动推演已触发，世界前进了1轮' : '❌ 手动推演失败，世界状态未改变';
    } else if (args === 'toggle') {
      if (ui && ui.togglePanel) {
        ui.togglePanel();
        return '面板已切换';
      }
      return 'UI 模块未加载';
    } else {
      return `🌍 **/world 用法**\n/world — 手动推演一轮\n/world status — 显示世界状态摘要\n/world evolve — 手动推演\n/world toggle — 切换面板`;
    }
  }

  // ========== /memory ==========
  async function handleMemory(args) {
    const state = core.loadState();
    if (!args || args === 'help') {
      return `📚 **/memory 用法**\n/memory recall <关键词> — 按标签召回记忆\n/memory search <关键词> — 智能搜索（同 recall）\n/memory summarize — 合并最近10轮章节摘要\n/memory stats — 记忆统计`;
    }
    if (args.startsWith('recall ') || args.startsWith('search ')) {
      const keyword = args.includes(' ') ? args.slice(args.indexOf(' ') + 1).trim() : '';
      if (!keyword) return '请提供关键词，如 /memory recall 张三';
      const tags = [keyword];
      const recalled = memory.recallMemories(state, tags, 10);
      if (recalled.length === 0) return '未找到相关记忆';
      let result = '📖 **相关记忆**\n';
      for (const m of recalled) {
        result += `[第${m.round}轮] [★${'★'.repeat(Math.min(3, m.importance))}] ${m.summary}\n`;
      }
      return result;
    } else if (args === 'summarize') {
      const lastRound = state.round;
      const start = Math.max(1, lastRound - 9);
      await memory.mergeChapterSummary(state, start, lastRound);
      return `📚 已合并第 ${start}-${lastRound} 轮的章节摘要`;
    } else if (args === 'stats') {
      return `📊 **记忆统计**\n原始记忆：${state.memories.length} 条\n章节摘要：${state.chapterSummaries.length} 条\n卷摘要：${state.volumeSummaries.length} 条\n情感实体：${Object.keys(state.emotionMap).length} 个\n当前轮次：${state.round}`;
    } else {
      return handleMemory('help');
    }
  }

  // ========== /engine ==========
  async function handleEngine(args) {
    if (!args || args === 'help') {
      return `🧠 **World Engine 命令列表**\n/world — 世界推演相关\n/memory — 记忆管理\n/engine status — 显示整体状态\n/engine evolve — 手动推演\n/engine reload — 重启插件`;
    }
    if (args === 'status') {
      return await handleWorld('status');
    }
    if (args === 'evolve') {
      return await handleWorld('evolve');
    }
    if (args === 'reload') {
      window.__WORLD_ENGINE_LOADED__ = false;
      window.location.reload();
      return '正在重新加载...';
    }
    return handleEngine('help');
  }

  // ========== 注册 ==========
  function registerCommands() {
    const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    if (!ctx) {
      console.warn('[World Engine] 无法获取上下文，slash命令未注册');
      return;
    }
    // v2.4.2 Bugfix: 优先使用 registerSlashCommand（旧版 ST 全局函数，可靠），
    // 次选 ctx.slashCommand.register（非标准但部分版本支持），
    // 三方 ctx.SlashCommandParser.addCommandObject（ESM 导入型）暂不支持非 ESM 插件。
    if (typeof registerSlashCommand === 'function') {
      registerSlashCommand('world', handleWorld);
      registerSlashCommand('memory', handleMemory);
      registerSlashCommand('engine', handleEngine);
      console.log('[World Engine] slash命令已注册 (/world, /memory, /engine)');
    } else if (ctx.slashCommand && typeof ctx.slashCommand.register === 'function') {
      ctx.slashCommand.register('world', handleWorld);
      ctx.slashCommand.register('memory', handleMemory);
      ctx.slashCommand.register('engine', handleEngine);
      console.warn('[World Engine] slash命令通过 ctx.slashCommand.register 注册（非标准API）');
    } else {
      console.warn('[World Engine] 未找到slash命令注册接口');
    }
  }

  return { registerCommands };
})();
