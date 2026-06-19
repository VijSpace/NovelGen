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
        name: 'add_volume',
        description: '在项目中添加一个新卷',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '卷的标题' }
          },
          required: ['title']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_chapter',
        description: '在指定卷中添加一个新章节',
        parameters: {
          type: 'object',
          properties: {
            volume_id: { type: 'string', description: '卷的ID' },
            title: { type: 'string', description: '章节标题' }
          },
          required: ['volume_id', 'title']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_chapter',
        description: '写入指定章节的正文内容',
        parameters: {
          type: 'object',
          properties: {
            volume_id: { type: 'string', description: '卷的ID' },
            chapter_id: { type: 'string', description: '章节的ID' },
            content: { type: 'string', description: '章节正文内容（Markdown格式）' }
          },
          required: ['volume_id', 'chapter_id', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_settings',
        description: '更新项目的设定信息',
        parameters: {
          type: 'object',
          properties: {
            overall_summary: { type: 'string', description: '总设定的一句话简介' },
            overall_content: { type: 'string', description: '详细总设定' },
            characters: { type: 'array', items: { type: 'object' }, description: '角色设定数组' }
          }
        }
      }
    }
  ],

  // ==================== 会话管理 ====================
  loadSessions() {
    try {
      this.sessions = JSON.parse(localStorage.getItem('novelwriter_sessions') || '[]');
    } catch { this.sessions = []; }
    this.activeSessionId = localStorage.getItem('novelwriter_active_session') || null;
    const active = this.sessions.find(s => s.id === this.activeSessionId);
    this.messages = active?.messages || [];
  },

  saveSessions() {
    localStorage.setItem('novelwriter_sessions', JSON.stringify(this.sessions));
    localStorage.setItem('novelwriter_active_session', this.activeSessionId || '');
  },

  saveCurrentSession() {
    if (!this.activeSessionId) return;
    const active = this.sessions.find(s => s.id === this.activeSessionId);
    if (active) {
      active.messages = [...this.messages];
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
    localStorage.setItem('novelwriter_active_session', sessionId);
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
    $('#btnSend').disabled = true;
    $('#btnSend').textContent = '生成中...';

    // 构建上下文
    const contextParts = [];
    if (this._sessionFirstMessage) {
      const sysPrompt = App.currentProject?.settings?.systemPrompt || '';
      if (sysPrompt) contextParts.push('【AI角色设定】\n' + sysPrompt);

      if ($('#chkWithSettings').checked && App.currentProject?.settings) {
        const s = App.currentProject.settings;
        contextParts.push('【项目设定】\n总设定：' + (s.overall?.summary || '无') + '\n' + (s.overall?.content || ''));
        if (s.characters?.length > 0) {
          contextParts.push('角色列表：\n' + s.characters.map(c => `- ${c.name}：${c.description || ''}`).join('\n'));
        }
        if (s.volumeArchitecture?.volumes?.length > 0) {
          contextParts.push('分卷架构：\n' + s.volumeArchitecture.volumes.map(v => `- ${v.title}：${v.content || ''}`).join('\n'));
        }
      }

      if ($('#chkWithBook').checked && App.currentProject?.volumes) {
        contextParts.push('【全书结构】');
        App.currentProject.volumes.forEach((vol, vi) => {
          contextParts.push(`第${vi + 1}卷：${vol.title}（id:${vol.id}）`);
          vol.chapters.forEach((ch, ci) => {
            contextParts.push(`  第${ci + 1}章：${ch.title}（id:${ch.id}，${ch.wordCount || 0}字）`);
          });
        });
      }

      if ($('#chkWithChapter').checked && NovelTree.currentChapter) {
        const ch = NovelTree.currentChapter;
        const vol = App.currentProject?.volumes.find(v => v.id === ch.volumeId);
        const chapter = vol?.chapters.find(c => c.id === ch.chapterId);
        if (chapter) {
          contextParts.push(`【当前章节】\n卷：${vol.title}（id:${ch.volumeId}）\n章：${chapter.title}（id:${ch.chapterId}）`);
          if (chapter.content) contextParts.push('当前内容：\n' + chapter.content.substring(0, 2000));
        }
      }
    }

    // 构建用户消息
    let fullUserMsg = userText;
    if (contextParts.length > 0 && this._sessionFirstMessage) {
      fullUserMsg = contextParts.join('\n\n---\n\n') + '\n\n---\n\n用户需求：' + userText;
    }

    // 添加用户消息
    this.messages.push({ role: 'user', content: fullUserMsg });
    this.renderChatHistory();

    const model = $('#modelSelect').value || 'deepseek-chat';

    try {
      // 调用 API
      let response = await API.chat(this.apiKey, this.messages, model, this.tools, this._sessionFirstMessage ? 'auto' : undefined);
      this._sessionFirstMessage = false;

      // 工具调用循环
      let rounds = 0;
      while (response.success && response.data?.tool_calls && rounds < this.maxToolRounds) {
        rounds++;
        this.messages.push({ role: 'assistant', content: response.data.content || '', tool_calls: response.data.tool_calls });

        for (const tc of response.data.tool_calls) {
          const result = await this.executeTool(tc.function.name, JSON.parse(tc.function.arguments));
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }

        response = await API.chat(this.apiKey, this.messages, model, this.tools);
      }

      if (response.success) {
        this.messages.push({ role: 'assistant', content: response.data.content || '' });
      } else {
        this.messages.push({ role: 'assistant', content: '❌ 错误：' + (response.error || '未知错误') });
      }
    } catch (e) {
      this.messages.push({ role: 'assistant', content: '❌ 请求失败：' + e.message });
    }

    this.saveCurrentSession();
    this.renderChatHistory();
    this.isGenerating = false;
    $('#btnSend').disabled = false;
    $('#btnSend').textContent = '发送';
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
        case 'add_volume': {
          const res = await API.addVolume(App.currentProjectId, args.title);
          if (res.success) {
            await App.reloadProject();
            return { success: true, volume_id: res.data.id, message: '卷已创建：' + args.title };
          }
          return { success: false, error: res.error };
        }
        case 'add_chapter': {
          const res = await API.addChapter(App.currentProjectId, args.volume_id, args.title);
          if (res.success) {
            await App.reloadProject();
            return { success: true, chapter_id: res.data.id, message: '章节已创建：' + args.title };
          }
          return { success: false, error: res.error };
        }
        case 'write_chapter': {
          const res = await API.updateChapter(App.currentProjectId, args.volume_id, args.chapter_id, { content: args.content });
          if (res.success) {
            await App.reloadProject();
            const wc = args.content.length;
            return { success: true, word_count: wc, message: `章节内容已写入，共${wc}字` };
          }
          return { success: false, error: res.error };
        }
        case 'update_settings': {
          if (!App.currentProject?.settings) return { success: false, error: '项目未加载' };
          const s = App.currentProject.settings;
          if (args.overall_summary) s.overall.summary = args.overall_summary;
          if (args.overall_content) s.overall.content = args.overall_content;
          if (args.characters) s.characters = args.characters;
          const res = await API.saveSettings(App.currentProjectId, s);
          if (res.success) {
            Settings.load(App.currentProjectId, s);
            return { success: true, message: '设定已更新' };
          }
          return { success: false, error: res.error };
        }
        default:
          return { success: false, error: '未知工具：' + name };
      }
    } catch (e) {
      return { success: false, error: e.message };
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
    for (const msg of this.messages) {
      if (msg.role === 'user') {
        // 只显示用户需求部分
        let display = msg.content;
        const userPart = display.split('用户需求：').pop();
        if (userPart) display = userPart;
        html += `<div class="chat-msg user"><div class="msg-content">${escapeHtml(display)}</div></div>`;
      } else if (msg.role === 'assistant' && msg.content) {
        html += `<div class="chat-msg assistant"><div class="msg-content">${this.formatMsg(msg.content)}</div>`;
        // 如果消息包含正文内容，添加"应用到章节"按钮
        if (msg.content.includes('【正文】') || msg.content.length > 500) {
          html += `<div class="msg-actions">
            <button class="btn btn-xs btn-accent apply-btn" data-action="applyToChapter" data-content="${escapeHtml(extractNovelContent(msg.content))}">📥 添加到章节末尾</button>
            <button class="btn btn-xs btn-accent replace-btn" data-action="replaceChapter" data-content="${escapeHtml(extractNovelContent(msg.content))}">🔄 替换整章</button>
          </div>`;
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
