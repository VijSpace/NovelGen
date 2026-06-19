// ==================== 主应用 ====================
const App = {
  currentProject: null,
  currentProjectId: null,
  _autoSaveTimer: null,
  _autoSaveInterval: 60,
  _isDirty: false,

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

    this.bindEvents();
    this.initSplitters();
    this.initChatResizer();

    await this.loadProjectList();
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
    $('#btnImport').addEventListener('click', () => this.openImportDialog());
    $('#btnExport').addEventListener('click', () => this.exportNovel());
    $('#btnEditSysPrompt').addEventListener('click', () => this.openSysPromptEditor());
    $('#btnSettings').addEventListener('click', () => this.openSettingsDialog());

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
      }
    });

    $('#btnSaveChapter').addEventListener('click', () => this.saveCurrentChapter());
    $('#btnUndo').addEventListener('click', () => this.undo());
    $('#btnRedo').addEventListener('click', () => this.redo());
    $('#btnSendToAgent').addEventListener('click', () => this.sendSelectedToAgent());
    $('#btnFillChat')?.addEventListener('click', () => this.fillChatInput());
    $('#btnDeleteProject')?.addEventListener('click', () => this.deleteProject());
    $('#btnPromptToggle').addEventListener('click', () => this.togglePromptBody());

    const markDirty = () => { this._isDirty = true; this.updateDirtyIndicator(); };
    const debouncedUndo = debounce(() => this.pushUndo(), 2000);
    $('#chapterTitle').addEventListener('input', markDirty);
    $('#chapterEditor').addEventListener('input', () => {
      markDirty();
      debouncedUndo();
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.saveCurrentChapter();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        const ae = document.activeElement;
        if (ae === $('#chapterEditor') || ae === $('#chapterTitle')) {
          e.preventDefault();
          if (e.shiftKey) this.redo(); else this.undo();
        }
      }
    });
  },

  // ========== 项目管理 ==========
  async loadProjectList() {
    const res = await API.getProjects();
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
    }
  },

  async createProject() {
    const name = await showPrompt('请输入项目名称：', '我的小说');
    if (!name) return;
    const res = await API.createProject(name);
    if (res.success) {
      await this.loadProjectList();
      $('#projectSelect').value = res.data.id;
      this.openProject(res.data.id);
    } else {
      await showAlert('创建失败：' + res.error);
    }
  },

  async openProject(id) {
    if (!id) {
      $('#btnEditSysPrompt').style.display = 'none';
      return;
    }
    this.stopAutoSave();

    this.currentProjectId = id;
    localStorage.setItem('novelwriter_last_project', id);

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
      if (!this.currentProject) this.currentProject = res.data;
      $('#btnDeleteProject').style.display = '';
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

  // ========== 设置对话框 ==========

  async openSettingsDialog() {
    if (!isElectron) {
      showAlert('设置功能仅在桌面版中可用');
      return;
    }
    const settings = await window.electronAPI.getSettings();
    const currentPath = settings.dataPath || '';

    const bodyHtml = `
      <div style="display:flex;flex-direction:column;gap:12px">
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
      </div>`;

    const close = showModal(
      '⚙️ 设置',
      bodyHtml,
      `<button class="btn btn-sm" id="modalCancel">取消</button>
       <button class="btn btn-sm btn-primary" id="modalOk">保存</button>`
    );

    document.getElementById('btnBrowseFolder').onclick = async () => {
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        document.getElementById('settingDataPath').value = folder;
      }
    };

    document.getElementById('modalOk').onclick = async () => {
      const newPath = document.getElementById('settingDataPath').value.trim();
      const newInterval = parseInt(document.getElementById('settingAutoSaveInterval').value) || 60;
      const clampedInterval = Math.max(10, Math.min(600, newInterval));

      await window.electronAPI.setSettings({
        dataPath: newPath,
        autoSaveInterval: clampedInterval
      });

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

  async renameProject() {},

  openSysPromptEditor() {
    if (!this.currentProject) return;
    const defaultSysPrompt = `你是一位资深小说作家，能够直接操控小说项目。你可以使用工具来创建卷章、写入内容、管理人物和设定。

核心原则：
1. 用情节和对话传达主题，展示而非讲述
2. 人物言行必须符合其性格设定
3. 主动使用工具来完成用户的请求——不要只给建议，直接执行
4. 写章节正文前，先确保有卷和章的结构
5. 修改设定或人物后，简要说明改了什么`;

    const saved = this.currentProject.settings?.systemPrompt || '';
    $('#sysPromptEditor').value = saved || defaultSysPrompt;
    $('#sysPromptOverlay').style.display = 'flex';

    $('#btnSysPromptSave').onclick = async () => {
      const newPrompt = $('#sysPromptEditor').value;
      if (!this.currentProject.settings) this.currentProject.settings = {};
      this.currentProject.settings.systemPrompt = newPrompt;
      await API.saveSettings(this.currentProjectId, this.currentProject.settings);
      $('#sysPromptOverlay').style.display = 'none';
      this.setSaveStatus('✅ 提示词已保存');
    };

    $('#btnSysPromptCancel').onclick = () => {
      $('#sysPromptOverlay').style.display = 'none';
    };

    $('#btnSysPromptReset').onclick = () => {
      $('#sysPromptEditor').value = defaultSysPrompt;
    };
  },

  // ==================== ⋮ 菜单 ====================
  handleMoreClick(btn, e) {
    e.preventDefault();
    e.stopPropagation();
    const menu = $('#ctxMenu');
    this._moreTarget = btn;
    menu.innerHTML = btn.dataset.more === 'volume'
      ? `<div data-act="addCh" style="padding:7px 16px;cursor:pointer;font-size:13px">＋ 添加章</div><div style="height:1px;background:var(--border);margin:4px 8px"></div><div data-act="delVol" style="padding:7px 16px;cursor:pointer;font-size:13px;color:var(--accent)">🗑 删除卷</div>`
      : `<div style="height:1px;background:var(--border);margin:4px 8px"></div><div data-act="delCh" style="padding:7px 16px;cursor:pointer;font-size:13px;color:var(--accent)">🗑 删除章</div>`;
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

        if (act === 'delVol') { if (await showConfirm('确定删除此卷及其中所有章节？')) { await API.deleteVolume(this.currentProjectId, vid); await this.reloadProject(); } }
        else if (act === 'delCh') { if (await showConfirm('确定删除这一章？')) { await API.deleteChapter(this.currentProjectId, vid, chId); await this.reloadProject(); } }
        else if (act === 'addCh') { this.addChapter(vid); }
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
        return;
      }

      if (!e.target.closest?.('#ctxMenu')) menu.style.display = 'none';
    });
  },

  async addVolume() {
    if (!this.currentProjectId) return showAlert('请先选择项目');
    const title = await showPrompt('卷名：', `第${(this.currentProject.volumes?.length || 0) + 1}卷`);
    if (!title) return;
    const res = await API.addVolume(this.currentProjectId, title);
    if (res.success) await this.reloadProject();
  },

  async addChapter(volId) {
    if (!this.currentProjectId) return;
    const vol = this.currentProject.volumes.find(v => v.id === volId);
    const title = `第${(vol?.chapters?.length || 0) + 1}章`;
    const res = await API.addChapter(this.currentProjectId, volId, title);
    if (res.success) await this.reloadProject();
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

    this._undoStack = [ch.content || ''];
    this._undoIndex = 0;

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

  // ========== 撤销 / 重做 ==========
  pushUndo(force) {
    const editor = $('#chapterEditor');
    if (!editor || editor.style.display === 'none') return;
    const val = editor.value;
    if (!this._undoStack) { this._undoStack = []; this._undoIndex = -1; }
    if (!force && this._undoIndex >= 0 && this._undoStack[this._undoIndex] === val) return;
    this._undoStack = this._undoStack.slice(0, this._undoIndex + 1);
    this._undoStack.push(val);
    this._undoIndex = this._undoStack.length - 1;
    if (this._undoStack.length > 50) { this._undoStack.shift(); this._undoIndex--; }
  },

  undo() {
    if (!this._undoStack || this._undoIndex <= 0) return;
    this._undoIndex--;
    const editor = $('#chapterEditor');
    if (editor && editor.style.display !== 'none') {
      editor.value = this._undoStack[this._undoIndex];
      this.saveCurrentChapter();
      this.setSaveStatus('↩ 已撤销');
    }
  },

  redo() {
    if (!this._undoStack || this._undoIndex >= this._undoStack.length - 1) return;
    this._undoIndex++;
    const editor = $('#chapterEditor');
    if (editor && editor.style.display !== 'none') {
      editor.value = this._undoStack[this._undoIndex];
      this.saveCurrentChapter();
      this.setSaveStatus('↪ 已重做');
    }
  },

  applyToChapter(content) {
    if (!content) return;
    const editor = $('#chapterEditor');
    if (editor.style.display !== 'none') {
      this.pushUndo(true);
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
      this.pushUndo(true);
      editor.value = content;
      this.saveCurrentChapter();
      this.setSaveStatus('✅ 章节已替换');
    }
  },

  replaceSelection(newText) {
    if (!newText) return;
    const editor = $('#chapterEditor');
    if (editor.style.display === 'none') return;
    this.pushUndo(true);
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
  importState: { step: 1, rawText: '', extractedData: null, extractedByAI: false },

  openImportDialog() {
    if (!this.currentProjectId) return showAlert('请先打开一个项目');
    this.importState = { step: 1, rawText: '', extractedData: null, extractedByAI: false };
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
  },

  handleImportFile(file) {
    if (!file.name.endsWith('.txt') && !file.name.endsWith('.md')) {
      showAlert('请选择 .txt 或 .md 文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      this.importState.rawText = e.target.result;
      this.importState.step = 2;
      this.renderImportStep(2);
    };
    reader.readAsText(file);
  },

  renderImportStep(step) {
    const ov = document.getElementById('importOverlay');
    ['importStep1', 'importStep2', 'importStep3'].forEach(id => {
      const el = $('#' + id, ov);
      if (el) el.style.display = 'none';
    });
    const current = $('#importStep' + step, ov);
    if (current) current.style.display = '';

    const btnNext = $('#btnImportNext', ov);
    const btnBack = $('#btnImportBack', ov);
    const btnApply = $('#btnImportApply', ov);
    if (btnNext) btnNext.style.display = step === 1 ? '' : 'none';
    if (btnBack) btnBack.style.display = step > 1 ? '' : 'none';
    if (btnApply) btnApply.style.display = step === 3 ? '' : 'none';
  },

  importNextStep() {
    if (this.importState.step === 1) {
      this.importState.step = 2;
    } else if (this.importState.step === 2) {
      this.importState.step = 3;
      this.extractSettingsFromRaw();
    }
    this.renderImportStep(this.importState.step);
  },

  importPrevStep() {
    if (this.importState.step > 1) {
      this.importState.step--;
      this.renderImportStep(this.importState.step);
    }
  },

  extractSettingsFromRaw() {
    const text = this.importState.rawText;
    const result = {};

    // 提取卷名：匹配 "第X卷" 或 "第X卷：标题"
    const volMatches = text.match(/第[一二三四五六七八九十百\d]+卷[：:：\s]*[^\n]*/g);
    if (volMatches) {
      result.volumes = volMatches.map(v => ({ title: v.trim() }));
    }

    // 提取章名
    const chMatches = text.match(/第[一二三四五六七八九十百\d]+章[：:：\s]*[^\n]*/g);
    if (chMatches) {
      result.chapters = chMatches.map(c => ({ title: c.trim() }));
    }

    this.importState.extractedData = result;
  },

  async applyImportedSettings() {
    if (!this.currentProjectId || !this.importState.extractedData) return;
    const data = this.importState.extractedData;

    // 创建卷
    if (data.volumes) {
      for (const v of data.volumes) {
        await API.addVolume(this.currentProjectId, v.title);
      }
    }

    // 刷新并创建章
    await this.reloadProject();
    const firstVol = this.currentProject.volumes?.[0];
    if (firstVol && data.chapters) {
      for (const ch of data.chapters) {
        await API.addChapter(this.currentProjectId, firstVol.id, ch.title);
      }
    }

    // 将原始文本写入第一卷第一章
    await this.reloadProject();
    const vol1 = this.currentProject.volumes?.[0];
    const ch1 = vol1?.chapters?.[0];
    if (ch1) {
      await API.updateChapter(this.currentProjectId, vol1.id, ch1.id, {
        content: this.importState.rawText
      });
    }

    this.closeImportDialog();
    await this.reloadProject();
    this.setSaveStatus('✅ 导入完成');
  },
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => App.init());
