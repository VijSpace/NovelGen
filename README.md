# NovelGen - AI小说生成器

基于 Electron + DeepSeek API 的交互式小说创作工具。

## 功能

- 📖 卷/章目录管理
- ✍️ Markdown 编辑器（撤销/重做）
- 🤖 AI 写作助手（支持工具调用：自动创建卷章、写入内容）
- ⚙️ 可配置的项目设定（总设定、分卷架构、角色设定）
- 📥 导入 .txt 文件自动提取结构
- 📤 导出为纯文本
- 💾 WPS 风格自动保存 + 崩溃恢复
- 📁 可配置数据存储路径

## 运行

```bash
npm install
npm start
```

## 技术栈

- Electron
- Vanilla JavaScript
- DeepSeek API (Function Calling)
