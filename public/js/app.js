// ==================== 主应用 ====================
const App = {
  currentProject: null,
  currentProjectId: null,
  _autoSaveTimer: null,
  _autoSaveInterval: 60,
  _isDirty: false,
  _historyStack: [],     // 项目级撤销栈（WPS 风格：全量 JSON 快照）
  _historyIndex: -1,
  _historyMax: 50,

  async init() {
    if (typeof window.electronAPI === 'undefined') {
      await DB.init();
    } else {
      try {
        const settings = await window.electronAPI.getSettings();
        if (settings.autoSaveInterval) {
          this._autoSaveInterval = settings.autoSaveInterval;
        }
        const dataPath = await window.electronAPI.getDataPath();
        $('#saveStatus').textContent = '📁 ' + dataPath;
        $('#saveStatus').title = '数据存储路径（硬盘文件，永不丢失）';
      } catch (e) { /* 忽略 */ }
    }

    NovelTree.init();
    Settings.init();
    Agent.init();
    this.initDarkMode();

    this.bindEvents();
    this.initSplitters();
    this.initChatResizer();

    await this.loadProjectList();
  },

  // ========== 欢迎页 ==========
  _showWelcome(show) {
    const welcome = $('#welcomeView');
    const tabs = $('#centerTabs');
    const contents = $$('.tab-content');
    if (welcome) welcome.style.display = show ? '' : 'none';
    if (tabs) tabs.style.display = show ? 'none' : '';
    contents.forEach(c => c.style.display = show ? 'none' : '');
    if (!show) {
      const novelView = $('#novelView');
      if (novelView) novelView.classList.add('active');
      const tabBtns = $$('.tab-btn');
      tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === 'novelView'));
    }
  },

  // ========== 面板拖拽 ==========
  initSplitters() {
    const savedLeft = localStorage.getItem('novelwriter_leftWidth');
    const savedRight = localStorage.getItem('novelwriter_rightWidth');
    if (savedLeft) $('#leftPanel').style.width = savedLeft + 'px';
    if (savedRight) $('#rightPanel').style.width = savedRight + 'px';

    this.setupSplitter('splitterLeft', 'leftPanel', 160, 500, false);
    this.setupSplitter('splitterRight', 'rightPanel', 260, 600, true);
  },

  setupSplitter(splitterId, targetId, minW, maxW, reverse) {
    const splitter = $('#' + splitterId);
    const target = $('#' + targetId);
    let startX, startW;

    splitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = target.offsetWidth;
      splitter.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (e) => {
        const dx = reverse ? startX - e.clientX : e.clientX - startX;
        let newW = startW + dx;
        newW = Math.max(minW, Math.min(maxW, newW));
        target.style.width = newW + 'px';
      };

      const onUp = () => {
        splitter.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        localStorage.setItem('novelwriter_' + (targetId === 'leftPanel' ? 'leftWidth' : 'rightWidth'), target.offsetWidth);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  },

  bindEvents() {
    $('#projectSelect').addEventListener('change', (e) => this.openProject(e.target.value));
    $('#btnNewProject').addEventListener('click', () => this.createProject());
    $('#btnRenameProject').addEventListener('click', () => this.renameProject());
    $('#btnImport').addEventListener('click', () => this.openImportDialog());
    $('#btnExport').addEventListener('click', () => this.exportNovel());
    $('#btnSettings').addEventListener('click', () => this.openSettingsDialog());
    $('#btnDarkMode').addEventListener('click', () => this.toggleDarkMode());

    // 欢迎页按钮
    const wnp = $('#welcomeNewProject');
    const wi = $('#welcomeImport');
    if (wnp) wnp.addEventListener('click', () => this.createProject());
    if (wi) wi.addEventListener('click', () => this.openImportDialog());

    this.initTreeClick();

    $('#centerPanel').addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.tab-btn');
      if (tabBtn) {
        const tabName = tabBtn.dataset.tab;
        $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
        $$('.tab-content').forEach(c => c.classList.toggle('active', c.id === tabName));
        if (tabName === 'settingsView') {
          Settings.load(this.currentProjectId, this.currentProject?.settings);
        }
        // 记住最后使用的标签页
        if (this.currentProjectId) {
          localStorage.setItem(`novelwriter_last_tab_${this.currentProjectId}`, tabName);
        }
      }
    });

    $('#btnSaveChapter').addEventListener('click', () => this.saveCurrentChapter());
    $('#btnSendToAgent').addEventListener('click', () => this.sendSelectedToAgent());
    $('#btnFillChat')?.addEventListener('click', () => this.fillChatInput());
    $('#btnDeleteProject')?.addEventListener('click', () => this.deleteProject());
    $('#btnPromptToggle').addEventListener('click', () => this.togglePromptBody());

    const markDirty = () => { this._isDirty = true; this.updateDirtyIndicator(); };
    $('#chapterTitle').addEventListener('input', markDirty);
    $('#chapterEditor').addEventListener('input', () => { markDirty(); });

    // Ctrl+Z：撤销 / Ctrl+Y 或 Ctrl+Shift+Z：重做
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.saveCurrentChapter();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) this.redoProject(); else this.undoProject();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        this.redoProject();
      }
    });
  },

  // ========== 项目管理 ==========
  async loadProjectList() {
    let res;
    try {
      res = await API.getProjects();
    } catch (e) {
      console.error('loadProjectList error:', e);
      res = { success: false, error: e.message };
    }
    const select = $('#projectSelect');
    select.innerHTML = '<option value="">选择项目...</option>';
    if (res.success && res.data && res.data.length > 0) {
      res.data.forEach(p => {
        select.innerHTML += `<option value="${p.id}">📁 ${escapeHtml(p.name)}</option>`;
      });
      const lastId = localStorage.getItem('novelwriter_last_project');
      const target = (lastId && res.data.find(p => p.id === lastId)) ? lastId : res.data[0].id;
      select.value = target;
      this.openProject(target);
    } else {
      // 无项目时显示欢迎引导
      console.log('No projects found, showing welcome. Error:', res?.error);
      this._showWelcome(true);
    }
  },

  async createProject() {
    const name = await showPrompt('请输入项目名称：', '我的小说');
    if (!name) return;
    const res = await API.createProject(name);
    if (res.success) {
      // 直接加入下拉列表并切换
      const select = $('#projectSelect');
      select.innerHTML += `<option value="${res.data.id}">📁 ${escapeHtml(name)}</option>`;
      select.value = res.data.id;
      await this.openProject(res.data.id);
    } else {
      await showAlert('创建失败：' + res.error);
    }
  },

  async openProject(id) {
    if (!id) {
      $('#btnRenameProject').style.display = 'none';
      this._showWelcome(true);
      return;
    }
    this._showWelcome(false);
    this.stopAutoSave();

    this.currentProjectId = id;
    localStorage.setItem('novelwriter_last_project', id);
    this._historyStack = [];  // 切换项目时清空历史
    this._historyIndex = -1;

    if (isElectron) {
      try {
        const backup = await window.electronAPI.checkAutosave(id);
        if (backup && backup.newer) {
          const recover = await showConfirm(
            '检测到未保存的自动备份（可能是上次异常退出导致）。\n\n是否恢复到自动备份版本？\n备份时间：' + new Date(backup.data.updated).toLocaleString('zh-CN')
          );
          if (recover) {
            this.currentProject = await window.electronAPI.recoverAutosave(id);
            this.setSaveStatus('🔄 已从备份恢复');
          } else {
            await window.electronAPI.clearAutosave(id);
          }
        }
      } catch (e) { /* 忽略 */ }
    }

    const res = await API.getProject(id);
    if (res.success) {
      // 如果没从备份恢复，就用 API 返回的数据
      if (!this.currentProject || this.currentProject.id !== id) this.currentProject = res.data;
      $('#btnDeleteProject').style.display = '';
      $('#btnRenameProject').style.display = '';
      NovelTree.render(this.currentProject);
      Settings.load(id, this.currentProject.settings);
      this.resetChapterView();
      const lastChId = localStorage.getItem(`novelwriter_last_chapter_${id}`);
      const firstVol = this.currentProject.volumes?.[0];
      const firstCh = firstVol?.chapters?.[0];
      let targetCh = null;
      if (lastChId && firstVol) {
        targetCh = firstVol.chapters?.find(c => c.id === lastChId);
      }
      if (!targetCh) targetCh = firstCh;
      if (targetCh) {
        NovelTree.selectChapter(id, firstVol.id, targetCh.id);
      }
      // 确保历史栈已初始化（即使没有章节）
      if (this._historyStack.length === 0) {
        this._historyStack = [JSON.stringify(this.currentProject)];
        this._historyIndex = 0;
      }

      // 恢复上次退出时的标签页
      const lastTab = localStorage.getItem(`novelwriter_last_tab_${id}`);
      if (lastTab && lastTab !== 'novelView') {
        $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === lastTab));
        $$('.tab-content').forEach(c => c.classList.toggle('active', c.id === lastTab));
        if (lastTab === 'settingsView') {
          Settings.load(id, this.currentProject.settings);
        }
      }

      this.startAutoSave();
      this.setSaveStatus('📂 已加载');
    }
  },

  setSaveStatus(text, persistent) {
    const el = $('#saveStatus');
    el.textContent = text;
    if (!persistent) {
      clearTimeout(this._statusTimeout);
      this._statusTimeout = setTimeout(() => {
        if (this._isDirty) {
          this.updateDirtyIndicator();
        } else {
          el.textContent = '💾 已保存';
        }
      }, 2000);
    }
  },

  updateDirtyIndicator() {
    const el = $('#saveStatus');
    if (this._isDirty) {
      el.textContent = '● 未保存';
      el.style.color = 'var(--accent)';
    } else {
      el.textContent = '💾 已保存';
      el.style.color = '';
    }
  },

  // ========== 自动保存（WPS 风格） ==========

  startAutoSave() {
    this.stopAutoSave();
    this._isDirty = false;
    this.updateDirtyIndicator();
    this._autoSaveTimer = setInterval(() => {
      this.autoSaveTick();
    }, this._autoSaveInterval * 1000);
  },

  stopAutoSave() {
    if (this._autoSaveTimer) {
      clearInterval(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }
  },

  async autoSaveTick() {
    if (!this._isDirty || !this.currentProjectId || !isElectron) return;
    try {
      const ch = NovelTree.currentChapter;
      if (ch) {
        const vol = this.currentProject.volumes.find(v => v.id === ch.volumeId);
        const chapter = vol?.chapters.find(c => c.id === ch.chapterId);
        if (chapter) {
          chapter.title = $('#chapterTitle').value.trim();
          chapter.content = $('#chapterEditor').value;
          chapter.prompt = $('#chapterPrompt').value;
          chapter.wordCount = chapter.content.length;
          chapter.updated = new Date().toISOString();
          $('#chapterWordCount').textContent = `${chapter.wordCount}字`;
        }
      }
      this.currentProject.updated = new Date().toISOString();
      await window.electronAPI.autosaveProject(this.currentProject);
      this.setSaveStatus('🔄 已自动备份 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      console.error('自动保存失败:', e);
    }
  },

  // ========== 设置对话框（含提示词+快捷键） ==========

  _defaultSysPrompt: `你是一位资深小说作家，能够直接操控小说项目。你可以使用工具来创建卷章、写入内容、管理人物和设定。

核心原则：
1. 用情节和对话传达主题，展示而非讲述
2. 主动使用工具来完成用户的请求——不要只给建议，直接执行
3. 写章节正文前，先确保卷章的结构和设定，根据需要提取上下文
4. 修改设定或人物后，简要说明改了什么
5. 章节正文使用纯文本小说格式，不要Markdown标记（不用**、#、*等），自然段落分行即可`,

  _shortcutList: [
    { key: 'Ctrl+S', desc: '保存当前章节' },
    { key: 'Ctrl+Z', desc: '撤销（项目级）' },
    { key: 'Ctrl+Y / Ctrl+Shift+Z', desc: '重做（项目级）' },
    { key: 'Ctrl+B', desc: '加粗选中文字' },
    { key: 'Ctrl+I', desc: '斜体选中文字' },
  ],

  async openSettingsDialog() {
    if (!isElectron) {
      // 浏览器模式：只显示提示词和快捷键
      const html = this._buildSettingsHTML('prompt');
      const close = showModal('⚙️ 设置', html, `<button class="btn btn-sm btn-primary" id="modalClose">关闭</button>`);
      this._bindSettingsEvents(close);
      document.getElementById('modalClose').onclick = () => close();
      return;
    }

    const settings = await window.electronAPI.getSettings();
    const currentPath = settings.dataPath || '';

    const bodyHtml = `
      <div class="settings-tabs" id="settingsTabs">
        <button class="settings-tab-btn active" data-stab="general">⚙️ 通用</button>
        <button class="settings-tab-btn" data-stab="prompt">📝 提示词</button>
        <button class="settings-tab-btn" data-stab="shortcuts">⌨️ 快捷键</button>
      </div>
      <div class="settings-tab-content active" id="stab-general">
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px">📁 数据存储路径</label>
            <div style="display:flex;gap:6px">
              <input type="text" id="settingDataPath" value="${escapeHtml(currentPath)}" style="flex:1;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border-light);border-radius:4px;padding:6px 10px;font-size:13px" readonly>
              <button class="btn btn-sm" id="btnBrowseFolder">📂 浏览</button>
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin-top:4px">修改后，已有项目需要手动迁移到新路径</p>
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px">⏱ 自动保存间隔（秒）</label>
            <input type="number" id="settingAutoSaveInterval" value="${settings.autoSaveInterval || 60}" min="10" max="600" style="width:100px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border-light);border-radius:4px;padding:6px 10px;font-size:13px">
            <p style="font-size:11px;color:var(--text-muted);margin-top:4px">默认60秒，最短10秒，最长600秒</p>
          </div>
        </div>
      </div>
      <div class="settings-tab-content" id="stab-prompt">
        <div style="margin-top:12px">
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:6px">定义AI扮演的角色、写作风格和核心原则，将在每次发送消息时作为System Prompt发送给AI</p>
          <textarea id="settingSysPrompt" rows="14" style="width:100%;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border-light);border-radius:4px;padding:10px;font-size:13px;font-family:inherit;resize:vertical"></textarea>
          <div style="margin-top:8px;display:flex;gap:8px">
            <button class="btn btn-sm" id="btnResetSysPrompt">🔄 恢复默认</button>
          </div>
        </div>
      </div>
      <div class="settings-tab-content" id="stab-shortcuts">
        <div style="margin-top:12px">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="border-bottom:2px solid var(--border)"><th style="text-align:left;padding:8px 12px;color:var(--text-muted)">快捷键</th><th style="text-align:left;padding:8px 12px;color:var(--text-muted)">功能</th></tr></thead>
            <tbody>${this._shortcutList.map(s => `<tr style="border-bottom:1px solid var(--border-light)"><td style="padding:8px 12px"><kbd style="background:var(--bg-tertiary);padding:2px 8px;border-radius:3px;font-size:12px;border:1px solid var(--border)">${escapeHtml(s.key)}</kbd></td><td style="padding:8px 12px;color:var(--text-secondary)">${escapeHtml(s.desc)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;

    const close = showModal(
      '⚙️ 设置',
      bodyHtml,
      `<button class="btn btn-sm" id="modalCancel">取消</button>
       <button class="btn btn-sm btn-primary" id="modalOk">保存</button>`
    );

    this._bindSettingsEvents(close);

    // 填充提示词
    const savedPrompt = this.currentProject?.settings?.systemPrompt || '';
    const promptEl = document.getElementById('settingSysPrompt');
    if (promptEl) promptEl.value = savedPrompt || this._defaultSysPrompt;

    document.getElementById('btnBrowseFolder').onclick = async () => {
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        document.getElementById('settingDataPath').value = folder;
      }
    };

    document.getElementById('btnResetSysPrompt').onclick = () => {
      document.getElementById('settingSysPrompt').value = this._defaultSysPrompt;
    };

    document.getElementById('modalOk').onclick = async () => {
      const newPath = document.getElementById('settingDataPath').value.trim();
      const newInterval = parseInt(document.getElementById('settingAutoSaveInterval').value) || 60;
      const clampedInterval = Math.max(10, Math.min(600, newInterval));
      const newSysPrompt = document.getElementById('settingSysPrompt').value;

      await window.electronAPI.setSettings({
        dataPath: newPath,
        autoSaveInterval: clampedInterval
      });

      // 保存提示词到当前项目
      if (this.currentProjectId && newSysPrompt) {
        if (!this.currentProject.settings) this.currentProject.settings = {};
        this.currentProject.settings.systemPrompt = newSysPrompt;
        await API.saveSettings(this.currentProjectId, this.currentProject.settings);
      }

      this._autoSaveInterval = clampedInterval;
      if (this.currentProjectId) {
        this.startAutoSave();
      }

      const dp = await window.electronAPI.getDataPath();
      $('#saveStatus').textContent = '📁 ' + dp;

      close();
      this.setSaveStatus('✅ 设置已保存');
    };

    document.getElementById('modalCancel').onclick = () => { close(); };
  },

  _buildSettingsHTML(activeTab) {
    const savedPrompt = this.currentProject?.settings?.systemPrompt || '';
    return `
      <div class="settings-tabs" id="settingsTabs">
        <button class="settings-tab-btn ${activeTab === 'prompt' ? 'active' : ''}" data-stab="prompt">📝 提示词</button>
        <button class="settings-tab-btn ${activeTab === 'shortcuts' ? 'active' : ''}" data-stab="shortcuts">⌨️ 快捷键</button>
      </div>
      <div class="settings-tab-content ${activeTab === 'prompt' ? 'active' : ''}" id="stab-prompt">
        <div style="margin-top:12px">
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:6px">定义AI扮演的角色、写作风格和核心原则</p>
          <textarea id="settingSysPrompt" rows="14" style="width:100%;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border-light);border-radius:4px;padding:10px;font-size:13px;font-family:inherit;resize:vertical">${escapeHtml(savedPrompt || this._defaultSysPrompt)}</textarea>
          <div style="margin-top:8px;display:flex;gap:8px">
            <button class="btn btn-sm" id="btnResetSysPrompt">🔄 恢复默认</button>
            <button class="btn btn-sm btn-primary" id="btnSaveSysPrompt">💾 保存提示词</button>
          </div>
        </div>
      </div>
      <div class="settings-tab-content ${activeTab === 'shortcuts' ? 'active' : ''}" id="stab-shortcuts">
        <div style="margin-top:12px">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="border-bottom:2px solid var(--border)"><th style="text-align:left;padding:8px 12px;color:var(--text-muted)">快捷键</th><th style="text-align:left;padding:8px 12px;color:var(--text-muted)">功能</th></tr></thead>
            <tbody>${this._shortcutList.map(s => `<tr style="border-bottom:1px solid var(--border-light)"><td style="padding:8px 12px"><kbd style="background:var(--bg-tertiary);padding:2px 8px;border-radius:3px;font-size:12px;border:1px solid var(--border)">${escapeHtml(s.key)}</kbd></td><td style="padding:8px 12px;color:var(--text-secondary)">${escapeHtml(s.desc)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
  },

  _bindSettingsEvents(close) {
    // 标签切换
    const tabs = document.querySelectorAll('#settingsTabs .settings-tab-btn');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const targetId = 'stab-' + btn.dataset.stab;
        document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
        const target = document.getElementById(targetId);
        if (target) target.classList.add('active');
      });
    });

    // 浏览器模式下保存提示词
    const saveBtn = document.getElementById('btnSaveSysPrompt');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const newSysPrompt = document.getElementById('settingSysPrompt').value;
        if (this.currentProjectId && newSysPrompt) {
          if (!this.currentProject.settings) this.currentProject.settings = {};
          this.currentProject.settings.systemPrompt = newSysPrompt;
          await API.saveSettings(this.currentProjectId, this.currentProject.settings);
          this.setSaveStatus('✅ 提示词已保存');
        }
        if (close) close();
      };
    }

    // 恢复默认提示词
    const resetBtn = document.getElementById('btnResetSysPrompt');
    if (resetBtn) {
      resetBtn.onclick = () => {
        document.getElementById('settingSysPrompt').value = this._defaultSysPrompt;
      };
    }
  },

  // ==================== ⋮ 菜单 ====================
  handleMoreClick(btn, e) {
    e.preventDefault();
    e.stopPropagation();
    const menu = $('#ctxMenu');
    this._moreTarget = btn;
    menu.innerHTML = btn.dataset.more === 'volume'
      ? `<div data-act="renameVol" style="padding:7px 16px;cursor:pointer;font-size:13px">✏️ 重命名</div><div style="height:1px;background:var(--border);margin:4px 8px"></div><div data-act="delVol" style="padding:7px 16px;cursor:pointer;font-size:13px;color:var(--accent)">🗑 删除卷</div>`
      : `<div data-act="renameCh" style="padding:7px 16px;cursor:pointer;font-size:13px">✏️ 重命名</div><div style="height:1px;background:var(--border);margin:4px 8px"></div><div data-act="delCh" style="padding:7px 16px;cursor:pointer;font-size:13px;color:var(--accent)">🗑 删除章</div>`;
    const r = btn.getBoundingClientRect();
    Object.assign(menu.style, { display:'block', left:Math.min(r.right,innerWidth-150)+'px', top:Math.min(r.bottom,innerHeight-120)+'px' });
  },

  initTreeClick() {
    const menu = $('#ctxMenu');

    document.addEventListener('click', async (e) => {
      const mi = e.target.closest?.('[data-act]') || (e.target.nodeType===3 ? e.target.parentElement?.closest?.('[data-act]') : null);
      if (mi && this._moreTarget) {
        e.preventDefault();
        const act = mi.dataset.act;
        const vid = this._moreTarget.dataset.volId;
        const chId = this._moreTarget.dataset.chId;
        menu.style.display = 'none';
        const t = this._moreTarget; this._moreTarget = null;

        if (act === 'delVol') { if (await showConfirm('确定删除此卷及其中所有章节？')) { await API.deleteVolume(this.currentProjectId, vid); await this.reloadProject(); this.pushHistory(); this.setSaveStatus('🗑 卷已删除'); } }
        else if (act === 'delCh') { if (await showConfirm('确定删除这一章？')) { await API.deleteChapter(this.currentProjectId, vid, chId); await this.reloadProject(); this.pushHistory(); this.setSaveStatus('🗑 章已删除'); } }
        else if (act === 'renameVol') { this.renameVolume(vid); }
        else if (act === 'renameCh') { this.renameChapter(vid, chId); }
        return;
      }

      const treeAct = (e.target.closest?.('[data-action]')) || (e.target.nodeType===3 ? e.target.parentElement?.closest?.('[data-action]') : null);
      if (treeAct && $('#novelTree').contains(treeAct)) {
        const a = treeAct.dataset.action;
        if (a === 'toggleVol') {
          const icon = treeAct.querySelector('.expand-icon');
          const list = treeAct.nextElementSibling;
          const vid = treeAct.dataset.volId;
          const isOpen = icon.classList.toggle('expanded');
          if (list) list.style.display = isOpen ? '' : 'none';
          if (isOpen) NovelTree.expandedVolumes.add(vid);
          else NovelTree.expandedVolumes.delete(vid);
        }
        else if (a === 'selectChapter') { NovelTree.selectChapter(this.currentProjectId, treeAct.dataset.volId, treeAct.dataset.chId); }
        else if (a === 'addVolume') { this.addVolume(); }
        else if (a === 'addChapter') { this.addChapter(treeAct.dataset.volId); }
        return;
      }

      if (!e.target.closest?.('#ctxMenu')) menu.style.display = 'none';
    });
  },

  async addVolume() {
    if (!this.currentProjectId) return showAlert('请先选择项目');
    const title = `第${(this.currentProject.volumes?.length || 0) + 1}卷`;
    const res = await API.addVolume(this.currentProjectId, title);
    if (res.success) { await this.reloadProject(); this.pushHistory(); }
  },

  async renameVolume(volId) {
    const vol = this.currentProject.volumes.find(v => v.id === volId);
    if (!vol) return;
    const title = await showPrompt('新卷名：', vol.title);
    if (!title) return;
    const res = await API.renameVolume(this.currentProjectId, volId, title);
    if (res.success) {
      await this.reloadProject();
      this.pushHistory();
      this.setSaveStatus('✅ 卷已重命名');
    }
  },

  async addChapter(volId) {
    if (!this.currentProjectId) return;
    const vol = this.currentProject.volumes.find(v => v.id === volId);
    const title = `第${(vol?.chapters?.length || 0) + 1}章`;
    const res = await API.addChapter(this.currentProjectId, volId, title);
    if (res.success) {
      const newChId = res.data.id;
      NovelTree.expandedVolumes.add(volId);  // 展开父卷
      await this.reloadProject();
      this.pushHistory();
      NovelTree.selectChapter(this.currentProjectId, volId, newChId);
    }
  },

  async renameChapter(volId, chId) {
    const vol = this.currentProject.volumes.find(v => v.id === volId);
    const ch = vol?.chapters.find(c => c.id === chId);
    if (!ch) return;
    const title = await showPrompt('新章节名：', ch.title);
    if (!title) return;
    const res = await API.renameChapter(this.currentProjectId, volId, chId, title);
    if (res.success) {
      await this.reloadProject();
      this.pushHistory();
      this.setSaveStatus('✅ 章节已重命名');
    }
  },

  async loadChapterContent(projectId, volumeId, chapterId) {
    const vol = this.currentProject.volumes.find(v => v.id === volumeId);
    const ch = vol?.chapters.find(c => c.id === chapterId);
    if (!ch) return;

    $('#novelViewHeader').style.display = 'none';
    $('#novelViewToolbar').style.display = 'flex';
    $('#chapterPromptBar').style.display = 'block';
    $('#chapterTitle').value = ch.title;
    $('#chapterPrompt').value = ch.prompt || '';
    $('#chapterEditor').style.display = 'block';
    $('#chapterEditor').value = ch.content || '';
    $('#chapterPreview').style.display = 'none';
    $('#chapterWordCount').textContent = `${ch.wordCount || ch.content?.length || 0}字`;

    // 首次打开项目时初始化历史栈
    if (this._historyStack.length === 0) {
      this._historyStack = [JSON.stringify(this.currentProject)];
      this._historyIndex = 0;
    }

    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'novelView'));
    $$('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'novelView'));

    NovelTree.render(this.currentProject);
  },

  resetChapterView() {
    $('#novelViewHeader').style.display = 'none';
    $('#novelViewToolbar').style.display = 'none';
    $('#chapterPromptBar').style.display = 'none';
    $('#chapterEditor').style.display = 'none';
    $('#chapterEditor').value = '';
    $('#chapterPreview').style.display = 'block';
    $('#chapterPreview').textContent = '请从左侧选择章节';
  },

  async saveCurrentChapter() {
    const ch = NovelTree.currentChapter;
    if (!ch || !this.currentProjectId) return;
    const title = $('#chapterTitle').value.trim();
    const content = $('#chapterEditor').value;
    const prompt = $('#chapterPrompt').value;
    const wordCount = content.length;
    $('#chapterWordCount').textContent = `${wordCount}字`;

    await API.updateChapter(this.currentProjectId, ch.volumeId, ch.chapterId, {
      title, content, wordCount, prompt
    });
    const vol = this.currentProject.volumes.find(v => v.id === ch.volumeId);
    const chapter = vol?.chapters.find(c => c.id === ch.chapterId);
    if (chapter) {
      chapter.title = title;
      chapter.content = content;
      chapter.prompt = prompt;
      chapter.wordCount = wordCount;
    }
    this.pushHistory();  // WPS 风格：保存后快照
    this._isDirty = false;
    this.updateDirtyIndicator();
    if (isElectron) {
      try { await window.electronAPI.clearAutosave(this.currentProjectId); } catch (e) { /* 忽略 */ }
    }
    this.setSaveStatus('💾 已保存');
  },

  sendSelectedToAgent() {
    const editor = $('#chapterEditor');
    const selected = editor.value.substring(editor.selectionStart, editor.selectionEnd);
    if (!selected) {
      showAlert('请先在编辑器中选中一段文字');
      return;
    }
    Agent.sendSelectedText(selected);
  },

  togglePromptBody() {
    const panel = $('#promptPanel');
    const arrow = $('.prompt-arrow');
    if (panel.classList.contains('open')) {
      panel.classList.remove('open');
      arrow.textContent = '▶';
    } else {
      panel.classList.add('open');
      arrow.textContent = '▼';
      const bar = $('.chapter-prompt-bar');
      const ta = $('#chapterPrompt');
      if (bar && ta) {
        ta.style.width = (bar.offsetWidth - 14) + 'px';
      }
    }
  },

  fillChatInput() {
    const promptText = $('#chapterPrompt').value.trim();
    if (!promptText) { showAlert('请先输入本章的精确提示'); return; }
    const fullPrompt = `请根据设定和精确提示生成本章正文，2000-4000字，场景+对话展开。\n\n【精确提示】\n${promptText}\n\n请严格按以下格式回复：\n【正文】\n{生成的章节正文}\n【/正文】\n【说明】\n{简要说明本章的写作思路和重点，一两句话即可}\n【/说明】`;
    $('#chatInput').value = fullPrompt;
    $('#chkWithSettings').checked = true;
    $('#chkWithChapter').checked = true;
    Agent._sessionFirstMessage = true;
    this.setSaveStatus('📤 提示已填入AI输入框');
  },

  // ========== 夜间模式 ==========
  initDarkMode() {
    const saved = localStorage.getItem('novelwriter_darkmode');
    if (saved === '1') {
      document.documentElement.setAttribute('data-theme', 'dark');
      $('#btnDarkMode').textContent = '☀️';
    }
  },

  toggleDarkMode() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      $('#btnDarkMode').textContent = '🌙';
      localStorage.setItem('novelwriter_darkmode', '0');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      $('#btnDarkMode').textContent = '☀️';
      localStorage.setItem('novelwriter_darkmode', '1');
    }
  },

  async deleteProject() {
    if (!this.currentProjectId) return;
    if (!await showConfirm('确定删除项目「' + this.currentProject.name + '」？此操作不可撤销！')) return;
    this.stopAutoSave();
    if (isElectron) {
      try { await window.electronAPI.clearAutosave(this.currentProjectId); } catch (e) { /* 忽略 */ }
    }
    await API.deleteProject(this.currentProjectId);
    this.currentProject = null; this.currentProjectId = null;
    this._isDirty = false;
    await this.loadProjectList();
    $('#projectSelect').value = '';
    $('#btnDeleteProject').style.display = 'none';
    NovelTree.render(null);
    this.resetChapterView();
    this.setSaveStatus('🗑 项目已删除');
  },

  initChatResizer() {
    const resizer = $('#chatInputResizer');
    if (!resizer) return;
    const textarea = $('#chatInput');
    let startY, startH;
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      resizer.classList.add('active');
      startY = e.clientY;
      startH = textarea.offsetHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      const onMove = (e) => {
        const dy = startY - e.clientY;
        textarea.style.height = Math.max(40, Math.min(350, startH + dy)) + 'px';
      };
      const onUp = () => {
        resizer.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  },

  // ========== 项目级撤销/重做（WPS 风格） ==========

  // 每次项目操作前调用，保存当前 JSON 快照
  pushHistory() {
    if (!this.currentProject) return;
    const snapshot = JSON.stringify(this.currentProject);
    if (this._historyIndex >= 0 && this._historyStack[this._historyIndex] === snapshot) return; // 去重
    this._historyStack = this._historyStack.slice(0, this._historyIndex + 1);
    this._historyStack.push(snapshot);
    this._historyIndex = this._historyStack.length - 1;
    if (this._historyStack.length > this._historyMax) { this._historyStack.shift(); this._historyIndex--; }
  },

  async undoProject() {
    if (this._historyIndex <= 0 || !this.currentProjectId) return;
    this._historyIndex--;
    await this._restoreSnapshot(this._historyStack[this._historyIndex]);
    this.setSaveStatus('↩ 已撤销');
  },

  async redoProject() {
    if (this._historyIndex >= this._historyStack.length - 1 || !this.currentProjectId) return;
    this._historyIndex++;
    await this._restoreSnapshot(this._historyStack[this._historyIndex]);
    this.setSaveStatus('↪ 已重做');
  },

  async _restoreSnapshot(snapshotStr) {
    const data = JSON.parse(snapshotStr);
    this.currentProject = data;
    await API.saveProject(this.currentProjectId, data);
    NovelTree.render(this.currentProject);
    Settings.load(this.currentProjectId, this.currentProject.settings);
    // 恢复编辑器内容
    const ch = NovelTree.currentChapter;
    if (ch) {
      const vol = this.currentProject.volumes.find(v => v.id === ch.volumeId);
      const chapter = vol?.chapters.find(c => c.id === ch.chapterId);
      if (chapter) {
        $('#chapterEditor').value = chapter.content || '';
        $('#chapterTitle').value = chapter.title || '';
        $('#chapterWordCount').textContent = `${chapter.wordCount || 0}字`;
        $('#chapterPrompt').value = chapter.prompt || '';
      }
    }
    this._isDirty = false;
    this.updateDirtyIndicator();
    if (isElectron) {
      try { await window.electronAPI.clearAutosave(this.currentProjectId); } catch (e) { /* 忽略 */ }
    }
  },

  applyToChapter(content) {
    if (!content) return;
    const editor = $('#chapterEditor');
    if (editor.style.display !== 'none') {
      editor.value = editor.value + '\n\n' + content;
      editor.scrollTop = editor.scrollHeight;
      this.saveCurrentChapter();
      this.setSaveStatus('✅ AI内容已追加');
    }
  },

  replaceChapter(content) {
    if (!content) return;
    const editor = $('#chapterEditor');
    if (editor.style.display !== 'none') {
      editor.value = content;
      this.saveCurrentChapter();
      this.setSaveStatus('✅ 章节已替换');
    }
  },

  replaceSelection(newText) {
    if (!newText) return;
    const editor = $('#chapterEditor');
    if (editor.style.display === 'none') return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (start !== end) {
      editor.value = editor.value.substring(0, start) + newText + editor.value.substring(end);
    } else {
      editor.value = newText;
    }
    this.saveCurrentChapter();
    this.setSaveStatus('✅ 已替换选中内容');
  },

  async reloadProject() {
    if (!this.currentProjectId) return;
    const res = await API.getProject(this.currentProjectId);
    if (res.success) {
      this.currentProject = res.data;
      NovelTree.render(this.currentProject);
      Settings.load(this.currentProjectId, this.currentProject.settings);
      this.pushHistory();  // 记录每次加载（即每次变更后）
    }
  },

  async refreshAll() {
    await this.reloadProject();
    this.setSaveStatus('🤖 AI 已更新');
  },

  exportNovel() {
    if (!this.currentProject) return showAlert('请先打开项目');
    let text = `《${this.currentProject.name}》\n\n`;
    this.currentProject.volumes.forEach((vol, vi) => {
      text += `\n${'='.repeat(50)}\n`;
      text += `第${vi + 1}卷：${vol.title}\n`;
      text += `${'='.repeat(50)}\n\n`;
      vol.chapters.forEach((ch, ci) => {
        text += `\n第${ci + 1}章：${ch.title}\n`;
        text += `${'-'.repeat(30)}\n\n`;
        text += (ch.content || '（暂无内容）') + '\n\n';
      });
    });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.currentProject.name}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ==================== 导入功能 ====================
  importState: { step: 1, rawText: '', aiResult: null },

  openImportDialog() {
    if (!this.currentProjectId) return showAlert('请先打开一个项目');
    this.importState = { step: 1, rawText: '', aiResult: null };
    this.renderImportStep(1);
    document.getElementById('importOverlay').style.display = 'flex';
    this.bindImportEvents();
  },

  closeImportDialog() {
    document.getElementById('importOverlay').style.display = 'none';
  },

  bindImportEvents() {
    const ov = document.getElementById('importOverlay');

    $('#btnImportClose', ov).onclick = () => this.closeImportDialog();
    $('#btnImportCancel', ov).onclick = () => this.closeImportDialog();

    const dropzone = $('#importDropzone', ov);
    dropzone.onclick = () => $('#importFileInput', ov).click();
    dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) this.handleImportFile(file);
    };
    $('#importFileInput', ov).onchange = (e) => {
      const file = e.target.files[0];
      if (file) this.handleImportFile(file);
    };

    $('#btnImportNext', ov).onclick = () => this.importNextStep();
    $('#btnImportBack', ov).onclick = () => this.importPrevStep();
    $('#btnImportApply', ov).onclick = () => this.applyImportedSettings();
    $('#btnImportAI', ov).onclick = () => this.runAIImport();
  },

  handleImportFile(file) {
    console.log('Import file:', file.name, file.size, file.type);
    const ext = file.name.split('.').pop().toLowerCase();

    // Excel/CSV
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      if (typeof XLSX === 'undefined') {
        showAlert('Excel 解析库加载失败，请检查网络连接后刷新页面');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          let text = '';
          workbook.SheetNames.forEach(name => {
            text += '\n=== ' + name + ' ===\n';
            text += XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
          });
          console.log('Parsed Excel, text length:', text.length);
          this.importState.rawText = text;
          this.importState.step = 2;
          this.renderImportStep(2);
        } catch (err) {
          showAlert('Excel 解析失败：' + err.message);
        }
      };
      reader.onerror = () => showAlert('Excel 文件读取失败');
      reader.readAsArrayBuffer(file);
      return;
    }

    // 普通文本：任何文件都先尝试读为文本
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      console.log('Text read, length:', text.length);
      if (!text || text.length === 0) {
        showAlert('文件内容为空或无法识别');
        return;
      }
      this.importState.rawText = text;
      this.importState.step = 2;
      this.renderImportStep(2);
    };
    reader.onerror = () => showAlert('无法读取该文件（可能是二进制格式，请尝试导出为 .txt 后导入）');
    reader.readAsText(file);
  },

  renderImportStep(step) {
    const ov = document.getElementById('importOverlay');
    ['importStep1', 'importStep2', 'importStep3'].forEach(id => {
      const el = $('#' + id, ov);
      if (el) el.style.display = 'none';
    });
    const current = $('#importStep' + step, ov);
    if (current) current.style.display = 'block';

    if (step === 2) {
      // 显示文件预览
      const preview = $('#importTextPreview', ov);
      if (preview) {
        const text = this.importState.rawText || '';
        preview.textContent = text.substring(0, 3000) + (text.length > 3000 ? '\n\n...（已截断，共 ' + text.length + ' 字）' : '');
      }
    }

    if (step === 3 && this.importState.aiResult) {
      const resultEl = $('#importResult', ov);
      if (resultEl) {
        const r = this.importState.aiResult;
        let html = '<div style="font-size:13px">';
        html += '<p style="color:var(--green-dark);margin-bottom:8px">✅ AI 分析完成</p>';
        html += '<p><strong>卷：</strong>' + (r.volumes ? r.volumes.length + '个' : '0个') + '</p>';
        html += '<p><strong>章：</strong>' + (r.chapters ? r.chapters.length + '个' : '0个') + '</p>';
        html += '<p><strong>设定分类：</strong>' + (r.settingTypes ? r.settingTypes.length + '个' : '0个') + '</p>';
        html += '</div>';
        resultEl.innerHTML = html;
      }
    }

    const btnNext = $('#btnImportNext', ov);
    const btnBack = $('#btnImportBack', ov);
    const btnApply = $('#btnImportApply', ov);
    const btnAI = $('#btnImportAI', ov);

    if (btnNext) btnNext.style.display = step === 1 ? '' : 'none';
    if (btnBack) btnBack.style.display = step > 1 ? '' : 'none';
    if (btnApply) btnApply.style.display = step === 3 ? '' : 'none';
    if (btnAI) btnAI.style.display = step === 2 ? '' : 'none';
  },

  importNextStep() {
    if (this.importState.step === 1) {
      // 选择了文件 → 预览
      this.importState.step = 2;
      this.renderImportStep(2);
    }
  },

  importPrevStep() {
    if (this.importState.step > 1) {
      this.importState.step--;
      this.renderImportStep(this.importState.step);
    }
  },

  async runAIImport() {
    if (!this.importState.rawText) return;
    const apiKey = Agent.apiKey || localStorage.getItem('novelwriter_apikey');
    if (!apiKey) { showAlert('请先在右侧 AI 助手中设置 API Key'); return; }

    const ov = document.getElementById('importOverlay');
    const aiBtn = $('#btnImportAI', ov);
    if (aiBtn) { aiBtn.disabled = true; aiBtn.textContent = '⏳ AI 分析中...'; }

    const systemPrompt = `你是一个文本分析专家。请分析以下小说/故事文本，提取结构化信息，严格按 JSON 格式返回，不要任何额外文字。

返回格式：
{
  "volumes": [{"title": "卷名", "order": 0}],
  "chapters": [{"title": "章名", "volume_index": 0, "order": 0}],
  "settingTypes": [
    {"name": "总设定", "entries": [{"name": "核心梗概", "description": "一句话简介"}]},
    {"name": "角色设定", "entries": [{"name": "角色名", "description": "描述"}]}
  ]
}

规则：
1. 按原文结构切分卷和章，chapter 的 title 必须和原文中出现的章节标题完全一致（方便程序自动匹配正文）
2. 如果原文没有明确卷结构，全放在一个卷里
3. settingTypes 提取文中所有设定信息，自行判断需要哪些分类
4. 每个 settingType 下可包含多个条目，每个条目有 name 和 description`;

    try {
      const response = await API.chat(apiKey, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请分析以下文本：\n\n' + this.importState.rawText.substring(0, 50000) }
      ], 'deepseek-chat', undefined, undefined);

      if (!response.success) {
        showAlert('AI 分析失败：' + (response.error || '未知错误'));
        if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = '🤖 AI 分析'; }
        return;
      }

      // 解析 AI 返回的 JSON
      const content = response.data.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        showAlert('AI 返回格式异常，请重试');
        if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = '🤖 AI 分析'; }
        return;
      }

      const aiResult = JSON.parse(jsonMatch[0]);
      this.importState.aiResult = aiResult;
      this.importState.step = 3;
      this.renderImportStep(3);
    } catch (e) {
      showAlert('AI 分析出错：' + e.message);
    }
    if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = '🤖 AI 分析'; }
  },

  async applyImportedSettings() {
    if (!this.currentProjectId || !this.importState.aiResult) return;
    const data = this.importState.aiResult;
    const fullText = this.importState.rawText;

    // 创建卷
    let volMap = {};
    if (data.volumes && data.volumes.length > 0) {
      for (let i = 0; i < data.volumes.length; i++) {
        const res = await API.addVolume(this.currentProjectId, data.volumes[i].title || '第' + (i + 1) + '卷');
        if (res.success) volMap[i] = res.data.id;
      }
    } else {
      const res = await API.addVolume(this.currentProjectId, '第一卷');
      if (res.success) volMap[0] = res.data.id;
    }

    await this.reloadProject();

    // 创建章
    const chapterMap = {}; // AI chapter index → { volId, chId }
    if (data.chapters) {
      for (let i = 0; i < data.chapters.length; i++) {
        const ch = data.chapters[i];
        const vi = ch.volume_index || 0;
        const volId = volMap[vi] || Object.values(volMap)[0];
        if (!volId) continue;
        const addRes = await API.addChapter(this.currentProjectId, volId, ch.title || '第' + (i + 1) + '章');
        if (addRes.success) chapterMap[i] = { volId, chId: addRes.data.id };
      }
    }

    // 从原文切分正文，匹配章节标题
    if (data.chapters && data.chapters.length > 0) {
      const titles = data.chapters.map(ch => ch.title).filter(Boolean);
      // 用章节标题正则切割原文
      const escapedTitles = titles.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const pattern = new RegExp('(' + escapedTitles.join('|') + ')', 'g');

      const parts = fullText.split(pattern);
      // parts[0] = 第一个标题前的内容, parts[1] = 标题1, parts[2] = 内容1, parts[3] = 标题2, ...
      for (let i = 1; i < parts.length; i += 2) {
        const title = parts[i];
        const content = (parts[i + 1] || '').trim();
        // 找到匹配的章节
        const chIdx = data.chapters.findIndex(ch => ch.title === title);
        if (chIdx >= 0 && chapterMap[chIdx]) {
          await API.updateChapter(this.currentProjectId, chapterMap[chIdx].volId, chapterMap[chIdx].chId, { content });
        }
      }
    }

    // 保存设定（新格式）
    if (data.settingTypes && data.settingTypes.length > 0) {
      const settings = { ...this.currentProject.settings };
      const types = settings.settingTypes || [];
      data.settingTypes.forEach(st => {
        const existing = types.find(t => t.name === st.name);
        if (existing) {
          (st.entries || []).forEach(e => {
            existing.entries.push({ id: 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), name: e.name || '', description: e.description || '' });
          });
        } else {
          types.push({
            id: 'type_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
            name: st.name, icon: '📌',
            entries: (st.entries || []).map(e => ({ id: 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), name: e.name || '', description: e.description || '' }))
          });
        }
      });
      settings.settingTypes = types;
      await API.saveSettings(this.currentProjectId, settings);
    }

    this.closeImportDialog();
    await this.reloadProject();
    this.setSaveStatus('✅ 导入完成');
  },
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => App.init());
