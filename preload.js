// ==================== Electron 预加载脚本 ====================
// 通过 contextBridge 安全地向渲染进程暴露文件操作 API

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 项目 CRUD
  listProjects: () => ipcRenderer.invoke('projects:list'),
  getProject: (id) => ipcRenderer.invoke('projects:get', id),
  createProject: (project) => ipcRenderer.invoke('projects:create', project),
  saveProject: (project) => ipcRenderer.invoke('projects:save', project),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),

  // 自动保存
  autosaveProject: (project) => ipcRenderer.invoke('projects:autosave', project),
  checkAutosave: (id) => ipcRenderer.invoke('projects:check-autosave', id),
  recoverAutosave: (id) => ipcRenderer.invoke('projects:recover-autosave', id),
  clearAutosave: (id) => ipcRenderer.invoke('projects:clear-autosave', id),

  // 设置与路径
  getDataPath: () => ipcRenderer.invoke('get-data-path'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder')
});
