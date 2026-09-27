const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const modes = {
  see: ['SEE / 看重点', 'What matters on this page?', '01 / 03　从满屏信息，到值得读的原文。'],
  find: ['FIND / 找原文', '训练需要多少 GPU？', '02 / 03　问题有了方向，答案有了出处。'],
  act: ['ACT / 去下一步', 'go to Appendix', '03 / 03　确认目标，再迈出下一步。'],
};
function setMode(mode) {
  document.body.dataset.mode = mode;
  for (const tab of tabs) {
    const active = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(`${tab.dataset.mode}-content`).hidden = !active;
  }
  document.getElementById('demo-panel').setAttribute('aria-labelledby', `tab-${mode}`);
  document.getElementById('mode-label').textContent = modes[mode][0];
  document.getElementById('demo-input').textContent = modes[mode][1];
  document.getElementById('experience-note').textContent = modes[mode][2];
  document.getElementById('article-main').hidden = false;
  document.getElementById('article-appendix').hidden = true;
  document.getElementById('page-number').textContent = '01 / 30';
  document.getElementById('approve').disabled = false;
  document.getElementById('approve').textContent = '确认跳转 ↗';
  document.getElementById('act-status').textContent = '先确认目标，再执行这一步。';
}
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
