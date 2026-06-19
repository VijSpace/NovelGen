# 📚 NovelGen - AI 小说创作助手

基于 **Electron** + **DeepSeek API** 的交互式长篇小说创作工具。像 OneNote 一样管理卷章结构，AI 辅助生成与改写内容。

## ✨ 功能

### 📖 项目管理
- 多项目支持，每个项目独立存储卷、章、设定、AI 对话
- 可配置数据存储路径，支持自定义目录
- 项目级撤销/重做（Ctrl+Z / Ctrl+Shift+Z），最多 50 步

### 📂 卷章目录
- 卷/章树形目录，支持展开折叠
- **拖拽排序**：卷和章可自由拖动调整顺序，支持跨卷移动章节
- 一键添加卷/章（虚线按钮，无需弹窗确认）
- 卷/章重命名、删除（⋮ 菜单）
- 添加章后自动打开编辑器

### ✍️ 正文编辑
- 全屏 Markdown 编辑器
- 章节标题、正文、精确提示（AI 上下文）
- 字数实时统计
- **WPS 风格自动保存**：定时保存 + 崩溃恢复备份
- Ctrl+S 手动保存

### 🤖 AI 写作助手
- 接入 **DeepSeek API**（支持 Function Calling）
- AI 可自动调用工具：创建卷、创建章、写入章节内容、更新设定
- 多轮对话，AI 理解全书上下文
- 发送选中文本给 AI 改写
- **每个项目的 AI 对话独立隔离**，切换项目不串数据
- 支持多会话管理（新建/切换/删除会话）

### ⚙️ 项目设定
- 总设定（摘要 + 详细）
- 分卷架构规划
- 角色设定管理
- 自定义设定分类
- 所有设定自动保存，AI 对话可引用

### 📥 导入导出
- **AI 智能导入**：粘贴任意文本（小说、大纲、笔记），AI 自动提取卷章结构和设定
- 支持 **Excel (.xlsx/.xls/.csv)** 导入
- 导出为纯文本格式

### 🎨 界面
- 三栏布局：目录树 | 编辑/设定 | AI 助手
- 面板宽度可拖拽调整
- VS Code 风格欢迎引导页
- 自动记忆上次工作位置（项目、章节、标签页）
- 开发者工具（F12）

### 💾 数据安全
- JSON 文件存储，人类可读
- 自动保存 + 备份保护（先写备份再写正式文件）
- 崩溃恢复：重启时检测未保存的自动备份
- 可配置数据目录（默认 `%APPDATA%/novelgen/projects`）

## 🚀 运行

```bash
# 安装依赖
npm install

# 开发运行
npm start

# 打包 Windows 安装包
npm run build
```

## 🏗 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron 33 |
| 前端 | Vanilla JS（零框架依赖） |
| AI | DeepSeek API（chat + function calling） |
| 存储 | Node.js fs（JSON 文件） + IndexedDB（浏览器降级） |
| 打包 | electron-builder (NSIS) |
| 导入 | SheetJS (xlsx/csv 解析) |

## 📁 项目结构

```
novelgen/
├── main.js              # Electron 主进程（IPC、菜单、文件系统）
├── preload.js           # contextBridge 安全暴露 API
├── server.js            # （备用）Express 服务端
├── package.json
├── public/
│   ├── index.html       # 主界面
│   ├── css/style.css    # 样式
│   └── js/
│       ├── app.js       # 主应用逻辑（项目管理、撤销、导入导出）
│       ├── agent.js     # AI 助手（会话管理、工具调用、消息发送）
│       ├── api.js       # API 层（项目 CRUD、卷章操作）
│       ├── novelTree.js # 目录树组件（渲染、拖拽排序）
│       ├── settings.js  # 设定面板
│       ├── db.js        # IndexedDB 降级存储
│       └── utils.js     # 工具函数
└── assets/              # 应用图标
```

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+S | 保存当前章节 |
| Ctrl+Z | 项目级撤销 |
| Ctrl+Shift+Z | 项目级重做 |
| F12 | 开发者工具 |
| Ctrl+R | 刷新界面 |

## 📄 License

MIT
