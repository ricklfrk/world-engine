// 世界书读取与匹配（完整版，支持多路径检测 + v2.4.0 手动选取 + 条目级选择）
// ============================================================
// ★ 修改记录 ★
// 2026-06-05 v2.1.0
//   - 初始版本：多路径检测 + 全局世界书加载 + 标签匹配
//
// 2026-06-06 v2.4.0
//   - 新增 getAvailableBooks() — 列出所有可用世界书元数据
//   - 新增 getBookEntries() — 获取指定世界书的条目列表
//   - 新增 getActiveEntryMap() / setActiveEntryMap() — storage adapter 持久化用户选择
//   - 新增 filterActiveEntries() — 根据用户选择过滤缓存
//   - matchEntries() 改为从 filterActiveEntries() 结果中匹配
//   - 自动模式兼容：未做选择的用户行为与之前一致（全选）
//
// 2026-06-06 v2.5.1
//   - 新增 fetchAllWorldBooks() — 获取 ST 全部世界书元数据
//   - 新增 getBookSelection() / setBookSelection() / clearBookSelection() — 书级选择持久化
//   - getAvailableBooks() 合并全部世界书库
//   - loadWorldbooks() 加载书级选择中未激活的世界书
//   - filterActiveEntries() 尊重书级选择
// ============================================================

