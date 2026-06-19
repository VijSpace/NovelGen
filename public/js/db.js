// ==================== IndexedDB 存储层 ====================
// 替代服务端文件系统，数据存储在浏览器本地

const DB = {
  _db: null,
  _dbName: 'novelwriter_db',
  _version: 1,

  // 初始化数据库
  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this._dbName, this._version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        this._db = e.target.result;
        resolve(this._db);
      };
      req.onerror = (e) => {
        console.error('IndexedDB 打开失败:', e.target.error);
        reject(e.target.error);
      };
    });
  },

  // 获取事务
  _tx(mode = 'readonly') {
    return this._db.transaction('projects', mode).objectStore('projects');
  },

  // ========== 项目 CRUD ==========

  // 列出所有项目（返回简要信息）
  async listProjects() {
    return new Promise((resolve, reject) => {
      const store = this._tx();
      const req = store.getAll();
      req.onsuccess = () => {
        const projects = req.result.map(p => ({
          id: p.id,
          name: p.name,
          created: p.created,
          updated: p.updated
        }));
        resolve(projects);
      };
      req.onerror = () => reject(req.error);
    });
  },

  // 获取完整项目
  async getProject(id) {
    return new Promise((resolve, reject) => {
      const store = this._tx();
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  // 创建项目
  async createProject(project) {
    return new Promise((resolve, reject) => {
      const store = this._tx('readwrite');
      const req = store.add(project);
      req.onsuccess = () => resolve(project);
      req.onerror = () => reject(req.error);
    });
  },

  // 保存/更新项目
  async saveProject(project) {
    return new Promise((resolve, reject) => {
      const store = this._tx('readwrite');
      const req = store.put(project);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  // 删除项目
  async deleteProject(id) {
    return new Promise((resolve, reject) => {
      const store = this._tx('readwrite');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
};
