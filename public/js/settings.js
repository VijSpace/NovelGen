// ==================== 设定区组件 ====================
const Settings = {
  currentTab: 'overall',
  projectId: null,
  settings: null,

  init() {
    $('#settingsNav').addEventListener('click', (e) => {
      const btn = e.target.closest('.setting-nav-btn');
      if (btn) { this.switchTab(btn.dataset.setting); }
    });
    $('#btnAddCustomSetting').addEventListener('click', () => this.addCustomSetting());
  },

  load(projectId, settings) {
    this.projectId = projectId;
    this.settings = settings || {};
    if (!this.settings.characters) this.settings.characters = [];
    if (!this.settings.customSettings) this.settings.customSettings = [];
    if (!this.settings.overall) this.settings.overall = { summary: '', content: '' };
    if (!this.settings.volumeArchitecture) this.settings.volumeArchitecture = { volumes: [] };
    if (!this.settings.volumeArchitecture.volumes) this.settings.volumeArchitecture.volumes = [];
    this.renderNav();
    this.renderCurrent();
  },

  renderNav() {
    const nav = $('#settingsNav');
    const customBtns = nav.querySelectorAll('.setting-nav-btn[data-custom-id]');
    customBtns.forEach(b => b.remove());

    (this.settings.customSettings || []).forEach(cs => {
      const btn = document.createElement('button');
      btn.className = 'setting-nav-btn';
      btn.dataset.setting = 'custom_' + cs.id;
      btn.dataset.customId = cs.id;
      btn.textContent = '📌 ' + (cs.title || '未命名');
      if (this.currentTab === 'custom_' + cs.id) btn.classList.add('active');
      nav.appendChild(btn);
    });
  },

  switchTab(tabName) {
    this.currentTab = tabName;
    $$('.setting-nav-btn').forEach(b => {
      const isCustom = b.dataset.customId;
      const match = isCustom ? ('custom_' + b.dataset.customId) === tabName : b.dataset.setting === tabName;
      b.classList.toggle('active', match);
    });
    this.renderCurrent();
  },

  renderCurrent() {
    const container = $('#settingsContent');
    if (!this.settings) {
      container.innerHTML = '<div class="empty-hint">请先创建或选择一个项目</div>';
      return;
    }
    if (this.currentTab.startsWith('custom_')) {
      const csId = this.currentTab.replace('custom_', '');
      this.renderCustomSetting(container, csId);
      return;
    }
    switch (this.currentTab) {
      case 'overall': this.renderOverall(container); break;
      case 'volumeArchitecture': this.renderVolumeArchitecture(container); break;
      case 'characters': this.renderCharacters(container); break;
    }
  },

  // ========== 总设定 ==========
  renderOverall(container) {
    container.innerHTML = `
      <div class="setting-panel active">
        <h4>📋 总设定</h4>
        <label>一句话简介（核心梗概）</label>
        <input type="text" id="setting-overall-summary" value="${escapeHtml(this.settings.overall?.summary || '')}" placeholder="当 [主角] 面临 [核心冲突] 时，他/她必须...">
        <label>详细设定</label>
        <textarea id="setting-overall-content" rows="14" placeholder="世界观、主线剧情、核心冲突、三幕结构大纲...">${escapeHtml(this.settings.overall?.content || '')}</textarea>
        <button class="btn btn-sm btn-primary" onclick="Settings.saveOverall()">💾 保存</button>
      </div>`;
  },

  saveOverall() {
    this.settings.overall = this.settings.overall || {};
    this.settings.overall.summary = $('#setting-overall-summary').value;
    this.settings.overall.content = $('#setting-overall-content').value;
    this.save();
  },

  // ========== 分卷架构 ==========
  renderVolumeArchitecture(container) {
    const vols = this.settings.volumeArchitecture?.volumes || [];
    let html = `<div class="setting-panel active"><h4>📐 分卷架构</h4>`;
    html += `<button class="btn btn-sm btn-primary" onclick="Settings.addVolArch()" style="margin-bottom:10px">＋ 添加卷架构</button>`;
    vols.forEach((v, idx) => {
      html += `
        <div class="char-card-v2">
          <div class="char-card-v2-header">
            <input type="text" class="vol-arch-title" data-idx="${idx}" value="${escapeHtml(v.title || '')}" placeholder="卷名">
            <button class="btn btn-xs" style="color:var(--accent)" onclick="Settings.removeVolArch(${idx})">🗑</button>
          </div>
          <textarea class="vol-arch-content" data-idx="${idx}" rows="4" placeholder="本卷剧情概要...">${escapeHtml(v.content || '')}</textarea>
        </div>`;
    });
    html += `<button class="btn btn-sm btn-primary" onclick="Settings.saveVolumeArchitecture()">💾 保存分卷架构</button></div>`;
    container.innerHTML = html;
  },

  addVolArch() {
    this.settings.volumeArchitecture.volumes.push({ title: '新卷', content: '' });
    this.renderCurrent();
  },

  removeVolArch(idx) {
    this.settings.volumeArchitecture.volumes.splice(idx, 1);
    this.renderCurrent();
  },

  saveVolumeArchitecture() {
    const vols = this.settings.volumeArchitecture.volumes;
    document.querySelectorAll('.vol-arch-title').forEach(inp => {
      const idx = parseInt(inp.dataset.idx);
      if (vols[idx]) vols[idx].title = inp.value;
    });
    document.querySelectorAll('.vol-arch-content').forEach(ta => {
      const idx = parseInt(ta.dataset.idx);
      if (vols[idx]) vols[idx].content = ta.value;
    });
    this.save();
  },

  // ========== 角色设定 ==========
  renderCharacters(container) {
    const chars = this.settings.characters || [];
    let html = `<div class="setting-panel active"><h4>👤 角色设定</h4>`;
    html += `<button class="btn btn-sm btn-primary" onclick="Settings.addCharacter()" style="margin-bottom:10px">＋ 添加角色</button>`;
    chars.forEach((ch, idx) => {
      html += `
        <div class="char-card-v2">
          <div class="char-card-v2-header">
            <input type="text" class="char-name" data-idx="${idx}" value="${escapeHtml(ch.name || '')}" placeholder="角色名称">
            <button class="btn btn-xs" style="color:var(--accent)" onclick="Settings.removeCharacter(${idx})">🗑</button>
          </div>
          <textarea class="char-desc" data-idx="${idx}" rows="3" placeholder="角色描述、性格、背景...">${escapeHtml(ch.description || '')}</textarea>
        </div>`;
    });
    html += `<button class="btn btn-sm btn-primary" onclick="Settings.saveCharacters()">💾 保存角色</button></div>`;
    container.innerHTML = html;
  },

  addCharacter() {
    this.settings.characters.push({ name: '', description: '' });
    this.renderCurrent();
  },

  removeCharacter(idx) {
    this.settings.characters.splice(idx, 1);
    this.renderCurrent();
  },

  saveCharacters() {
    const chars = this.settings.characters;
    document.querySelectorAll('.char-name').forEach(inp => {
      const idx = parseInt(inp.dataset.idx);
      if (chars[idx]) chars[idx].name = inp.value;
    });
    document.querySelectorAll('.char-desc').forEach(ta => {
      const idx = parseInt(ta.dataset.idx);
      if (chars[idx]) chars[idx].description = ta.value;
    });
    this.save();
  },

  // ========== 自定义设定 ==========
  renderCustomSetting(container, csId) {
    const cs = (this.settings.customSettings || []).find(c => c.id === csId);
    if (!cs) { container.innerHTML = '<div class="empty-hint">设定不存在</div>'; return; }
    container.innerHTML = `
      <div class="setting-panel active">
        <h4>📌 ${escapeHtml(cs.title || '未命名')}</h4>
        <label>标题</label>
        <input type="text" id="setting-custom-title" value="${escapeHtml(cs.title || '')}" placeholder="设定名称">
        <label>内容</label>
        <textarea id="setting-custom-content" rows="12" placeholder="设定内容...">${escapeHtml(cs.content || '')}</textarea>
        <button class="btn btn-sm btn-primary" onclick="Settings.saveCustomSetting('${csId}')">💾 保存</button>
        <button class="btn btn-sm" style="color:var(--accent);margin-left:6px" onclick="Settings.deleteCustomSetting('${csId}')">🗑 删除此设定</button>
      </div>`;
  },

  addCustomSetting() {
    const id = 'cs_' + Date.now();
    this.settings.customSettings.push({ id, title: '新设定', content: '' });
    this.save().then(() => {
      this.renderNav();
      this.switchTab('custom_' + id);
    });
  },

  saveCustomSetting(csId) {
    const cs = this.settings.customSettings.find(c => c.id === csId);
    if (!cs) return;
    cs.title = $('#setting-custom-title').value;
    cs.content = $('#setting-custom-content').value;
    this.save().then(() => this.renderNav());
  },

  deleteCustomSetting(csId) {
    if (!confirm('确定删除这个设定分类？')) return;
    this.settings.customSettings = this.settings.customSettings.filter(c => c.id !== csId);
    this.currentTab = 'overall';
    this.save().then(() => {
      this.renderNav();
      this.renderCurrent();
    });
  },

  // ========== 保存 ==========
  async save() {
    if (!this.projectId) return;
    await API.saveSettings(this.projectId, this.settings);
    App.setSaveStatus('💾 设定已保存');
  }
};
