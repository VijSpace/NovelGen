// ==================== Agent 组件 ====================
const Agent = {
  apiKey: localStorage.getItem('novelwriter_apikey') || '',
  messages: [],
  isGenerating: false,
  maxToolRounds: 5,
  lastRawRequest: null,
  _sessionFirstMessage: true,
  sessions: [],
  activeSessionId: null,

  // ==================== 工具定义 ====================
  tools: [
    {
      type: 'function',
      function: {
        name: 'write_current_chapter',
        description: '生成/重写当前章节正文。先调 get_context("settings") 取设定，get_context("chapter_detail") 看当前内容，需要参考全文结构调 get_context("book_structure")。调用后内容自动写入编辑器。',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '完整章节正文（纯文本小说格式，不要Markdown标记，自然段落分行即可），会覆盖当前章节的全部内容' },
            summary: { type: 'string', description: '本章一句话摘要（可选），用于更新章节目录显示' }
          },
          required: ['content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'replace_selection',
        description: '替换编辑器中用户选中文字。先调 get_context("chapter_detail") 理解全文语境再改写。',
        parameters: {
          type: 'object',
          properties: {
            new_text: { type: 'string', description: '替换后的新文本（只替换选中部分，不改其他内容）' },
            original_hint: { type: 'string', description: '简要说明你替换了哪段文字，方便用户确认（如"开头的景色描写"）' }
          },
          required: ['new_text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_setting',
        description: '增量修改项目设定。先调 get_context("settings") 查看现有设定再决定如何修改。',
        parameters: {
          type: 'object',
          properties: {
            type_name: { type: 'string', description: '设定类型名，如"总设定""角色设定""世界观"，不存在则自动创建' },
            action: { type: 'string', enum: ['add', 'modify', 'delete'], description: 'add=新增条目, modify=修改条目, delete=删除条目' },
            entry_name: { type: 'string', description: '条目名。add时必填，modify/delete时用于匹配已有条目' },
            description: { type: 'string', description: '条目描述内容。add/modify时填写' }
          },
          required: ['type_name', 'action', 'entry_name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_volume',
        description: '添加一个新卷。用于规划全书结构时创建分卷。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '卷名，如"第一卷：启程"' }
          },
          required: ['title']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_chapter',
        description: '在指定卷中添加新章节。可指定卷的序号（0开始）或省略则添加到最后一卷。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '章节标题，如"第三章：初遇"' },
            volume_index: { type: 'integer', description: '卷序号（0=第一卷,1=第二卷...），省略则添加到最后一卷' }
          },
          required: ['title']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_context',
        description: '按需拉取上下文。生成章节→settings+chapter_detail(含精确提示)或book_structure，修改章节→chapter_detail(含精确提示)，改设定→settings。可多次调用。',
        parameters: {
          type: 'object',
          properties: {
            what: { type: 'string', enum: ['settings', 'book_structure', 'current_chapter', 'chapter_detail'], description: 'settings=所有设定, book_structure=全书卷章结构, current_chapter=当前章节摘要+精确提示, chapter_detail=精确提示+当前章节完整内容' }
          },
          required: ['what']
        }
      }
    }
  ],

  // ==================== 会话管理 ====================
  _sessionsKey() { return 'novelwriter_sessions'; },
  _activeKey() { return 'novelwriter_active_session'; },

  loadSessions() {
    try {
      this.sessions = JSON.parse(localStorage.getItem(this._sessionsKey()) || '[]');
    } catch { this.sessions = []; }
    // 修复旧格式 tool_calls（缺 type 字段）
    for (const s of this.sessions) {
      for (const m of (s.messages || [])) {
        if (m.tool_calls) {
          m.tool_calls = m.tool_calls.map(tc => ({ type: 'function', ...tc }));
        }
      }
    }
    this.activeSessionId = localStorage.getItem(this._activeKey()) || null;
    const active = this.sessions.find(s => s.id === this.activeSessionId);
    this.messages = active?.messages || [];
    this._sessionFirstMessage = this.messages.length === 0;
  },

  saveSessions() {
    localStorage.setItem(this._sessionsKey(), JSON.stringify(this.sessions));
    localStorage.setItem(this._activeKey(), this.activeSessionId || '');
  },

  saveCurrentSession() {
    if (!this.activeSessionId) return;
    const active = this.sessions.find(s => s.id === this.activeSessionId);
    if (active) {
      // 保存时去掉内部字段
      active.messages = this.messages.map(m => {
        const { _streaming, _thinking, _pendingActions, ...clean } = m;
        return clean;
      });
      if (active.messages.length > 0 && active.name === '新会话') {
        const firstUser = active.messages.find(m => m.role === 'user');
        if (firstUser?.content) {
          const userPart = firstUser.content.split('用户需求：').pop() || firstUser.content;
          active.name = userPart.substring(0, 30) || '新会话';
        }
      }
      this.saveSessions();
    }
  },

  createSession() {
    const id = 'sess_' + Date.now();
    this.sessions.push({ id, name: '新会话', messages: [], createdAt: Date.now() });
    this.activeSessionId = id;
    this.messages = [];
    this._sessionFirstMessage = true;
    this.saveSessions();
    this.renderSessionList();
    return id;
  },

  switchSession(sessionId) {
    this.activeSessionId = sessionId;
    const s = this.sessions.find(s => s.id === sessionId);
    this.messages = s?.messages || [];
    this._sessionFirstMessage = this.messages.length === 0;
    localStorage.setItem(this._activeKey(), sessionId);
    this.renderChatHistory();
    this.renderSessionList();
  },

  deleteSession(sessionId) {
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    if (this.activeSessionId === sessionId) {
      if (this.sessions.length > 0) {
        this.switchSession(this.sessions[0].id);
      } else {
        this.createSession();
        this.renderChatHistory();
      }
    }
    this.saveSessions();
    this.renderSessionList();
  },

  renderSessionList() {
    const list = $('#sessionList');
    if (!list) return;
    list.innerHTML = this.sessions.map(s => {
      const label = s.name || '新会话';
      const date = new Date(s.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const activeClass = s.id === this.activeSessionId ? ' active' : '';
      const msgCount = (s.messages || []).length;
      return `<div class="session-item${activeClass}" data-sid="${s.id}">
        <span class="session-item-icon">💬</span>
        <span class="session-item-label">
          <span class="name">${escapeHtml(label)}</span>
          <span class="date">${date} · ${msgCount}条消息</span>
        </span>
        <span class="session-actions">
          <button class="act-delete danger" title="删除" data-sid="${s.id}">🗑</button>
        </span>
      </div>`;
    }).join('');
  },

  // ==================== 初始化 ====================
  init() {
    this.loadSessions();
    if (!this.activeSessionId || this.sessions.length === 0) {
      this.createSession();
    }

    // API Key
    const savedKey = localStorage.getItem('novelwriter_apikey');
    if (savedKey) {
      $('#apiKeyInput').value = savedKey;
      $('#apiKeyStatus').textContent = '✅ 已保存';
    }

    // 会话列表切换
    $('#btnToggleSessions').addEventListener('click', () => {
      const list = $('#sessionList');
      list.style.display = list.style.display === 'none' ? '' : 'none';
      if (list.style.display !== 'none') this.renderSessionList();
    });

    $('#btnNewChat').addEventListener('click', () => {
      this.createSession();
      this.renderChatHistory();
    });

    // 会话列表点击
    $('#sessionList').addEventListener('click', (e) => {
      const item = e.target.closest('.session-item');
      const delBtn = e.target.closest('.act-delete');
      if (delBtn) {
        e.stopPropagation();
        this.deleteSession(delBtn.dataset.sid);
        this.renderChatHistory();
        this.renderSessionList();
        return;
      }
      if (item) {
        this.switchSession(item.dataset.sid);
      }
    });

    // API Key 操作
    $('#btnApiKeyToggle').addEventListener('click', () => {
      const panel = $('#apiKeyPanel');
      panel.style.display = panel.style.display === 'none' ? '' : 'none';
    });

    $('#btnSaveApiKey').addEventListener('click', () => {
      const key = $('#apiKeyInput').value.trim();
      if (!key) { $('#apiKeyStatus').textContent = '❌ 不能为空'; return; }
      this.apiKey = key;
      localStorage.setItem('novelwriter_apikey', key);
      $('#apiKeyStatus').textContent = '✅ 已保存';
      $('#apiKeyPanel').style.display = 'none';
    });

    // 发送按钮
    $('#btnSend').addEventListener('click', () => this.sendMessage());

    // 停止按钮
    $('#btnStop').addEventListener('click', () => this.stopGeneration());

    // 模型选择记忆
    const modelSelect = $('#modelSelect');
    if (modelSelect) {
      modelSelect.value = localStorage.getItem('novelwriter_model') || 'deepseek-v4-pro';
      modelSelect.addEventListener('change', () => {
        localStorage.setItem('novelwriter_model', modelSelect.value);
      });
    }

    // Enter 发送
    $('#chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.renderSessionList();
    this.renderChatHistory();
  },

  // ==================== 消息发送 ====================
  async sendMessage() {
    const input = $('#chatInput');
    const userText = input.value.trim();
    if (!userText || this.isGenerating) return;
    input.value = '';

    if (!this.apiKey) {
      const saved = localStorage.getItem('novelwriter_apikey');
      if (saved) this.apiKey = saved;
      else { showAlert('请先设置 API Key'); return; }
    }

    this.isGenerating = true;
    this._abortCtrl = new AbortController();
    $('#btnSend').disabled = true;
    $('#btnSend').textContent = '生成中...';
    $('#btnStop').style.display = '';

    // 构建上下文
    const contextParts = [];
    // 告诉 AI 在哪个项目
    if (App.currentProject?.name) {
      contextParts.push(`【当前项目】《${App.currentProject.name}》`);
    }
    if (this._sessionFirstMessage) {
      const sysPrompt = App.currentProject?.settings?.systemPrompt || '';
      if (sysPrompt) contextParts.push('【AI角色设定】\n' + sysPrompt);
    }

    // 每次都告诉 AI 当前编辑的章节和选中文字
    if (NovelTree.currentChapter) {
      const ch = NovelTree.currentChapter;
      const vol = App.currentProject?.volumes.find(v => v.id === ch.volumeId);
      const chapter = vol?.chapters.find(c => c.id === ch.chapterId);
      if (chapter) {
        contextParts.push(`【你正在编辑】第${App.currentProject.volumes.indexOf(vol) + 1}卷《${vol.title}》→ ${chapter.title}（${chapter.wordCount || 0}字）`);
        const sel = $('#chapterEditor');
        if (sel && sel.selectionStart !== sel.selectionEnd) {
          const selected = sel.value.substring(sel.selectionStart, sel.selectionEnd);
          contextParts.push(`【用户选中文字】\n${selected.substring(0, 500)}`);
        }
      }
    }

    let fullUserMsg = userText;
    if (contextParts.length > 0 && this._sessionFirstMessage) {
      fullUserMsg = contextParts.join('\n\n---\n\n') + '\n\n---\n\n用户需求：' + userText;
    }

    this.messages.push({ role: 'user', content: fullUserMsg });
    this.renderChatHistory();

    const model = $('#modelSelect').value || 'deepseek-v4-pro';

    try {
      // 流式 + 工具调用
      await this._sendStreamWithTools(model);
    } catch (e) {
      if (e.name !== 'AbortError') {
        this.messages.push({ role: 'assistant', content: '❌ 请求失败：' + e.message });
      }
    }

    this.saveCurrentSession();
    this.renderChatHistory();
    this.isGenerating = false;
    this._abortCtrl = null;
    $('#btnSend').disabled = false;
    $('#btnSend').textContent = '发送';
    $('#btnStop').style.display = 'none';
  },

  // 流式 + 工具调用
  async _sendStreamWithTools(model) {
    const pendingActions = [];
    // 清理消息格式：去掉内部字段 + tool_calls 确保有 type
    let messages = this.messages.map(m => {
      const { _streaming, _thinking, _pendingActions, ...clean } = m;
      if (clean.tool_calls) {
        clean.tool_calls = clean.tool_calls.map(tc => ({ ...tc, type: 'function' }));
      }
      return clean;
    });

    for (let round = 0; round <= this.maxToolRounds; round++) {
      // 添加空消息占位
      const placeholder = { role: 'assistant', content: '', _streaming: true, _thinking: '' };
      this.messages.push(placeholder);
      this.renderChatHistory();
      const msgIdx = this.messages.length - 1;

      let content = '', thinking = '';
      let toolCalls = [];  // 累积 tool_calls
      let lastRender = 0;

      try {
        for await (const chunk of API.chatStream(this.apiKey, messages, model, this.tools, round === 0 ? 'auto' : undefined, this._abortCtrl?.signal)) {
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.reasoning_content) {
            thinking += delta.reasoning_content;
            this.messages[msgIdx]._thinking = thinking;
          }
          if (delta.content) {
            content += delta.content;
            this.messages[msgIdx].content = content;
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index || 0;
              if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
            }
          }

          // 节流渲染
          const now = Date.now();
          if (now - lastRender > 50) {
            lastRender = now;
            this._renderStreamingMsg(msgIdx);
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          this.messages[msgIdx].content = content || '（已停止生成）';
        } else {
          this.messages[msgIdx].content = content || ('❌ ' + e.message);
        }
      }

      this.messages[msgIdx]._streaming = false;

      // 检查是否有工具调用
      const validToolCalls = toolCalls.filter(tc => tc?.function?.name);
      if (validToolCalls.length > 0) {
        // 更新消息内容（工具调用前的文字 + 工具调用标记）
        this.messages[msgIdx].content = content;
        this.messages[msgIdx].tool_calls = validToolCalls;

        // 执行工具
        for (const tc of validToolCalls) {
          const result = await this.executeTool(tc.function.name, JSON.parse(tc.function.arguments));
          if (result.pending) {
            pendingActions.push({ name: tc.function.name, args: result.args, message: result.message });
          }
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }

        // 继续下一轮（清理格式）
        messages = this.messages.map(m => {
          const { _streaming, _thinking, _pendingActions, ...clean } = m;
          if (clean.tool_calls) clean.tool_calls = clean.tool_calls.map(tc => ({ ...tc, type: 'function' }));
          return clean;
        });
        this._sessionFirstMessage = false;
        continue;
      }

      // 没有工具调用：最终消息
      if (!content && thinking) {
        this.messages[msgIdx].content = '（已完成思考）';
      }
      if (pendingActions.length > 0) {
        this.messages[msgIdx]._pendingActions = pendingActions;
      }
      break;
    }
  },

  // 只更新单条消息的 DOM（流式输出用）
  _renderStreamingMsg(idx) {
    const msg = this.messages[idx];
    if (!msg) return;
    const container = $('#chatMessages');
    let el = container.querySelector(`.chat-msg[data-idx="${idx}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'chat-msg assistant';
      el.dataset.idx = idx;
      container.appendChild(el);
    }
    let html = '';
    if (msg._thinking) {
      html += `<details class="thinking-block" open><summary>💭 思考过程</summary><div class="thinking-content">${this.formatMsg(msg._thinking)}</div></details>`;
    }
    if (msg.content) {
      html += `<div class="msg-content">${this.formatMsg(msg.content)}</div>`;
    } else if (msg._streaming) {
      html += `<div class="msg-content"><span class="streaming-cursor"></span></div>`;
    }
    el.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  },

  stopGeneration() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  },

  sendSelectedText(selectedText) {
    if (!this.activeSessionId) this.createSession();
    const prompt = `请对以下选中的文字进行修改润色：\n\n${selectedText}\n\n请直接返回修改后的版本。`;
    $('#chatInput').value = prompt;
    this._sessionFirstMessage = false;
  },

  // ==================== 工具执行 ====================
  async executeTool(name, args) {
    try {
      switch (name) {
        case 'write_current_chapter': {
          const ch = NovelTree.currentChapter;
          if (!ch) return { success: false, error: '请先在左侧目录中选择一个章节' };
          await API.updateChapter(App.currentProjectId, ch.volumeId, ch.chapterId, { content: args.content });
          // 同步更新内存中的项目数据
          const vol = App.currentProject.volumes.find(v => v.id === ch.volumeId);
          const chapter = vol?.chapters.find(c => c.id === ch.chapterId);
          if (chapter) {
            chapter.content = args.content;
            chapter.wordCount = args.content.length;
            if (args.summary) chapter.summary = args.summary;
          }
          // 更新编辑器显示
          const editor = $('#chapterEditor');
          if (editor) editor.value = args.content;
          $('#chapterWordCount').textContent = `${args.content.length}字`;
          App.pushHistory();
          NovelTree.render(App.currentProject);
          return { success: true, word_count: args.content.length, message: `章节已写入，共${args.content.length}字` };
        }
        case 'replace_selection': {
          const editor = $('#chapterEditor');
          if (!editor || editor.style.display === 'none') return { success: false, error: '当前没有打开的章节编辑器' };
          const start = editor.selectionStart;
          const end = editor.selectionEnd;
          if (start === end) return { success: false, error: '请先在编辑器中选中一段文字' };
          // 不直接修改，返回待确认
          return { success: true, pending: true, action: 'replace_selection',
            args: { new_text: args.new_text, hint: args.original_hint || '', start, end },
            message: `替换建议已生成（${args.original_hint || '选中文字'}），共${args.new_text.length}字，请确认` };
        }
        case 'update_setting': {
          if (!App.currentProject?.settings) return { success: false, error: '项目未加载' };
          return { success: true, pending: true, action: 'update_setting',
            args: { type_name: args.type_name, action: args.action, entry_name: args.entry_name, description: args.description },
            message: `设定修改建议已生成（${args.type_name}/${args.action}），请确认` };
        }
        case 'add_volume': {
          const res = await API.addVolume(App.currentProjectId, args.title);
          if (res.success) {
            await App.reloadProject();
            App.pushHistory();
            return { success: true, volume_id: res.data.id, message: '卷已创建：' + args.title };
          }
          return { success: false, error: res.error };
        }
        case 'add_chapter': {
          const vols = App.currentProject.volumes;
          if (!vols || vols.length === 0) return { success: false, error: '请先创建至少一个卷' };
          const vi = (args.volume_index !== undefined) ? args.volume_index : (vols.length - 1);
          const vol = vols[vi];
          if (!vol) return { success: false, error: `卷序号${vi}不存在，共${vols.length}个卷（序号0~${vols.length - 1}）` };
          const res = await API.addChapter(App.currentProjectId, vol.id, args.title);
          if (res.success) {
            NovelTree.expandedVolumes.add(vol.id);
            await App.reloadProject();
            App.pushHistory();
            NovelTree.selectChapter(App.currentProjectId, vol.id, res.data.id);
            return { success: true, chapter_id: res.data.id, message: '章节已创建：' + args.title };
          }
          return { success: false, error: res.error };
        }
        case 'get_context': {
          const w = args.what;
          if (w === 'settings') {
            const types = App.currentProject?.settings?.settingTypes || [];
            let txt = types.map(st => {
              return `[${st.name}]\n` + (st.entries || []).map(e => `- ${e.name}：${e.description || '无'}`).join('\n');
            }).join('\n\n');
            return { success: true, message: txt || '（暂无设定）' };
          }
          if (w === 'book_structure') {
            const vols = App.currentProject?.volumes || [];
            let txt = vols.map((vol, vi) => {
              let s = `第${vi + 1}卷：${vol.title}（${vol.chapters.length}章）`;
              vol.chapters.forEach((ch, ci) => { s += `\n  第${ci + 1}章：${ch.title}（${ch.wordCount || 0}字）`; });
              return s;
            }).join('\n');
            return { success: true, message: txt || '（暂无卷章）' };
          }
          if (w === 'current_chapter') {
            const nc = NovelTree.currentChapter;
            if (!nc) return { success: true, message: '（未打开任何章节）' };
            const vol = App.currentProject?.volumes.find(v => v.id === nc.volumeId);
            const ch = vol?.chapters.find(c => c.id === nc.chapterId);
            if (!ch) return { success: true, message: '（未找到）' };
            let msg = `第${App.currentProject.volumes.indexOf(vol) + 1}卷《${vol.title}》→ ${ch.title}（${ch.wordCount || 0}字）`;
            if (ch.prompt) msg += `\n【用户精确提示】${ch.prompt}`;
            return { success: true, message: msg };
          }
          if (w === 'chapter_detail') {
            const nc = NovelTree.currentChapter;
            if (!nc) return { success: true, message: '（未打开任何章节）' };
            const vol = App.currentProject?.volumes.find(v => v.id === nc.volumeId);
            const ch = vol?.chapters.find(c => c.id === nc.chapterId);
            let msg = '';
            if (ch?.prompt) msg += `【用户精确提示】${ch.prompt}\n\n`;
            msg += ch?.content ? ch.content.substring(0, 4000) : '（章节为空）';
            return { success: true, message: msg };
          }
          return { success: false, error: '未知上下文类型：' + w };
        }
        default:
          return { success: false, error: '未知工具：' + name };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // 执行单个待确认操作
  applyPendingActionSingle(pa) {
    try {
      if (pa.name === 'replace_selection') {
        const editor = $('#chapterEditor');
        if (!editor) return;
        editor.value = editor.value.substring(0, pa.args.start) + pa.args.new_text + editor.value.substring(pa.args.end);
        App.saveCurrentChapter();
      } else if (pa.name === 'update_setting') {
        const types = App.currentProject.settings.settingTypes || [];
        let type = types.find(t => t.name === pa.args.type_name);
        if (!type) {
          type = { id: 'type_' + Date.now(), name: pa.args.type_name, icon: '📌', entries: [] };
          types.push(type);
        }
        if (pa.args.action === 'delete') {
          type.entries = type.entries.filter(e => e.name !== pa.args.entry_name);
        } else if (pa.args.action === 'modify') {
          const entry = type.entries.find(e => e.name === pa.args.entry_name);
          if (entry) entry.description = pa.args.description;
          else type.entries.push({ id: 'e_' + Date.now(), name: pa.args.entry_name, description: pa.args.description });
        } else {
          type.entries.push({ id: 'e_' + Date.now(), name: pa.args.entry_name, description: pa.args.description });
        }
        API.saveSettings(App.currentProjectId, App.currentProject.settings);
        Settings.load(App.currentProjectId, App.currentProject.settings);
        App.pushHistory();
      }
    } catch (e) {
      console.error('applyPendingAction error:', e);
    }
  },

  // ==================== UI 渲染 ====================
  renderChatHistory() {
    const container = $('#chatMessages');
    if (!container) return;

    if (this.messages.length === 0) {
      container.innerHTML = `<div class="chat-welcome">
        <p>👋 你好！我是你的 AI 写作助手</p>
        <p>在左侧选择章节并填入「精确提示」后，我可以帮你生成或改写内容</p>
        <p>你也可以直接让我修改选中的文本段落</p>
      </div>`;
      return;
    }

    let html = '';
    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      if (msg._streaming) continue;  // 流式消息由 _renderStreamingMsg 处理
      if (msg.role === 'user') {
        let display = msg.content;
        const userPart = display.split('用户需求：').pop();
        if (userPart) display = userPart;
        html += `<div class="chat-msg user"><div class="msg-content">${escapeHtml(display)}</div></div>`;
      } else if (msg.role === 'assistant' && msg.content) {
        html += `<div class="chat-msg assistant" data-idx="${i}">`;
        if (msg._thinking) {
          html += `<details class="thinking-block"><summary>💭 思考过程</summary><div class="thinking-content">${this.formatMsg(msg._thinking)}</div></details>`;
        }
        html += `<div class="msg-content">${this.formatMsg(msg.content)}</div>`;
        // 待确认的操作按钮（合并为一个）
        if (msg._pendingActions) {
          html += `<div class="msg-actions">`;
          const hasReplace = msg._pendingActions.some(pa => pa.name === 'replace_selection');
          const hasSetting = msg._pendingActions.some(pa => pa.name === 'update_setting');
          if (hasReplace) html += `<button class="pending-apply-btn" data-idx="${i}" data-action="apply-replace">📝 应用替换</button>`;
          if (hasSetting) html += `<button class="pending-apply-btn" data-idx="${i}" data-action="apply-setting">⚙️ 应用设定</button>`;
          html += `</div>`;
        }
        html += `</div>`;
      } else if (msg.role === 'tool') {
        // 工具结果不显示
      }
    }

    container.innerHTML = html;

    // 绑定应用按钮
    container.querySelectorAll('.apply-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        App.applyToChapter(btn.dataset.content);
      });
    });
    container.querySelectorAll('.replace-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        App.replaceChapter(btn.dataset.content);
      });
    });
    // 待确认操作按钮（一次应用所有同类操作）
    container.querySelectorAll('.pending-apply-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const action = btn.dataset.action;
        const msg = this.messages[idx];
        if (!msg?._pendingActions) return;
        if (action === 'apply-replace') {
          msg._pendingActions.filter(pa => pa.name === 'replace_selection').forEach(pa => this.applyPendingActionSingle(pa));
        } else if (action === 'apply-setting') {
          msg._pendingActions.filter(pa => pa.name === 'update_setting').forEach(pa => this.applyPendingActionSingle(pa));
        }
        btn.textContent = '✅ 已应用';
        btn.disabled = true;
      });
    });

    container.scrollTop = container.scrollHeight;
  },

  formatMsg(text) {
    // 简单Markdown渲染
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }
};
