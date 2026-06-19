// ==================== 设定区组件 ====================
const Settings = {
  currentTypeId: null,    // 当前选中的设定类型 ID
  projectId: null,
  settings: null,
  _saveTimer: null,
  _ctxTarget: null,

  init() {
    $('#settingsNav').addEventListener('click', (e) => {
      if (e.target.closest('.setting-type-more')) return;  // ⋮ 按钮不触发切换
      const btn = e.target.closest('.setting-nav-btn');
      if (btn) { this.switchType(btn.dataset.typeId); }
    });
    $('#btnAddCustomSetting').addEventListener('click', () => this.addType());
    // 拖拽排序
    const nav = $('#settingsNav');
    let dragTypeId = null;

    nav.addEventListener('dragstart', (e) => {
      const btn = e.target.closest('.setting-nav-btn');
      if (!btn || e.target.closest('.setting-type-more')) { e.preventDefault(); return; }
      dragTypeId = btn.dataset.typeId;
      btn.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    nav.addEventListener('dragend', (e) => {
      const btn = nav.querySelector('.setting-nav-btn.dragging');
      if (btn) btn.classList.remove('dragging');
      dragTypeId = null;
    });

    nav.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    nav.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!dragTypeId) return;
      const targetBtn = e.target.closest('.setting-nav-btn');
      if (!targetBtn || targetBtn.dataset.typeId === dragTypeId) return;

      const types = this.settings.settingTypes;
      const fromIdx = types.findIndex(t => t.id === dragTypeId);
      let toIdx = types.findIndex(t => t.id === targetBtn.dataset.typeId);
      if (fromIdx < 0 || toIdx < 0) return;

      const rect = targetBtn.getBoundingClientRect();
      if (e.clientY > rect.top + rect.height / 2) toIdx++;
      if (fromIdx < toIdx) toIdx--;

      const [moved] = types.splice(fromIdx, 1);
      types.splice(toIdx, 0, moved);
      dragTypeId = null;
      await this.save();
      this.renderNav();
    });
    // 设定区右键菜单（⋮）
    document.addEventListener('click', (e) => {
      const more = e.target.closest('.setting-type-more');
      if (more) {
        e.stopPropagation();
        this._showTypeMenu(more);
        return;
      }
      if (!e.target.closest('#settingTypeMenu')) {
        const menu = $('#settingTypeMenu');
        if (menu) menu.style.display = 'none';
      }
    });
  },

  // ========== 数据迁移：旧格式 → 新格式 ==========
  _migrate(oldSettings) {
    const types = [];
    // 迁移总设定
    const oa = oldSettings.overall;
    if (oa) {
      const entries = [];
      if (oa.summary) entries.push({ id: 'e_' + Date.now() + '_1', name: '核心梗概', description: oa.summary });
      if (oa.content) entries.push({ id: 'e_' + Date.now() + '_2', name: '详细设定', description: oa.content });
      if (entries.length > 0) types.push({ id: 'type_overall', name: '总设定', icon: '📋', entries });
    }
    // 迁移分卷架构
    if (oldSettings.volumeArchitecture?.volumes?.length > 0) {
      types.push({
        id: 'type_volarch', name: '分卷架构', icon: '📐',
        entries: oldSettings.volumeArchitecture.volumes.map(v => ({ id: 'e_' + Date.now() + '_v' + Math.random().toString(36).slice(2,6), name: v.title || '未命名卷', description: v.content || '' }))
      });
    }
    // 迁移角色
    if (oldSettings.characters?.length > 0) {
      types.push({
        id: 'type_chars', name: '角色设定', icon: '👤',
        entries: oldSettings.characters.map(c => ({ id: 'e_' + Date.now() + '_c' + Math.random().toString(36).slice(2,6), name: c.name || '未命名', description: c.description || '' }))
      });
    }
    // 迁移自定义设定
    (oldSettings.customSettings || []).forEach(cs => {
      types.push({ id: cs.id, name: cs.title || '未命名', icon: '📌', entries: cs.content ? [{ id: 'e_' + Date.now() + '_cs' + Math.random().toString(36).slice(2,6), name: '', description: cs.content }] : [] });
    });
    return { systemPrompt: oldSettings.systemPrompt || '', settingTypes: types };
  },

  load(projectId, raw) {
    this.projectId = projectId;
    const settings = raw || {};
    // 迁移旧格式
    if (!settings.settingTypes && (settings.overall || settings.characters || settings.customSettings)) {
      this.settings = this._migrate(settings);
      this.save();  // 保存新格式
    } else {
      this.settings = settings;
      if (!this.settings.settingTypes) this.settings.settingTypes = [];
    }
    // 确保有默认类型
    if (this.settings.settingTypes.length === 0) {
      this.settings.settingTypes = [
        { id: 'type_overall', name: '总设定', icon: '📋', entries: [] },
        { id: 'type_volarch', name: '分卷架构', icon: '📐', entries: [] },
        { id: 'type_chars', name: '角色设定', icon: '👤', entries: [] }
      ];
    }
    if (!this.currentTypeId || !this.settings.settingTypes.find(t => t.id === this.currentTypeId)) {
      this.currentTypeId = this.settings.settingTypes[0]?.id || null;
    }
    this.renderNav();
    this.renderCurrent();
  },

  // ========== 左侧导航 ==========
  renderNav() {
    const nav = $('#settingsNav');
    nav.querySelectorAll('.setting-nav-btn').forEach(b => b.remove());
    (this.settings.settingTypes || []).forEach(st => {
      const btn = document.createElement('button');
      btn.className = 'setting-nav-btn';
      btn.dataset.typeId = st.id;
      btn.draggable = true;
      btn.innerHTML = `<span>${st.icon} ${escapeHtml(st.name)}</span><span class="setting-type-more" data-type-id="${st.id}" style="margin-left:auto;opacity:0;font-size:14px;padding:0 4px">⋮</span>`;
      if (st.id === this.currentTypeId) btn.classList.add('active');
      nav.appendChild(btn);
    });
  },

  switchType(typeId) {
    this.saveCurrentInputs();
    this.currentTypeId = typeId;
    this.renderNav();
    this.renderCurrent();
  },

  // ========== 类型右键菜单 ==========
  _showTypeMenu(btn) {
    const menu = $('#settingTypeMenu');
    if (!menu) {
      const el = document.createElement('div');
      el.id = 'settingTypeMenu';
      el.style.cssText = 'position:fixed;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 4px 16px rgba(0,0,0,0.2);z-index:999;display:none;min-width:120px';
      document.body.appendChild(el);
    }
    this._ctxTarget = btn.dataset.typeId;
    const m = $('#settingTypeMenu');
    m.innerHTML = `<div data-act="renameType" style="padding:8px 14px;cursor:pointer;font-size:13px">✏️ 重命名</div><div style="height:1px;background:var(--border);margin:2px 8px"></div><div data-act="deleteType" style="padding:8px 14px;cursor:pointer;font-size:13px;color:var(--accent)">🗑 删除</div>`;
    const r = btn.getBoundingClientRect();
    Object.assign(m.style, { display:'block', left:Math.min(r.right,innerWidth-150)+'px', top:Math.min(r.bottom,innerHeight-120)+'px' });

    m.onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset?.act;
      m.style.display = 'none';
      if (act === 'renameType') this.renameType(this._ctxTarget);
      else if (act === 'deleteType') this.deleteType(this._ctxTarget);
      this._ctxTarget = null;
    };
  },

  async renameType(typeId) {
    const st = this.settings.settingTypes.find(t => t.id === typeId);
    if (!st) return;
    const name = await showPrompt('新名称：', st.name);
    if (!name) return;
    st.name = name;
    this.save().then(() => { this.renderNav(); this.renderCurrent(); });
  },

  async deleteType(typeId) {
    this.settings.settingTypes = this.settings.settingTypes.filter(t => t.id !== typeId);
    this.currentTypeId = this.settings.settingTypes[0]?.id || null;
    this.save().then(() => { this.renderNav(); this.renderCurrent(); });
  },

  async addType() {
    const name = await showPrompt('设定类型名称：', '新设定');
    if (!name) return;
    const id = 'type_' + Date.now();
    this.settings.settingTypes.push({ id, name, icon: '📌', entries: [{ id: 'e_' + Date.now(), name: '', description: '' }] });
    this.currentTypeId = id;
    this.save().then(() => { this.renderNav(); this.renderCurrent(); });
  },

  // ========== 条目渲染 ==========
  saveCurrentInputs() {
    if (!this.settings) return;
    const st = this.settings.settingTypes.find(t => t.id === this.currentTypeId);
    if (!st) return;
    document.querySelectorAll('.entry-name').forEach(inp => {
      const eid = inp.dataset.eid;
      const entry = st.entries.find(e => e.id === eid);
      if (entry) entry.name = inp.value;
    });
    document.querySelectorAll('.entry-desc').forEach(ta => {
      const eid = ta.dataset.eid;
      const entry = st.entries.find(e => e.id === eid);
      if (entry) entry.description = ta.value;
    });
  },

  renderCurrent() {
    const container = $('#settingsContent');
    if (!this.settings || !this.currentTypeId) {
      container.innerHTML = '<div class="empty-hint">请先创建或选择一个项目</div>';
      return;
    }
    const st = this.settings.settingTypes.find(t => t.id === this.currentTypeId);
    if (!st) {
      container.innerHTML = '<div class="empty-hint">设定类型不存在</div>';
      return;
    }

    let html = `<div class="setting-panel active"><h4>${st.icon} ${escapeHtml(st.name)}</h4>`;
    (st.entries || []).forEach((entry, idx) => {
      const rows = entry._rows || 6;
      html += `
        <div class="entry-card">
          <div class="entry-card-header">
            <input type="text" class="entry-name" data-eid="${entry.id}" value="${escapeHtml(entry.name || '')}" placeholder="条目名（如：世界观、主角张三）" oninput="Settings.autoSave()">
            <button class="btn btn-xs entry-del" data-eid="${entry.id}" title="删除条目" style="color:var(--accent);opacity:0">🗑</button>
          </div>
          <textarea class="entry-desc" data-eid="${entry.id}" rows="${rows}" style="height:${entry._height || 'auto'}" placeholder="描述..." oninput="Settings.autoSave()">${escapeHtml(entry.description || '')}</textarea>
        </div>`;
    });
    html += `<button class="tree-add-ch add-entry-btn" data-type-id="${st.id}" style="margin-top:4px">＋ 添加条目</button>`;
    html += `</div>`;
    container.innerHTML = html;

    // 条目 hover 显示删除按钮
    container.querySelectorAll('.entry-card').forEach(card => {
      card.addEventListener('mouseenter', () => { card.querySelector('.entry-del').style.opacity = '1'; });
      card.addEventListener('mouseleave', () => { card.querySelector('.entry-del').style.opacity = '0'; });
    });
    // 删除条目
    container.querySelectorAll('.entry-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const eid = btn.dataset.eid;
        st.entries = st.entries.filter(e => e.id !== eid);
        this.save().then(() => this.renderCurrent());
      });
    });
    // 添加条目
    const addBtn = container.querySelector('.add-entry-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        st.entries.push({ id: 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), name: '', description: '' });
        this.save().then(() => this.renderCurrent());
      });
    }
    // 记住 textarea 调整的大小
    container.querySelectorAll('.entry-desc').forEach(ta => {
      ta.addEventListener('mouseup', () => {
        const eid = ta.dataset.eid;
        const entry = st.entries.find(e => e.id === eid);
        if (entry) { entry._height = ta.style.height; entry._rows = ta.rows; }
        this.save();
      });
    });
  },

  // ========== 自动保存 ==========
  autoSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.saveCurrentInputs();
      this.save();
    }, 1500);
  },

  async save() {
    if (!this.projectId) return;
    await API.saveSettings(this.projectId, this.settings);
    if (typeof App !== 'undefined' && App.pushHistory) App.pushHistory();
  }
};