window.WORLD_ENGINE_WORLDBOOK = (function() {
  let cache = [];
  let lastLoadTime = null;
  let bookMetaCache = [];     // 所有可用世界书的元数据 [{ name, source, entryCount }]

  // ---------- 存储键名 ----------
  const SELECTION_KEY = 'world_engine_worldbook_selection';
  const BOOK_SEL_KEY = 'world_engine_wb_books';

  // ---------- 多路径检测世界书 ----------
  function detectWorldbooks(char) {
    const result = [];
    try {
      // 路径1：character_book
      if (char?.data?.character_book) {
        if (typeof char.data.character_book === 'string') result.push(char.data.character_book);
        else if (Array.isArray(char.data.character_book)) result.push(...char.data.character_book);
      }
      // 路径2：extensions.world
      if (char?.data?.extensions?.world) result.push(char.data.extensions.world);
      // 路径3：extensions.world_info
      if (char?.data?.extensions?.world_info) result.push(char.data.extensions.world_info);
      // 路径4：chat_metadata.world_info
      if (char?.chat_metadata?.world_info) result.push(char.chat_metadata.world_info);
    } catch(e) {}
    return [...new Set(result)];
  }

  // ========== v2.4.0：获取所有可用世界书列表 ==========
  async function getAvailableBooks() {
    const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    if (!ctx) return [];

    const books = [];
    const seen = new Set();

    try {
      // 角色绑定世界书
      const char = ctx.characters?.[ctx.characterId];
      const charBookNames = detectWorldbooks(char);
      for (const name of charBookNames) {
        if (!seen.has(name)) {
          seen.add(name);
          const book = await ctx.loadWorldInfo(name);
          const entryCount = book && book.entries ? Object.keys(book.entries).length : 0;
          books.push({ name, source: 'character', entryCount });
        }
      }
    } catch(e) { console.warn('[World Engine WB] 获取角色世界书列表失败', e); }

    try {
      const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : {};
      const resp = await fetch('/api/settings/get', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (resp.ok) {
        const data = await resp.json();
        const settings = JSON.parse(data.settings);
        const globalNames = settings?.world_info_settings?.world_info?.globalSelect || [];
        for (const name of globalNames) {
          if (!seen.has(name)) {
            seen.add(name);
            const book = await ctx.loadWorldInfo(name);
            const entryCount = book && book.entries ? Object.keys(book.entries).length : 0;
            books.push({ name, source: 'global', entryCount });
          }
        }
      }
    } catch(e) { console.warn('[World Engine WB] 获取全局世界书列表失败', e); }

    // v2.5.1：追加全部世界书库（未出现在角色绑定和全局中的）
    try {
      const allBooks = await fetchAllWorldBooks();
      for (const book of allBooks) {
        if (!seen.has(book.name)) {
          seen.add(book.name);
          books.push(book);
        }
      }
    } catch(e) { console.warn('[World Engine WB] 合并世界书库失败', e); }

    bookMetaCache = books;
    return books;
  }

  // ========== v2.5.1：获取 ST 全部世界书元数据（世界书库）==========
  async function fetchAllWorldBooks() {
    const result = [];
    try {
      const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
      const headers = ctx?.getRequestHeaders ? ctx.getRequestHeaders() : {};
      const resp = await fetch('/api/settings/get', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (resp.ok) {
        const data = await resp.json();
        // ST 的 /api/settings/get 接口响应顶层有 world_names 字段，
        // 这是服务端读 data/<user>/worlds/ 目录直接生成的文件名列表
        const worldNames = data.world_names || [];
        for (const name of worldNames) {
          try {
            const book = await ctx.loadWorldInfo(name);
            if (book && book.entries) {
              const entryCount = Object.keys(book.entries)
                .filter(k => !book.entries[k]?.disable).length;
              result.push({ name, source: 'library', entryCount });
            }
          } catch(e) {
            console.warn(`[World Engine WB] 世界书 "${name}" 加载失败:`, e);
          }
        }
      }
    } catch(e) { console.warn('[World Engine WB] 获取全部世界书失败', e); }
    return result;
  }

  // ========== v2.4.0：获取指定世界书的条目列表 ==========
  async function getBookEntries(bookName) {
    const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    if (!ctx) return [];
    try {
      const book = await ctx.loadWorldInfo(bookName);
      if (!book || !book.entries) return [];
      return Object.entries(book.entries)
        .filter(([_, entry]) => !entry.disable)
        .map(([key, entry], index) => ({
          index,
          key,
          comment: entry.comment || entry.content.substring(0, 60) || '',
          tags: entry.keys || [],
          content: entry.content
        }));
    } catch(e) {
      console.warn(`[World Engine WB] 获取世界书条目失败: ${bookName}`, e);
      return [];
    }
  }

  // ========== v2.4.0：读写用户的世界书条目选择 ==========
  function getActiveEntryMap() {
    try {
      const raw = window.WORLD_ENGINE_STORAGE.getItem(SELECTION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // 兼容：如果旧格式是全量简单对象，转换
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch(e) { /* 忽略 */ }
    return null;
  }

  function setActiveEntryMap(selectionMap) {
    // selectionMap 格式：{ "世界书名": { allSelected: true, selectedIndices: [0,1,2] } }
    try {
      window.WORLD_ENGINE_STORAGE.setItem(SELECTION_KEY, JSON.stringify(selectionMap));
      console.log('[World Engine WB] 世界书选择已保存:', Object.keys(selectionMap).length, '本书');
    } catch(e) {
      console.warn('[World Engine WB] 保存世界书选择失败', e);
    }
  }


  // ========== v2.5.1：书级选择持久化 ==========
  function getBookSelection() {
    try {
      const raw = window.WORLD_ENGINE_STORAGE.getItem(BOOK_SEL_KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) { /* 忽略 */ }
    
  return {};
  }

  function setBookSelection(selectionMap) {
    // 格式: { "bookName": true, "bookName2": true }
    try {
      window.WORLD_ENGINE_STORAGE.setItem(BOOK_SEL_KEY, JSON.stringify(selectionMap));
      console.log('[World Engine WB] 书级选择已保存:', Object.keys(selectionMap).length, '本书');
    } catch(e) {
      console.warn('[World Engine WB] 保存书级选择失败', e);
    }
  }

  function clearBookSelection() {
    window.WORLD_ENGINE_STORAGE.removeItem(BOOK_SEL_KEY);
  }

  // ========== v2.4.0 → v2.5.1：根据用户选择过滤缓存（尊重书级选择） ==========
  function filterActiveEntries() {
    if (cache.length === 0) return [];
    const selectionMap = getActiveEntryMap();
    const bookSel = getBookSelection();
    const hasBookSel = Object.keys(bookSel).length > 0;

    if (!selectionMap && !hasBookSel) {
      // 用户从未做过任何选择：返回全部（兼容旧行为）
      return cache;
    }

    // 按世界书名称分组
    const byBook = {};
    for (const entry of cache) {
      if (!byBook[entry.name]) byBook[entry.name] = [];
      byBook[entry.name].push(entry);
    }

    const result = [];
    for (const [bookName, entries] of Object.entries(byBook)) {
      // 书级选择过滤（非空时生效）
      if (hasBookSel) {
        if (!bookSel[bookName]) continue;
      } else if (selectionMap && !selectionMap[bookName]) {
        // 旧行为：有条目级选择但该书未配置 → 不包含
        continue;
      }

      // 条目级选择过滤
      if (selectionMap && selectionMap[bookName]) {
        const sel = selectionMap[bookName];
        if (sel.allSelected === true) {
          result.push(...entries);
        } else if (Array.isArray(sel.selectedIndices) && sel.selectedIndices.length > 0) {
          for (const idx of sel.selectedIndices) {
            if (entries[idx]) result.push(entries[idx]);
          }
        }
      } else {
        // 该书在书级选择中但无条目级配置：包含全部
        result.push(...entries);
      }
    }
    return result;
  }

  // ========== v2.4.0 → v2.5.1：获取活动条目地图（供 UI 渲染使用） ==========
  function getUIState() {
    const selectionMap = getActiveEntryMap() || {};
    const bookSelection = getBookSelection();
    return {
      books: bookMetaCache,
      selection: selectionMap,
      bookSelection: bookSelection
    };
  }

  // ========== 加载世界书 ==========
  async function loadWorldbooks() {
    const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    if (!ctx) return [];
    const entries = [];
    const loadedBooks = new Set();

    // 先获取元数据
    await getAvailableBooks();

    try {
      const char = ctx.characters?.[ctx.characterId];
      const bookNames = detectWorldbooks(char);
      for (const bookName of bookNames) {
        if (loadedBooks.has(bookName)) continue;
        const book = await ctx.loadWorldInfo(bookName);
        if (book && book.entries) {
          for (const [key, entry] of Object.entries(book.entries)) {
            if (!entry.disable) {
              entries.push({
                source: 'character',
                name: bookName,
                content: entry.content,
                tags: entry.keys || [],
                comment: entry.comment || '',
                key: key
              });
            }
          }
          loadedBooks.add(bookName);
        }
      }
    } catch(e) { console.warn('角色世界书加载失败', e); }

    try {
      const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : {};
      const resp = await fetch('/api/settings/get', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (resp.ok) {
        const data = await resp.json();
        const settings = JSON.parse(data.settings);
        const globalNames = settings?.world_info_settings?.world_info?.globalSelect || [];
        for (const name of globalNames) {
          if (loadedBooks.has(name)) continue;
          const book = await ctx.loadWorldInfo(name);
          if (book && book.entries) {
            for (const [key, entry] of Object.entries(book.entries)) {
              if (!entry.disable) {
                entries.push({
                  source: 'global',
                  name: name,
                  content: entry.content,
                  tags: entry.keys || [],
                  comment: entry.comment || '',
                  key: key
                });
              }
            }
            loadedBooks.add(name);
          }
        }
      }
    } catch(e) { console.warn('全局世界书加载失败', e); }

    // v2.5.1：加载书级选择中选中的、但尚未加载的世界书
    try {
      const bookSel = getBookSelection();
      const selectedNames = Object.keys(bookSel).filter(k => bookSel[k]);
      for (const bookName of selectedNames) {
        if (loadedBooks.has(bookName)) continue;
        const book = await ctx.loadWorldInfo(bookName);
        if (book && book.entries) {
          for (const [key, entry] of Object.entries(book.entries)) {
            if (!entry.disable) {
              entries.push({
                source: 'user_selected',
                name: bookName,
                content: entry.content,
                tags: entry.keys || [],
                comment: entry.comment || '',
                key: key
              });
            }
          }
          loadedBooks.add(bookName);
        }
      }
    } catch(e) { console.warn('[World Engine WB] 加载用户选中世界书失败', e); }

    // v2.6.1：加载条目级选择中涉及的、但尚未加载的世界书
    try {
      const entryMap = getActiveEntryMap();
      const bookSel = getBookSelection();
      if (entryMap) {
        for (const [bookName, sel] of Object.entries(entryMap)) {
          // 已通过 bookSel 加载的书跳过
          if (bookSel && bookSel[bookName]) continue;
          if (loadedBooks.has(bookName)) continue;
          // 仅有关联索引的书才加载
          if (sel && Array.isArray(sel.selectedIndices) && sel.selectedIndices.length > 0) {
            const book = await ctx.loadWorldInfo(bookName);
            if (book && book.entries) {
              for (const [key, entry] of Object.entries(book.entries)) {
                if (!entry.disable) {
                  entries.push({
                    source: 'partial',
                    name: bookName,
                    content: entry.content,
                    tags: entry.keys || [],
                    comment: entry.comment || '',
                    key: key
                  });
                }
              }
              loadedBooks.add(bookName);
            }
          }
        }
      }
    } catch(e) { console.warn('[World Engine WB] 加载部分选择世界书失败', e); }

    cache = entries;
    lastLoadTime = new Date();

    // 初始化用户选择（如果从未设置过）
    const existingSelection = getActiveEntryMap();
    if (!existingSelection) {
      const defaultMap = {};
      for (const meta of bookMetaCache) {
        defaultMap[meta.name] = { allSelected: true, selectedIndices: [] };
      }
      setActiveEntryMap(defaultMap);
    }

    console.log(`[World Engine Worldbook] 加载完成，共 ${entries.length} 个条目，${bookMetaCache.length} 本书`);
    return entries;
  }

  // ========== 匹配条目（v2.4.0：使用 filterActiveEntries 替代直接 cache） ==========
  function matchEntries(tags, maxCount = 5) {
    const active = filterActiveEntries();
    if (active.length === 0) return [];
    const scored = active.map(entry => {
      let score = 0;
      const lowerContent = entry.content.toLowerCase();
      for (const tag of tags) {
        const lowerTag = tag.toLowerCase();
        if (entry.tags.some(t => t.toLowerCase().includes(lowerTag) || lowerTag.includes(t.toLowerCase()))) score += 2;
        if (lowerContent.includes(lowerTag)) score += 1;
      }
      
  return { entry, score };
    });
    scored.sort((a,b) => b.score - a.score);
    return scored.slice(0, maxCount).map(s => s.entry.content);
  }

  // ========== 调试：输出世界书状态 ==========
  window.WORLD_ENGINE_DEBUG_WORLDBOOK = () => {
    console.log('=== World Engine Worldbook Debug ===');
    console.log('总条目数:', cache.length);
    console.log('可用世界书:', bookMetaCache.map(b => `${b.name}(${b.source}, ${b.entryCount}条)`));
    console.log('最后加载时间:', lastLoadTime);
    const activeEntries = filterActiveEntries();
    console.log('活跃条目数:', activeEntries.length);
    const bySource = cache.reduce((acc, e) => {
      acc[e.source] = (acc[e.source] || 0) + 1;
      return acc;
    }, {});
    console.log('来源统计:', bySource);
    console.log('前5个条目:', cache.slice(0,5).map(e => ({ name: e.name, tags: e.tags.slice(0,3), content_preview: e.content.substring(0,50) })));
  };

  // ========== v2.6.0: 世界书 AI 分析 ==========
  async function analyzeWorldbooks(bookNames) {
    if (!bookNames || !Array.isArray(bookNames) || bookNames.length === 0) return null;
    var allContent = '';
    for (var bi = 0; bi < bookNames.length; bi++) {
      var entries = await getBookEntries(bookNames[bi]);
      if (!entries || entries.length === 0) continue;
      for (var ej = 0; ej < entries.length; ej++) {
        if (allContent.length >= 8000) break;
        if (allContent.length > 0) allContent += '\n---\n';
        allContent += entries[ej].content;
      }
      if (allContent.length >= 8000) break;
    }
    if (!allContent || !allContent.trim()) return null;
    var core2 = window.WORLD_ENGINE_CORE;
    var tmplList = '';
    if (core2 && core2.STORY_TEMPLATES) {
      for (var ti = 0; ti < core2.STORY_TEMPLATES.length; ti++) {
        tmplList += (ti > 0 ? ', ' : '') + core2.STORY_TEMPLATES[ti].name;
      }
    }
    var toneList = '';
    if (core2 && core2.EMOTIONAL_TONES) {
      for (var tni = 0; tni < core2.EMOTIONAL_TONES.length; tni++) {
        toneList += (tni > 0 ? ', ' : '') + core2.EMOTIONAL_TONES[tni].name;
      }
    }
    var promptText = '你是一个擅长分析故事世界观的专家。请分析以下世界设定内容，完成：\n';
    promptText += '1. 从以下故事模板中推荐最匹配的3个（含匹配度百分比和理由）：\n';
    promptText += tmplList + '\n\n';
    promptText += '2. 推荐2个情感基调：\n';
    promptText += toneList + '\n\n';
    promptText += '3. 用100字以内概括这个世界的核心基调\n\n';
    promptText += '4. 推荐世界法则维度值（从以下维度中选最匹配的值）：\n';
    promptText += '   - 魔力浓度：无/低/中等/高/极高\n';
    promptText += '   - 科技水平：原始/中世纪/文艺复兴/工业革命/现代/科幻\n';
    promptText += '   - 超自然存在：无/罕见/常见/丰富\n';
    promptText += '   - 统治形态：封建制/帝国制/共和制/宗门统治/无政府\n';
    promptText += '   - 核心冲突：生存/战争/求知/权力/爱恨/自由\n';
    promptText += '   - 自然环境：极寒/酷热/温带/沙漠/海洋/丛林/多样\n';
    promptText += '5. 推荐 2-3 条自定义世界规则\n';
    promptText += '6. 推导 2-3 条世界约束（禁止出现什么、必须遵守什么）\n\n';
    promptText += '世界书内容：\n' + allContent.substring(0, 8000) + '\n\n';
    promptText += '请返回严格JSON格式：\n';
    promptText += '{\n  "recommendations": [{ "templateId": "...", "matchRate": 85, "reason": "..." }],\n  "recommendedToneIds": ["...", "..."],\n  "worldSummary": "...",\n  "worldLawRecommendation": {\n    "dimensions": { "magic": { "value": "高", "reason": "..." } },\n    "customRuleSuggestions": ["规则1", "规则2"],\n    "constraints": ["约束1", "约束2"]\n  }\n}';
    try {
      var evolution = window.WORLD_ENGINE_EVOLUTION;
      var rawResult;
      if (evolution && typeof evolution.callApi === 'function') {
        rawResult = await evolution.callApi(promptText, 1500, 0.5);
      } else {
        return null;
      }
      var content = rawResult.trim();
      content = content.replace(/```json/g, '').replace(/```/g, '').trim();
      var result = null;
      try {
        result = JSON.parse(content);
      } catch (e) {
        var match = content.match(/\{[\s\S]*\}/);
        if (match) {
          try { result = JSON.parse(match[0]); } catch (e2) { return null; }
        } else {
          return null;
        }
      }
      if (!result.recommendations) result.recommendations = [];
      if (!result.recommendedToneIds) result.recommendedToneIds = [];
      if (!result.worldSummary) result.worldSummary = '';
      return result;
    } catch (e) {
      console.warn('[World Engine WB] analyzeWorldbooks 调用失败', e);
      return null;
    }
  }

  // ========== v2.6.1: 分析手动输入的文字 ==========
  async function analyzeText(rawText) {
    if (!rawText || !rawText.trim()) return null;
    var text = rawText.trim();
    if (text.length > 8000) text = text.substring(0, 8000) + '\n...(截断)';

    var prompt = '你需要分析以下世界设定描述，然后返回 JSON。\n\n';
    prompt += '【用户描述内容】\n' + text + '\n\n';
    prompt += '【任务】\n';
    prompt += '1. 用一句话概括这个世界的核心基调（中文，30字内）\n';
    prompt += '2. 从以下 12 个故事模板中选择最匹配的 3 个，按匹配度从高到低排列，给出匹配百分比和理由：\n';
    prompt += '  - hero_journey（英雄之旅）：平凡→冒险→试炼→蜕变→归来\n';
    prompt += '  - tragedy（悲剧）：高洁者因缺陷走向毁灭\n';
    prompt += '  - comedy（喜剧）：误会丛生→巧妙化解→圆满收场\n';
    prompt += '  - rags_to_riches（白手起家）：无名小卒走向巅峰\n';
    prompt += '  - voyage_and_return（远行与归来）：进入陌生世界→带回智慧\n';
    prompt += '  - overcoming_monster（战胜怪物）：直面巨大威胁并击败\n';
    prompt += '  - rebirth（重生）：黑暗枷锁中获得救赎\n';
    prompt += '  - mystery（悬疑解密）：谜团浮现→反转不断→真相大白\n';
    prompt += '  - underdog（逆袭）：不被看好者在关键时刻证明自己\n';
    prompt += '  - love_story（爱情故事）：相遇→吸引→阻碍→分离→重逢\n';
    prompt += '  - fall_and_redemption（堕落与救赎）：堕落→苦难→觉醒→救赎\n';
    prompt += '  - love_triangle（三角纠葛）：三人之间的情感抉择\n';
    prompt += '3. 从以下情感基调中选择最匹配的 2 个基调：passionate（热血激荡）、warm（温馨治愈）、dark（黑暗压抑）、humorous（幽默诙谐）、suspense（悬疑紧张）、sorrow（哀伤悲怆）、peaceful（宁静淡泊）、epic（史诗壮阔）\n';
    prompt += '4. 推荐世界法则维度值（从以下维度中选最匹配的值）：\n';
    prompt += '   - 魔力浓度：无/低/中等/高/极高\n';
    prompt += '   - 科技水平：原始/中世纪/文艺复兴/工业革命/现代/科幻\n';
    prompt += '   - 超自然存在：无/罕见/常见/丰富\n';
    prompt += '   - 统治形态：封建制/帝国制/共和制/宗门统治/无政府\n';
    prompt += '   - 核心冲突：生存/战争/求知/权力/爱恨/自由\n';
    prompt += '   - 自然环境：极寒/酷热/温带/沙漠/海洋/丛林/多样\n';
    prompt += '5. 推荐 2-3 条自定义世界规则\n';
    prompt += '6. 推导 2-3 条世界约束（禁止出现什么、必须遵守什么）\n\n';
    prompt += '\n请严格返回 JSON 格式：{"worldSummary": "...","recommendations": [{"templateId": "...","matchRate": 85,"reason": "..."}],"recommendedToneIds": ["...","..."],"worldLawRecommendation": {"dimensions": {"magic": {"value": "高","reason": "..."}},"customRuleSuggestions": ["规则1", "规则2"],"constraints": ["约束1", "约束2"]}}';

    try {
      var evolution = window.WORLD_ENGINE_EVOLUTION;
      var apiFn = null;
      if (evolution && typeof evolution.callApi === 'function') {
        apiFn = function(p) { return evolution.callApi(p, { stream: false, temperature: 0.7, max_tokens: 1500 }); };
      } else if (typeof callApi === 'function') {
        apiFn = callApi;
      }
      if (!apiFn) return null;
      var response = await apiFn(prompt);
      var textResponse = (typeof response === 'string') ? response : (response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) || '';
      var jsonMatch = textResponse.match(/\{[\s\S]*"worldSummary"[\s\S]*\}/);
      if (jsonMatch) {
        var parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.worldSummary) parsed.worldSummary = '分析完成';
        if (!parsed.recommendations) parsed.recommendations = [];
        if (!parsed.recommendedToneIds) parsed.recommendedToneIds = [];
        return parsed;
      }
      return { worldSummary: '分析完成（无法解析 AI 返回）', recommendations: [], recommendedToneIds: [] };
    } catch(e) {
      console.warn('[World Engine WB] analyzeText 调用失败', e);
      return null;
    }
  }

  
  return {
    loadWorldbooks,
    matchEntries,
    getCache: () => cache,
    getLastLoadTime: () => lastLoadTime,
    // v2.4.0 新 API
    getAvailableBooks,
    getBookEntries,
    getActiveEntryMap,
    setActiveEntryMap,
    filterActiveEntries,
    getUIState,
    // v2.5.1 新 API
    fetchAllWorldBooks,
    getBookSelection,
    setBookSelection,
    clearBookSelection,
    analyzeWorldbooks,
    analyzeText
  };
})();
