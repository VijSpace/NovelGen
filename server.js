const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3456;
const PROJECTS_DIR = path.join(__dirname, 'projects');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 确保项目目录存在
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// ==================== 项目 CRUD ====================

// 列出所有项目
app.get('/api/projects', (req, res) => {
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR).filter(d => {
      const p = path.join(PROJECTS_DIR, d);
      return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'project.json'));
    });
    const projects = dirs.map(d => {
      const meta = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, d, 'project.json'), 'utf-8'));
      return { id: d, ...meta };
    });
    res.json({ success: true, data: projects });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 创建项目
app.post('/api/projects', (req, res) => {
  try {
    const { name } = req.body;
    const id = uuidv4();
    const dir = path.join(PROJECTS_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
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
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2), 'utf-8');
    res.json({ success: true, data: project });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 获取项目详情
app.get('/api/projects/:id', (req, res) => {
  try {
    const file = path.join(PROJECTS_DIR, req.params.id, 'project.json');
    if (!fs.existsSync(file)) return res.json({ success: false, error: '项目不存在' });
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    res.json({ success: true, data });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 保存项目
app.put('/api/projects/:id', (req, res) => {
  try {
    const dir = path.join(PROJECTS_DIR, req.params.id);
    const file = path.join(dir, 'project.json');
    if (!fs.existsSync(file)) return res.json({ success: false, error: '项目不存在' });
    const data = req.body;
    data.updated = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 删除项目
app.delete('/api/projects/:id', (req, res) => {
  try {
    const dir = path.join(PROJECTS_DIR, req.params.id);
    if (!fs.existsSync(dir)) return res.json({ success: false, error: '项目不存在' });
    fs.rmSync(dir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 重命名项目
app.put('/api/projects/:id/rename', (req, res) => {
  try {
    const file = path.join(PROJECTS_DIR, req.params.id, 'project.json');
    if (!fs.existsSync(file)) return res.json({ success: false, error: '项目不存在' });
    const project = JSON.parse(fs.readFileSync(file, 'utf-8'));
    project.name = req.body.name;
    project.updated = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf-8');
    res.json({ success: true, data: project });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ==================== 卷和章的操作 ====================

// 添加卷
app.post('/api/projects/:id/volumes', (req, res) => {
  try {
    const file = path.join(PROJECTS_DIR, req.params.id, 'project.json');
    const project = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const volume = {
      id: uuidv4(),
      title: req.body.title || '新卷',
      order: project.volumes.length,
      chapters: []
    };
    project.volumes.push(volume);
    project.updated = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf-8');
    res.json({ success: true, data: volume });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 添加章
app.post('/api/projects/:id/volumes/:volId/chapters', (req, res) => {
  try {
    const file = path.join(PROJECTS_DIR, req.params.id, 'project.json');
    const project = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const vol = project.volumes.find(v => v.id === req.params.volId);
    if (!vol) return res.json({ success: false, error: '卷不存在' });
    const chapter = {
      id: uuidv4(),
      title: req.body.title || '新章',
      content: '',
      wordCount: 0,
      status: 'draft',
      order: vol.chapters.length,
      updated: new Date().toISOString()
    };
    vol.chapters.push(chapter);
    project.updated = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf-8');
    res.json({ success: true, data: chapter });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 更新章内容
app.put('/api/projects/:id/volumes/:volId/chapters/:chId', (req, res) => {
  try {
    const file = path.join(PROJECTS_DIR, req.params.id, 'project.json');
    const project = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const vol = project.volumes.find(v => v.id === req.params.volId);
    if (!vol) return res.json({ success: false, error: '卷不存在' });
    const ch = vol.chapters.find(c => c.id === req.params.chId);
    if (!ch) return res.json({ success: false, error: '章不存在' });
    if (req.body.content !== undefined) {
      ch.content = req.body.content;
      ch.wordCount = req.body.content.length;
    }
    if (req.body.title !== undefined) ch.title = req.body.title;
    if (req.body.prompt !== undefined) ch.prompt = req.body.prompt;
    if (req.body.status !== undefined) ch.status = req.body.status;
    ch.updated = new Date().toISOString();
    project.updated = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf-8');
    res.json({ success: true, data: ch });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 删除卷
app.delete('/api/projects/:id/volumes/:volId', (req, res) => {
  try {
    const file = path.join(PROJECTS_DIR, req.params.id, 'project.json');
    const project = JSON.parse(fs.readFileSync(file, 'utf-8'));
    project.volumes = project.volumes.filter(v => v.id !== req.params.volId);
    project.updated = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// 删除章
app.delete('/api/projects/:id/volumes/:volId/chapters/:chId', (req, res) => {
  try {
    const file = path.join(PROJECTS_DIR, req.params.id, 'project.json');
    const project = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const vol = project.volumes.find(v => v.id === req.params.volId);
    if (!vol) return res.json({ success: false, error: '卷不存在' });
    vol.chapters = vol.chapters.filter(c => c.id !== req.params.chId);
    project.updated = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ==================== 设定更新 ====================

app.put('/api/projects/:id/settings', (req, res) => {
  try {
    const file = path.join(PROJECTS_DIR, req.params.id, 'project.json');
    const project = JSON.parse(fs.readFileSync(file, 'utf-8'));
    project.settings = req.body;
    project.updated = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf-8');
    res.json({ success: true, data: project.settings });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ==================== DeepSeek API 代理 ====================

app.post('/api/agent/chat', async (req, res) => {
  try {
    const { apiKey, messages, model, tools, tool_choice } = req.body;
    if (!apiKey) return res.json({ success: false, error: '请先设置 API Key' });

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
      return res.json({ success: false, error: data.error.message || 'API 调用失败' });
    }
    res.json({ success: true, data: data.choices[0].message, fullResponse: data });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// 启动
app.listen(PORT, () => {
  console.log(`📚 小说生成器已启动: http://localhost:${PORT}`);
});
