// ==================== API 层 ====================
// Electron 模式：通过 IPC 读写硬盘上的 project.json 文件（像 WPS）
// 浏览器模式：使用 IndexedDB（像普通网页）

const { v4: uuidv4 } = (() => {
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  return { v4: generateUUID };
})();

// 检测运行环境
const isElectron = !!(window.electronAPI);

const API = {
  // ========== 项目 CRUD ==========

  async getProjects() {
    try {
      const data = isElectron
        ? await window.electronAPI.listProjects()
        : await DB.listProjects();
      return { success: true, data };
    } catch (e) { return { success: false, error: e.message }; }
  },

  async createProject(name) {
    try {
      const id = uuidv4();
      const project = {
        id, name,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        volumes: [],
        settings: {
          systemPrompt: '',
          overall: { summary: '', content: '' },
          volumeArchitecture: { volumes: [] },
          characters: [],
          customSettings: []
        }
      };
      if (isElectron) {
        await window.electronAPI.createProject(project);
      } else {
        await DB.createProject(project);
      }
      return { success: true, data: project };
    } catch (e) { return { success: false, error: e.message }; }
  },

  async getProject(id) {
    try {
      const data = isElectron
        ? await window.electronAPI.getProject(id)
        : await DB.getProject(id);
      if (!data) return { success: false, error: '项目不存在' };
      return { success: true, data };
    } catch (e) { return { success: false, error: e.message }; }
  },

  async saveProject(id, data) {
    try {
      data.updated = new Date().toISOString();
      if (isElectron) {
        const existing = await window.electronAPI.getProject(id);
        if (!existing) return { success: false, error: '项目不存在' };
        await window.electronAPI.saveProject(data);
      } else {
        const existing = await DB.getProject(id);
        if (!existing) return { success: false, error: '项目不存在' };
        await DB.saveProject(data);
      }
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  },

  async deleteProject(id) {
    try {
      if (isElectron) {
        await window.electronAPI.deleteProject(id);
      } else {
        await DB.deleteProject(id);
      }
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  },

  async renameProject(id, name) {
    try {
      const project = isElectron
        ? await window.electronAPI.getProject(id)
        : await DB.getProject(id);
      if (!project) return { success: false, error: '项目不存在' };
      project.name = name;
      project.updated = new Date().toISOString();
      if (isElectron) {
        await window.electronAPI.saveProject(project);
      } else {
        await DB.saveProject(project);
      }
      return { success: true, data: project };
    } catch (e) { return { success: false, error: e.message }; }
  },

  // ========== 通用：读取-修改-保存 ==========

  async _getProject(pid) {
    const p = isElectron
      ? await window.electronAPI.getProject(pid)
      : await DB.getProject(pid);
    if (!p) throw new Error('项目不存在');
    return p;
  },

  async _saveProject(project) {
    project.updated = new Date().toISOString();
    if (isElectron) {
      await window.electronAPI.saveProject(project);
    } else {
      await DB.saveProject(project);
    }
  },

  // ========== 卷操作 ==========

  async addVolume(pid, title) {
    try {
      const project = await this._getProject(pid);
      const volume = {
        id: uuidv4(),
        title: title || '新卷',
        order: project.volumes.length,
        chapters: []
      };
      project.volumes.push(volume);
      await this._saveProject(project);
      return { success: true, data: volume };
    } catch (e) { return { success: false, error: e.message }; }
  },

  async deleteVolume(pid, vid) {
    try {
      const project = await this._getProject(pid);
      project.volumes = project.volumes.filter(v => v.id !== vid);
      await this._saveProject(project);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  },

  // ========== 章操作 ==========

  async addChapter(pid, vid, title) {
    try {
      const project = await this._getProject(pid);
      const vol = project.volumes.find(v => v.id === vid);
      if (!vol) return { success: false, error: '卷不存在' };
      const chapter = {
        id: uuidv4(),
        title: title || '新章',
        content: '',
        wordCount: 0,
        status: 'draft',
        order: vol.chapters.length,
        updated: new Date().toISOString()
      };
      vol.chapters.push(chapter);
      await this._saveProject(project);
      return { success: true, data: chapter };
    } catch (e) { return { success: false, error: e.message }; }
  },

  async updateChapter(pid, vid, cid, data) {
    try {
      const project = await this._getProject(pid);
      const vol = project.volumes.find(v => v.id === vid);
      if (!vol) return { success: false, error: '卷不存在' };
      const ch = vol.chapters.find(c => c.id === cid);
      if (!ch) return { success: false, error: '章不存在' };
      if (data.content !== undefined) {
        ch.content = data.content;
        ch.wordCount = data.content.length;
      }
      if (data.title !== undefined) ch.title = data.title;
      if (data.prompt !== undefined) ch.prompt = data.prompt;
      if (data.status !== undefined) ch.status = data.status;
      ch.updated = new Date().toISOString();
      await this._saveProject(project);
      return { success: true, data: ch };
    } catch (e) { return { success: false, error: e.message }; }
  },

  async deleteChapter(pid, vid, cid) {
    try {
      const project = await this._getProject(pid);
      const vol = project.volumes.find(v => v.id === vid);
      if (!vol) return { success: false, error: '卷不存在' };
      vol.chapters = vol.chapters.filter(c => c.id !== cid);
      await this._saveProject(project);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  },

  // ========== 设定操作 ==========

  async saveSettings(pid, settings) {
    try {
      const project = await this._getProject(pid);
      project.settings = settings;
      await this._saveProject(project);
      return { success: true, data: project.settings };
    } catch (e) { return { success: false, error: e.message }; }
  },

  // ========== AI 对话（直接调用 DeepSeek API） ==========

  async chat(apiKey, messages, model, tools, tool_choice) {
    try {
      if (!apiKey) return { success: false, error: '请先设置 API Key' };

      const body = {
        model: model || 'deepseek-chat',
        messages,
        temperature: 0.8,
        max_tokens: 4096,
        stream: false
      };
      if (tools && tools.length > 0) {
        body.tools = tools;
        if (tool_choice) body.tool_choice = tool_choice;
      }

      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      if (data.error) {
        return { success: false, error: data.error.message || 'API 调用失败' };
      }
      return { success: true, data: data.choices[0].message, fullResponse: data };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
};
