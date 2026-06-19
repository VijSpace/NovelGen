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

  async reorderVolumes(pid, orderedIds) {
    try {
      const project = await this._getProject(pid);
      const volMap = new Map(project.volumes.map(v => [v.id, v]));
      project.volumes = orderedIds.map(id => volMap.get(id)).filter(Boolean);
      await this._saveProject(project);
      return { success: true };
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

  async renameVolume(pid, vid, newTitle) {
    try {
      const project = await this._getProject(pid);
      const vol = project.volumes.find(v => v.id === vid);
      if (!vol) return { success: false, error: '卷不存在' };
      vol.title = newTitle;
      await this._saveProject(project);
      return { success: true, data: vol };
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

  async renameChapter(pid, vid, cid, newTitle) {
    try {
      const project = await this._getProject(pid);
      const vol = project.volumes.find(v => v.id === vid);
      if (!vol) return { success: false, error: '卷不存在' };
      const ch = vol.chapters.find(c => c.id === cid);
      if (!ch) return { success: false, error: '章不存在' };
      ch.title = newTitle;
      await this._saveProject(project);
      return { success: true, data: ch };
    } catch (e) { return { success: false, error: e.message }; }
  },

  async reorderChapters(pid, vid, orderedIds) {
    try {
      const project = await this._getProject(pid);
      const vol = project.volumes.find(v => v.id === vid);
      if (!vol) return { success: false, error: '卷不存在' };
      const chMap = new Map(vol.chapters.map(c => [c.id, c]));
      vol.chapters = orderedIds.map(id => chMap.get(id)).filter(Boolean);
      await this._saveProject(project);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  },

  async moveChapter(pid, fromVid, chId, toVid, toIndex) {
    try {
      const project = await this._getProject(pid);
      const fromVol = project.volumes.find(v => v.id === fromVid);
      if (!fromVol) return { success: false, error: '源卷不存在' };
      const chIdx = fromVol.chapters.findIndex(c => c.id === chId);
      if (chIdx < 0) return { success: false, error: '章不存在' };
      const [ch] = fromVol.chapters.splice(chIdx, 1);
      const toVol = project.volumes.find(v => v.id === toVid);
      if (!toVol) return { success: false, error: '目标卷不存在' };
      toVol.chapters.splice(toIndex, 0, ch);
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
        model: model || 'deepseek-v4-flash',
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

  // 流式对话：返回 async generator，逐块 yield SSE 数据
  async *chatStream(apiKey, messages, model, tools, tool_choice, signal) {
    if (!apiKey) throw new Error('请先设置 API Key');

    const body = {
      model: model || 'deepseek-v4-flash',
      messages,
      temperature: 0.8,
      max_tokens: 4096,
      stream: true
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
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') return;
        try {
          yield JSON.parse(jsonStr);
        } catch (e) { /* 忽略解析错误 */ }
      }
    }
  },
};
