import { examples } from './examples-data.js';
const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const labels = { extraction: '本地提取已测', unverified: '待实测', manual: '手动场景' };
const categories = new Map(examples.map((e) => [e.category, e.categoryLabel]));
for (const [value, label] of categories) $('category').add(new Option(label, value));
const boundaries = {
  98: '需要你自行登录；仅处理你有权访问且已加载的内容。不要为体验案例而上传私人订阅内容。',
  104: '动态内容可能需要登录。只分析已加载的帖子，不会自动滚动收集完整时间线。',
  114: '这是隐私边界检查，不建议用真实邮件测试 AI。保留 Demo，确认敏感页面许可提示，不发送邮件或邮箱内容。',
  115: '编辑区或 canvas 中的文档可能无法提取。此例用于了解限制，不是文档编辑功能；不要提交私人草稿。',
  116: 'Figma 画布内容不是普通 DOM，不能保证提取。仅页面可访问的文字控件可能可读，插件不能读取设计画面。',
  117: '先手动展开描述或字幕，只处理 DOM 中可见的文字，不识别视频或音频。',
  118: '先自行打开一个可访问帖子并加载正文，插件不会自动翻页或无限滚动抓取。',
  119: '仅在已获授权、正文可见时分析；不会绕过付费墙。只有摘要时只分析摘要。',
  120: '在 Jev PDF Viewer 选择你自己的文字型 PDF，文件地址不是网站链接。先使用 Demo；发送 AI 前需要额外允许。',
};
function note(e) {
  if (boundaries[e.id]) return boundaries[e.id];
  if (e.pdf)
    return '先进入 Jev PDF Viewer。扫描件没有文字层时无法查找；双栏、表格和公式可能影响提取顺序。';
  if (e.id === 100) return '先手动展开简介或字幕；只分析 DOM 可见文字，不分析视频画面。';
  if ([87, 80].includes(e.id))
    return '只处理 DOM 中的文字和列表，地图或图表画布内的数据不保证能读取。';
  if (['shopping', 'pricing', 'travel'].includes(e.category))
    return '价格、库存和搜索结果会变化；先手动选好条件并等待内容加载。只做原文定位，不自动付款、预订或提交。';
  if (['news', 'community', 'blogs'].includes(e.category))
    return '索引页只包含当前列表和摘要；要读全文，先自行打开一篇可访问文章。登录、订阅或付费限制不会被绕过。';
  return '只分析当前已加载且可读取的内容。若网页地址或标题变更，请用页面实际出现的关键词和目录标题。';
}
function queryBlock(label, text, name) {
  return `<div class="query-example"><span>${label}</span><div><code>${escape(text)}</code><button type="button" class="copy-button" data-copy="${escape(text)}" aria-label="复制${name}">复制</button></div></div>`;
}
function drawDetail(e, focus = false) {
  const restricted = [114, 115, 116].includes(e.id);
  const steps = e.pdf
    ? '通过侧栏 Open PDF 或右键 Open in Jev PDF Viewer 打开文件，等待文字层加载，然后打开 JevLens 侧栏。'
    : e.template
      ? '这是场景地址模板。先自行打开对应网站的一篇具体页面，再点击工具栏中的 JevLens。'
      : '打开原页面，等待正文加载。安装后首次使用请刷新网页，再点击工具栏中的 JevLens。';
  const proof =
    e.status === 'extraction'
      ? `${e.checkedOn} 本地规则回归：已验证文本提取和高亮。没有验证真实 AI 的排序、下面的自然语言问题或每个 Act 目标；网站当前可用性未重测。`
      : e.status === 'manual'
        ? '这个案例需要手动准备或用于检查支持边界，未宣称完整功能可用。'
        : '这是建议体验步骤，尚未逐项实测。原网页可能变化；若无匹配，请换成页面实际词语。';
  const link =
    !e.template && /^https?:/.test(e.url)
      ? `<a class="page-link" href="${escape(e.url)}" target="_blank" rel="noopener noreferrer">打开原页面 ↗</a>`
      : '<span class="template-label">地址模板 · 请自行选择具体页面或文件</span>';
  const act = e.pdf
    ? `${queryBlock('ACT · 文档至少有 2 页时', 'go to page 2', '页码指令')}输入后点击“推荐”，核对页码，再点 Approve &amp; go。章节导航可在本页目录选择已有标题；不要把正文提到某章节误认为可导航标题。`
    : '进入 Act，在“本页目录”选择当前文档实际列出的标题，点击“推荐”再点 Approve &amp; go。若页面没有目录或标题，使用 Find；要打开链接，使用页面已有的控件名称并先检查推荐目标。';
  $('example-detail').innerHTML = `
    <div class="detail-top"><button class="back-list" type="button">← 返回案例列表</button><span class="case-number">FIELD GUIDE / ${String(e.id).padStart(3, '0')}</span><button id="share-case" type="button">复制案例链接 ↗</button></div>
    <div class="detail-tags"><span>${escape(e.categoryLabel)}</span><span class="status-badge ${e.status}">${labels[e.status]}</span>${e.pdf ? '<span>PDF</span>' : ''}</div>
    <h2>${escape(e.title)}</h2><p class="case-goal">${escape(e.question)}</p>
    <div class="source-block">${link}<span class="source-url">${escape(e.url)}</span></div>
    <p class="verification-note">${proof}</p>
    <section class="recipe-step"><span class="step-number">01</span><div><h3>打开页面与插件</h3><p>${steps} <a href="./guide.html#start">安装指南 ↗</a></p></div></section>
    ${
      restricted
        ? `<section class="boundary-card"><h3>这次先检查支持边界</h3><p>${escape(note(e))}</p><p>不要把“无法提取”当成模型没理解。此类页面不提供可靠的 See / Find / Act 完整流程。</p><a href="./guide.html#privacy">了解隐私与支持范围 →</a></section>`
        : `
    <section class="recipe-step"><span class="step-number see-color">02</span><div><h3>See · 先看页面重点</h3><p>切换 See，尝试 Sentence / Paragraph 和 Density，再点一张卡片检查对应原文。围绕“${escape(e.question.replace(/[？。]$/, ''))}”查看内容。</p><p class="expected">观察：高亮对应正文，不是聊天式总结。Demo 只用于熟悉规则评分与操作。</p></div></section>
    <section class="recipe-step"><span class="step-number find-color">03</span><div><h3>Find · 复制一个词，先找原文</h3>${queryBlock('DEMO · 原文关键词起步', e.keyword, '关键词')}<p>粘贴到 Find，点击“查找”，点击结果检查上下文。若页面没有这个词，换成当前原文中的词。</p>${queryBlock('真实 AI · 可尝试的中文问题', e.question, '问题')}<p class="expected">先在 API settings 配置可用服务并允许发送内容。预期是定位相关原文，不生成答案；此问题的语义效果待你验证。</p></div></section>
    <section class="recipe-step"><span class="step-number act-color">04</span><div><h3>Act · 核对目标，再确认</h3><div class="act-instructions">${act}</div><p class="expected">确认前不执行。找不到目标时，展开实际内容或使用准确标题；不会自动展开、翻页、购买或发送。</p></div></section>
    <aside class="case-limit"><strong>这个页面要留意</strong><p>${escape(note(e))}</p></aside>`
    }
    <p class="copy-status" id="copy-status" role="status" aria-live="polite"></p>
    <a class="docs-link" href="./guide.html#troubleshooting">没找到结果？查看使用文档 →</a>`;
  $('example-detail').scrollTop = 0;
  if (focus) $('example-detail').focus({ preventScroll: true });
}
function filtered() {
  const term = $('search').value.trim().toLowerCase();
  return examples.filter(
    (e) =>
      ($('category').value === 'all' || e.category === $('category').value) &&
      ($('status').value === 'all' || e.status === $('status').value) &&
      `${e.id} ${e.title} ${e.url} ${e.keyword} ${e.question} ${e.categoryLabel}`
        .toLowerCase()
        .includes(term),
  );
}
function render(focus = false) {
  const matches = filtered();
  const selectedId = Number(location.hash.match(/^#case-(\d+)$/)?.[1]);
  const selected = examples.find((e) => e.id === selectedId) || matches[0];
  $('result-count').textContent = `${matches.length} / ${examples.length} 个场景`;
  $('empty-results').hidden = matches.length > 0;
  $('example-list').innerHTML = matches
    .map(
      (e) =>
        `<a href="#case-${e.id}" class="example-item" ${selected?.id === e.id ? 'aria-current="true"' : ''}><span class="item-number">${String(e.id).padStart(3, '0')}</span><span><strong>${escape(e.title)}</strong><small>${escape(e.categoryLabel)} · ${labels[e.status]}</small></span><span class="item-arrow" aria-hidden="true">↗</span></a>`,
    )
    .join('');
  $('workspace').classList.toggle('show-detail', !!selectedId && !!selected);
  if (selected) drawDetail(selected, focus);
  else
    $('example-detail').innerHTML =
      '<div class="detail-empty"><h2>给好奇心换个关键词。</h2><p>选择其他分类，或重置筛选重新开始。</p></div>';
}
function updateFilters() {
  const url = new URL(location.href);
  for (const [param, id] of [
    ['q', 'search'],
    ['category', 'category'],
    ['status', 'status'],
  ]) {
    const value = $(id).value;
    if (value && value !== 'all') url.searchParams.set(param, value);
    else url.searchParams.delete(param);
  }
  url.hash = '';
  history.replaceState(null, '', url);
  render();
}
function readFilters() {
  const params = new URLSearchParams(location.search);
  $('search').value = params.get('q') || '';
  $('category').value = categories.has(params.get('category')) ? params.get('category') : 'all';
  $('status').value = Object.hasOwn(labels, params.get('status')) ? params.get('status') : 'all';
}
$('search').addEventListener('input', updateFilters);
$('category').addEventListener('change', updateFilters);
$('status').addEventListener('change', updateFilters);
$('reset-filters').addEventListener('click', () => {
  $('search').value = '';
  $('category').value = 'all';
  $('status').value = 'all';
  updateFilters();
  $('search').focus();
});
$('example-list').addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (link?.hash === location.hash) render(true);
});
async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    $('copy-status').textContent = '已复制，可粘贴到插件或分享给朋友。';
    button.textContent = '已复制 ✓';
  } catch {
    $('copy-status').textContent = `浏览器未允许复制，请手动复制：${text}`;
  }
}
$('example-detail').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.matches('.back-list')) {
    const url = new URL(location.href);
    url.hash = '';
    history.pushState(null, '', url);
    render();
    $('example-list').querySelector('a')?.focus();
  } else if (button.id === 'share-case') {
    const id =
      Number($('example-list').querySelector('[aria-current]')?.hash.slice(6)) ||
      Number(location.hash.slice(6));
    const url = new URL('./examples.html', location.href);
    url.hash = `case-${id}`;
    void copy(url.href, button);
  } else if (button.dataset.copy) void copy(button.dataset.copy, button);
});
window.addEventListener('hashchange', () => render(true));
window.addEventListener('popstate', () => {
  readFilters();
  render();
});
readFilters();
render();
