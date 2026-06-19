// ==================== Electron 主进程 ====================
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// 配置文件路径（存储在 userData 目录下）
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

// 读取配置
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) { /* 忽略损坏的配置 */ }
  return {};
}

// 保存配置
function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

// 获取数据目录：优先使用用户自定义路径，否则用默认路径
function getDataDir() {
  const config = loadConfig();
  return config.dataPath || path.join(app.getPath('userData'), 'projects');
}

// ==================== IPC：设置与路径管理 ====================

// 查询当前数据目录
ipcMain.handle('get-data-path', () => getDataDir());

// 获取所有设置
ipcMain.handle('settings:get', () => {
  const config = loadConfig();
  return {
    dataPath: config.dataPath || path.join(app.getPath('userData'), 'projects'),
    autoSaveInterval: config.autoSaveInterval || 60
  };
});

// 保存设置
ipcMain.handle('settings:set', async (event, settings) => {
  const config = loadConfig();
  if (settings.dataPath !== undefined) config.dataPath = settings.dataPath;
  if (settings.autoSaveInterval !== undefined) config.autoSaveInterval = settings.autoSaveInterval;
  saveConfig(config);
  return { success: true };
});

// 打开系统文件夹选择对话框
ipcMain.handle('dialog:select-folder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: '选择数据存储目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ==================== 备份与恢复 ====================

// 获取项目的备份文件路径
function getBackupPath(projectId) {
  const dataDir = getDataDir();
  return path.join(dataDir, projectId, 'project.json.autosave');
}

// 获取项目主文件路径
function getProjectPath(projectId) {
  return path.join(getDataDir(), projectId, 'project.json');
}

// ==================== IPC 处理：文件系统操作 ====================

// 列出所有项目
ipcMain.handle('projects:list', async () => {
  const dataDir = getDataDir();
  ensureDir(dataDir);
  const dirs = fs.readdirSync(dataDir).filter(d => {
    const p = path.join(dataDir, d);
    return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'project.json'));
  });
  return dirs.map(d => {
    const meta = JSON.parse(fs.readFileSync(path.join(dataDir, d, 'project.json'), 'utf-8'));
    return { id: d, name: meta.name, created: meta.created, updated: meta.updated };
  });
});

// 获取完整项目
ipcMain.handle('projects:get', async (event, id) => {
  const file = getProjectPath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
});

// 创建项目
ipcMain.handle('projects:create', async (event, project) => {
  const dataDir = getDataDir();
  const dir = path.join(dataDir, project.id);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2), 'utf-8');
  return project;
});

// 保存/更新项目（带备份保护）
ipcMain.handle('projects:save', async (event, project) => {
  const dir = path.join(getDataDir(), project.id);
  const file = path.join(dir, 'project.json');
  if (!fs.existsSync(file)) throw new Error('项目不存在');

  // WPS 风格：先写备份，再写正式文件，成功后删除备份
  const bakFile = getBackupPath(project.id);
  const content = JSON.stringify(project, null, 2);
  fs.writeFileSync(bakFile, content, 'utf-8');   // 先写备份
  fs.writeFileSync(file, content, 'utf-8');       // 再写正式文件
  if (fs.existsSync(bakFile)) {
    try { fs.unlinkSync(bakFile); } catch (e) { /* 忽略 */ }
  }
});

// 自动保存到备份文件（不覆盖正式文件）
ipcMain.handle('projects:autosave', async (event, project) => {
  const dir = path.join(getDataDir(), project.id);
  const bakFile = path.join(dir, 'project.json.autosave');
  ensureDir(dir);
  fs.writeFileSync(bakFile, JSON.stringify(project, null, 2), 'utf-8');
  return { success: true };
});

// 检查是否有自动保存备份
ipcMain.handle('projects:check-autosave', async (event, id) => {
  const bakFile = getBackupPath(id);
  const mainFile = getProjectPath(id);
  if (!fs.existsSync(bakFile)) return null;
  if (!fs.existsSync(mainFile)) {
    // 正式文件不存在，备份就是唯一数据
    const data = JSON.parse(fs.readFileSync(bakFile, 'utf-8'));
    return { exists: true, newer: true, data };
  }
  const bakStat = fs.statSync(bakFile);
  const mainStat = fs.statSync(mainFile);
  if (bakStat.mtimeMs > mainStat.mtimeMs) {
    const data = JSON.parse(fs.readFileSync(bakFile, 'utf-8'));
    return { exists: true, newer: true, data };
  }
  return { exists: true, newer: false };
});

// 从备份恢复
ipcMain.handle('projects:recover-autosave', async (event, id) => {
  const bakFile = getBackupPath(id);
  const mainFile = getProjectPath(id);
  if (!fs.existsSync(bakFile)) throw new Error('备份不存在');
  const content = fs.readFileSync(bakFile, 'utf-8');
  const data = JSON.parse(content);
  data.updated = new Date().toISOString();
  fs.writeFileSync(mainFile, JSON.stringify(data, null, 2), 'utf-8');
  try { fs.unlinkSync(bakFile); } catch (e) { /* 忽略 */ }
  return data;
});

// 删除备份
ipcMain.handle('projects:clear-autosave', async (event, id) => {
  const bakFile = getBackupPath(id);
  if (fs.existsSync(bakFile)) {
    try { fs.unlinkSync(bakFile); } catch (e) { /* 忽略 */ }
  }
  return { success: true };
});

// 删除项目
ipcMain.handle('projects:delete', async (event, id) => {
  const dir = path.join(getDataDir(), id);
  if (!fs.existsSync(dir)) throw new Error('项目不存在');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ==================== 创建窗口 ====================

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: '📚 NovelGen - AI小说生成器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // 安全：隔离渲染进程
      nodeIntegration: false     // 安全：不暴露 Node.js
    }
  });

  win.loadFile('public/index.html');

  // 开发时可按 F12 打开 DevTools
  // win.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
