const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const input = document.getElementById('demo-input');
const documentPanel = document.querySelector('.sample-document');
const note = document.getElementById('experience-note');
const approve = document.getElementById('approve');
const modes = {
  see: ['SEE / 看重点', '看重点', '01 / 03　从满屏信息，到值得读的原文。'],
  find: ['FIND / 找原文', '训练需要多少 GPU？', '02 / 03　问题有了方向，答案有了出处。'],
  act: ['ACT / 动作编排', 'go to Appendix', '03 / 03　确认目标，再迈出下一步。'],
};
function setMode(mode) {
  document.body.dataset.mode = mode;
  for (const tab of tabs) {
    const active = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    const content = document.getElementById(`${tab.dataset.mode}-content`);
    content.hidden = !active;
    content.scrollTop = 0;
  }
  document.getElementById('demo-panel').setAttribute('aria-labelledby', `tab-${mode}`);
  document.getElementById('mode-label').textContent = modes[mode][0];
  input.value = modes[mode][1];
  input.removeAttribute('aria-invalid');
  document.querySelector('.find-result').hidden = false;
  document.querySelector('.action-card').hidden = false;
  document.querySelector('#find-content .query-bubble').textContent = modes.find[1];
  document.querySelector('#act-content .query-bubble').textContent = modes.act[1];
  clearLocation();
  documentPanel.scrollTop = 0;
  document.getElementById('experience-note').textContent = modes[mode][2];
  document.getElementById('article-main').hidden = false;
  document.getElementById('article-appendix').hidden = true;
  document.getElementById('page-number').textContent = '01 / 30';
  document.getElementById('approve').disabled = false;
  document.getElementById('approve').textContent = '确认跳转 ↗';
  document.getElementById('act-status').textContent = '本地示例：确认后跳到附录。';
}
function clearLocation() {
  document.querySelectorAll('.located').forEach((el) => el.classList.remove('located'));
}
function locate(passage) {
  clearLocation();
  const target = document.getElementById(passage);
  target.classList.add('located');
  // Scroll only the mock document, never the landing page.
  const targetRect = target.getBoundingClientRect();
  const panelRect = documentPanel.getBoundingClientRect();
  documentPanel.scrollTop += targetRect.top - panelRect.top - documentPanel.clientHeight / 3;
  note.textContent = '已定位原文；可滚动示例文档查看上下文。';
}
for (const button of document.querySelectorAll('[data-passage]')) {
  button.addEventListener('click', () => locate(button.dataset.passage));
}
document.getElementById('restart-demo').addEventListener('click', () => {
  setMode('see');
  note.textContent = '本地演示：选 See / Find / Act，再点击 ↑ 运行。';
  input.focus({ preventScroll: true });
  input.select();
});
input.addEventListener('input', () => {
  input.removeAttribute('aria-invalid');
  if (document.body.dataset.mode === 'act') {
    approve.disabled = true;
    document.querySelector('.action-card').hidden = true;
    document.getElementById('act-status').textContent = '点击 ↑ 提交指令，再确认目标。';
  }
});
document.getElementById('demo-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  const mode = document.body.dataset.mode;
  clearLocation();
  input.removeAttribute('aria-invalid');
  if (mode === 'find') document.querySelector('.find-result').hidden = true;
  if (mode === 'act') {
    document.querySelector('.action-card').hidden = true;
    approve.disabled = true;
  }
  if (!query) {
    input.setAttribute('aria-invalid', 'true');
    note.textContent = '请输入示例指令，或切换模式载入示例。';
    return;
  }
  if (mode === 'see' && /^(看重点|重点|提取重点|what matters on this page[?？]?)$/i.test(query)) {
    locate('key-passage');
    note.textContent = '已标出 2 处重点；点击「定位原文」查看。';
  } else if (mode === 'find') {
    document.querySelector('#find-content .query-bubble').textContent = query;
    if (/gpu|训练|training|多久|几天|时间|duration|days/i.test(query)) {
      document.querySelector('.find-result').hidden = false;
      locate('training-passage');
    } else {
      note.textContent = '本地示例仅演示训练信息，试试「训练需要多少 GPU？」';
    }
  } else if (mode === 'act') {
    document.querySelector('#act-content .query-bubble').textContent = query;
    if (
      /^(?:(?:go to|open|jump to)\s+)?(?:the\s+)?appendix[.!]?$/i.test(query) ||
      /^(?:跳转到?|前往|打开|去)?附录[。！]?$/.test(query)
    ) {
      document.getElementById('article-main').hidden = false;
      document.getElementById('article-appendix').hidden = true;
      document.getElementById('page-number').textContent = '01 / 30';
      documentPanel.scrollTop = 0;
      document.querySelector('.action-card').hidden = false;
      approve.disabled = false;
      approve.textContent = '确认跳转 ↗';
      document.getElementById('act-status').textContent = '已找到附录，等待你确认。';
      note.textContent = '目标已准备好；点击「确认跳转」执行。';
    } else {
      document.getElementById('act-status').textContent = '此演示支持「go to Appendix」。';
      note.textContent = '本地示例仅支持跳到附录；更多动作请安装插件。';
    }
  } else {
    note.textContent = '本地示例：See 输入「看重点」，提问请选 Find。';
  }
});
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
  tab.addEventListener('keydown', (event) => {
    const offset = ['ArrowRight', 'ArrowDown'].includes(event.key)
      ? 1
      : ['ArrowLeft', 'ArrowUp'].includes(event.key)
        ? -1
        : 0;
    if (!offset && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? tabs[0]
        : event.key === 'End'
          ? tabs.at(-1)
          : tabs[(index + offset + tabs.length) % tabs.length];
    setMode(next.dataset.mode);
    next.focus();
  });
}
document.getElementById('approve').addEventListener('click', () => {
  clearLocation();
  documentPanel.scrollTop = 0;
  note.textContent = '已到达附录；点击「可交互演示 ↻」重新体验。';
  document.getElementById('article-main').hidden = true;
  document.getElementById('article-appendix').hidden = false;
  document.getElementById('page-number').textContent = '30 / 30';
  document.getElementById('approve').textContent = '已到达附录 ✓';
  document.getElementById('approve').disabled = true;
  document.getElementById('act-status').textContent = '已定位第 30 页。接下来，由你决定。';
});
const dialog = document.getElementById('install-dialog');
document.getElementById('install').addEventListener('click', () => dialog.showModal());
document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
setMode('see');
