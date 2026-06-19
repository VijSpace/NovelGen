// ==================== 工具函数 ====================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN');
}

function debounce(fn, ms = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// 提取 AI 回复中的代码块内容（用于"应用到章节"）
function extractCodeBlock(text) {
  const m = text.match(/```[\s\S]*?\n([\s\S]*?)```/);
  return m ? m[1].trim() : text.trim();
}

// 从 AI 回复中检测是否是小说正文（大段叙事文字，非指令性回复）
function extractNovelContent(text) {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/【[^】]*】/g, '')
    .replace(/^[#\->*].*$/gm, '')
    .trim();
  return cleaned;
}

// 阿拉伯数字 → 中文
function toCN(n) {
  const m = ['','一','二','三','四','五','六','七','八','九','十'];
  if (n <= 10) return m[n];
  if (n < 20) return '十' + m[n - 10];
  return m[Math.floor(n/10)] + '十' + (n%10 ? m[n%10] : '');
}

// ==================== 自定义弹窗 ====================
function showModal(title, bodyHtml, footerHtml) {
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalFooter').innerHTML = footerHtml;
  overlay.style.display = 'flex';
  const input = overlay.querySelector('input');
  if (input) setTimeout(() => input.focus(), 100);
  return () => { overlay.style.display = 'none'; };
}

// 替代 prompt()
function showPrompt(title, defaultVal = '') {
  return new Promise((resolve) => {
    const close = showModal(
      title,
      `<input type="text" id="modalInput" value="${escapeHtml(defaultVal)}">`,
      `<button class="btn btn-sm" id="modalCancel">取消</button>
       <button class="btn btn-sm btn-primary" id="modalOk">确定</button>`
    );
    document.getElementById('modalOk').onclick = () => {
      const val = document.getElementById('modalInput').value.trim();
      close(); resolve(val);
    };
    document.getElementById('modalCancel').onclick = () => { close(); resolve(''); };
    document.getElementById('modalInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { document.getElementById('modalOk').click(); }
      if (e.key === 'Escape') { document.getElementById('modalCancel').click(); }
    });
  });
}

// 替代 confirm()
function showConfirm(title) {
  return new Promise((resolve) => {
    const close = showModal(
      title,
      '<div class="modal-msg"></div>',
      `<button class="btn btn-sm" id="modalCancel">取消</button>
       <button class="btn btn-sm btn-primary" id="modalOk">确定</button>`
    );
    document.getElementById('modalOk').onclick = () => { close(); resolve(true); };
    document.getElementById('modalCancel').onclick = () => { close(); resolve(false); };
    setTimeout(() => document.getElementById('modalOk').focus(), 100);
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Enter') { document.removeEventListener('keydown', onKey); document.getElementById('modalOk').click(); }
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); document.getElementById('modalCancel').click(); }
    });
  });
}

// 替代 alert()
function showAlert(msg) {
  return new Promise((resolve) => {
    const close = showModal(
      '提示',
      `<p>${escapeHtml(msg)}</p>`,
      `<button class="btn btn-sm btn-primary" id="modalOk">确定</button>`
    );
    document.getElementById('modalOk').onclick = () => { close(); resolve(); };
    setTimeout(() => document.getElementById('modalOk').focus(), 100);
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Enter' || e.key === 'Escape') { document.removeEventListener('keydown', onKey); document.getElementById('modalOk').click(); }
    });
  });
}
