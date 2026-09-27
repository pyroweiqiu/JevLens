import { slides } from './story.js';

const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const format = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const stage = $('#stage');
let index = 0;
let elapsed = 0;
let playing = true;
let lastTick = performance.now();
let lastPhase = -1;
let wheelSum = 0;
let wheelAt = 0;
let navigatedAt = -1000;

const intro = () => `
<section class="slide intro-slide" aria-labelledby="slide-title">
  <div class="intro-text"><p class="kicker">YOUR BROWSER. YOUR ATTENTION.</p>
  <h1 id="slide-title">Jev<span>Lens</span><i>把注意力，<br>放回重要的地方。</i></h1>
  <p class="definition">一个 Chrome 浏览器助手插件。<br>在网页与 PDF 里看重点、找原文、编排动作。</p>
  <p class="developer-credit">开发者：<strong>邱伟</strong></p>
  <p class="intro-foot">POWERED BY JEV <span>约 3 分钟 · 5 类场景</span></p></div>
  <div class="intro-type" aria-hidden="true"><span>See<span>看见重点</span></span><span>Find<span>找到原文</span></span><span>Act<span>动作编排</span></span><p>让阅读与行动，留在当前页面。</p></div>
</section>`;
const features = () => `
<section class="slide features-slide" aria-labelledby="slide-title"><p class="kicker">01 / THE TOOLKIT</p><h2 id="slide-title">一个侧栏，三个工作方式。</h2>
<div class="feature-list">
  <article data-reveal="0"><span class="feature-number">01</span><h3>See <small>看见重点</small></h3><p>标出值得读的句子，<br>保留作者的原话与上下文。</p><div class="feature-sample">页面里的 <mark>重要信息</mark> 浮现出来</div></article>
  <article data-reveal="1"><span class="feature-number">02</span><h3>Find <small>找到原文</small></h3><p>用问题表达意图，<br>直接定位相关段落。</p><div class="feature-sample">“训练需要多久？” <b>↗ 原文位置</b></div></article>
  <article data-reveal="2"><span class="feature-number">03</span><h3>Act <small>动作编排</small></h3><p>把目标拆成步骤，<br>预览、确认，再执行。</p><div class="feature-sample">找章节 <b>→</b> 确认 <b>→</b> 到达</div></article>
</div></section>`;
const philosophy = () => `
<section class="slide philosophy-slide" aria-labelledby="slide-title"><div><p class="kicker">02 / THE PHILOSOPHY</p><h2 id="slide-title">看得见依据。<br>掌握下一步。</h2><p class="philosophy-note">Jev 帮助判断相关性与候选目标。<br>界面把依据、位置和动作交还给你。</p></div>
<div class="principles">
  <article data-reveal="0"><span>01</span><div><h3>原文优先</h3><p>阅读结果能回到页面中的具体位置。</p></div></article>
  <article data-reveal="1"><span>02</span><div><h3>意图驱动</h3><p>按“想知道什么、想去哪里”组织功能。</p></div></article>
  <article data-reveal="2"><span>03</span><div><h3>行动可控</h3><p>目标先可见，动作逐步确认；随时停下。</p></div></article>
</div></section>`;
function demo(scene) {
  return `<section class="slide demo-slide" data-accent="${scene.accent}" aria-labelledby="slide-title">
    <div class="scene-heading"><div><p class="kicker">${String(index - 2).padStart(2, '0')} / 05 · ${escape(scene.category)}</p><h2 id="slide-title">${escape(scene.title)}</h2></div><span class="scene-mode">${scene.mode}</span></div>
    <div class="demo-layout"><div class="browser">
      <div class="browser-bar"><span class="traffic" aria-hidden="true">● ● ●</span><span>${escape(scene.domain)}</span><span>JevLens</span></div>
      <div class="browser-columns"><div class="document-window"><div class="document-sheet">
        <p class="document-label">${escape(scene.site)}</p><h3>${escape(scene.heading)}</h3><p>${escape(scene.intro)}</p>
        <div class="document-divider"></div><h4>${escape(scene.section)}</h4><p class="target-passage">${escape(scene.passage)}</p><p class="document-detail">${escape(scene.detail)}</p>
        <div class="document-lines" aria-hidden="true"></div></div></div>
      <aside class="demo-lens" aria-label="自动演示侧栏"><div class="lens-logo"><img src="../icon.svg" alt="" width="24" height="24">jev lens <span>${scene.mode}</span></div>
        <p class="lens-status">正在读取示例页面…</p><div class="query"><span class="query-text"></span><span class="caret" aria-hidden="true">|</span></div>
        <div class="result"><span class="result-label">${escape(scene.result)}</span><p>${escape(scene.mode === 'ACT' ? (scene.id === 57 ? '查找课程材料 → 打开 Syllabus' : scene.section) : scene.passage)}</p>${scene.mode === 'ACT' ? `<div class="approval">${scene.id === 57 ? '① 查找材料 ✓　② 打开 Syllabus' : '确认目标 → 执行导航'}</div><small>动画模拟确认 · 实际操作需用户确认</small>` : '<small>匹配原文 · 保留上下文</small>'}</div>
        <div class="arrival">✓ ${escape(scene.outcome)}</div>
      </aside></div></div>
      <div class="scene-notes"><ol class="steps">${scene.steps.map((step, n) => `<li data-step="${n}"><span>${n + 1}</span>${escape(step)}</li>`).join('')}</ol><p class="takeaway">${escape(scene.takeaway)}</p><div class="source-links"><a href="${scene.source}" target="_blank" rel="noopener noreferrer">${scene.sourceLabel} ↗</a><a href="../examples.html#case-${scene.id}" target="_blank" rel="noopener noreferrer">案例 #${scene.id} ↗</a></div></div>
    </div></section>`;
}
const closing = () => `
<section class="slide closing-slide" aria-labelledby="slide-title"><div class="closing-message"><p class="kicker">READ WITH INTENTION.</p><h2 id="slide-title">下一页网页，<br>换一种读法。</h2><p class="closing-copy">JevLens · 你的 Chrome 浏览器助手</p><div class="closing-links"><a class="primary-link" href="../downloads/JevLens-0.2.0-chrome.zip" download>下载插件 ZIP ↗</a><a href="../examples.html">探索 120 个场景 ↗</a><a href="../guide.html">使用文档 ↗</a></div><p class="closing-note">解压 → Chrome 开发者模式 → 加载已解压的扩展程序<br>Chrome Web Store · Coming soon</p></div><figure class="closing-qr"><a class="qr-frame" href="https://qrfy.io/LRoZa2y-cC" target="_blank" rel="noopener noreferrer" aria-label="打开二维码链接"><span class="qr-image-window"><img src="./closing-qr.png" alt="扫码了解更多，开发者邱伟提供的二维码" width="1898" height="2468" /></span></a><figcaption>扫码了解更多<small>开发者：邱伟</small></figcaption></figure></section>`;

const captions = {
  intro: [
    'JevLens 是一个 Chrome 浏览器插件，陪你阅读网页和 PDF。',
    'See 看重点，Find 找原文，Act 把目标拆成可确认的步骤。',
    '接下来用五类案例，看看它怎样融入真实的阅读场景。',
  ],
  features: [
    'See 将重要句子标在页面上，也在侧栏保留原文。',
    'Find 用意图定位相关段落，让问题有明确的出处。',
    'Act 支持导航与动作编排：每一步先推荐，再由你确认。',
  ],
  philosophy: [
    '原文优先：判断依据始终可以回到来源中核对。',
    '意图驱动：从阅读目标出发，让页面结构服务于你的问题。',
    '行动可控：你知道下一步是什么，也可以选择不执行。',
  ],
  closing: [
    '下载解压后的插件，即可在 Chrome 中加载使用。',
    '主页还有 120 个场景和使用文档，可继续探索。',
    '让注意力回到重要的地方。',
  ],
};
function renderFrame() {
  const slide = slides[index];
  const phase =
    slide.kind === 'demo'
      ? Math.min(3, Math.floor(elapsed / 5.75))
      : Math.min(2, Math.floor(elapsed / (slide.duration / 3)));
  if (phase !== lastPhase) {
    stage.dataset.phase = String(phase);
    const lines = slide.kind === 'demo' ? slide.scene.captions : captions[slide.kind];
    $('#caption').textContent = lines[phase];
    stage
      .querySelectorAll('[data-reveal]')
      .forEach((el) => el.classList.toggle('revealed', Number(el.dataset.reveal) <= phase));
    if (slide.kind === 'demo') {
      stage.querySelectorAll('[data-step]').forEach((el) => {
        el.classList.toggle('active', Number(el.dataset.step) === phase);
        el.classList.toggle('done', Number(el.dataset.step) < phase);
      });
      $('.lens-status').textContent = [
        '已读取示例内容',
        '正在输入目标…',
        slide.scene.mode === 'ACT' ? '预览目标 · 模拟确认' : '找到相关内容',
        '已定位 · 保留上下文',
      ][phase];
    }
    lastPhase = phase;
  }
  if (slide.kind === 'demo') {
    const chars = Math.max(0, Math.floor((elapsed - 5.75) * 10));
    $('.query-text').textContent = slide.scene.question.slice(0, chars);
  }
  $('#seek').value = String(elapsed);
  $('#time').textContent = `${format(elapsed)} / ${format(slide.duration)}`;
  $('#seek').style.setProperty('--progress', `${(elapsed / slide.duration) * 100}%`);
}
function updateControls() {
  const ended = elapsed >= slides[index].duration;
  $('#play').textContent = ended ? '重播 ↻' : playing ? '暂停 Ⅱ' : '播放 ▷';
  $('#play').setAttribute('aria-label', ended ? '重播本页' : playing ? '暂停演示' : '播放演示');
  $('#play-state').textContent = ended
    ? '本页演示结束 · 请手动翻页'
    : playing
      ? '页内自动演示 · 手动翻页'
      : '已暂停 · 手动翻页';
  $('#previous').disabled = index === 0;
  $('#next').disabled = index === slides.length - 1;
}
function goTo(next) {
  if (next < 0 || next >= slides.length) return;
  index = next;
  elapsed = 0;
  playing = true;
  lastPhase = -1;
  lastTick = performance.now();
  navigatedAt = lastTick;
  const slide = slides[index];
  stage.innerHTML =
    slide.kind === 'demo'
      ? demo(slide.scene)
      : { intro, features, philosophy, closing }[slide.kind]();
  stage.dataset.slide = String(index + 1);
  $('#seek').max = String(slide.duration);
  $('#slide-count').textContent = `${String(index + 1).padStart(2, '0')} / 09`;
  document.querySelectorAll('[data-chapter]').forEach((button, n) => {
    if (n === index) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  history.replaceState(null, '', `#slide-${index + 1}`);
  renderFrame();
  updateControls();
}
function togglePlayback() {
  if (elapsed >= slides[index].duration) elapsed = 0;
  playing = !playing;
  lastTick = performance.now();
  renderFrame();
  updateControls();
}
$('#chapters').innerHTML = slides
  .map(
    (slide, n) =>
      `<button data-chapter="${n}" aria-label="第 ${n + 1} 页：${slide.title}" title="${slide.title}">${n + 1}</button>`,
  )
  .join('');
$('#chapters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-chapter]');
  if (button) goTo(Number(button.dataset.chapter));
});
$('#previous').addEventListener('click', () => goTo(index - 1));
$('#next').addEventListener('click', () => goTo(index + 1));
$('#play').addEventListener('click', togglePlayback);
$('#seek').addEventListener('input', (event) => {
  elapsed = Number(event.target.value);
  playing = false;
  lastTick = performance.now();
  renderFrame();
  updateControls();
});
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    $('#play-state').textContent = '当前浏览器不支持全屏，可继续播放';
  }
}
$('#fullscreen').addEventListener('click', fullscreen);
document.addEventListener('keydown', (event) => {
  if (
    event.target.closest('input') ||
    (event.key === ' ' && event.target.closest('button, a')) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return;
  if (['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp', ' ', 'Home', 'End'].includes(event.key))
    event.preventDefault();
  if (['ArrowRight', 'PageDown'].includes(event.key)) goTo(index + 1);
  if (['ArrowLeft', 'PageUp'].includes(event.key)) goTo(index - 1);
  if (event.key === ' ') togglePlayback();
  if (event.key === 'Home') goTo(0);
  if (event.key === 'End') goTo(slides.length - 1);
  if (event.key.toLowerCase() === 'f') void fullscreen();
});
// Accumulate small trackpad deltas; one gesture advances one page.
stage.addEventListener(
  'wheel',
  (event) => {
    if (event.ctrlKey) return;
    event.preventDefault();
    const now = performance.now();
    if (now - navigatedAt < 900) return;
    if (now - wheelAt > 220) wheelSum = 0;
    wheelAt = now;
    wheelSum +=
      event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    if (Math.abs(wheelSum) >= 65) {
      goTo(index + Math.sign(wheelSum));
      wheelSum = 0;
    }
  },
  { passive: false },
);
let touch = null;
stage.addEventListener(
  'touchstart',
  (event) => {
    if (event.touches.length !== 1 || event.target.closest('a, button')) {
      touch = null;
      return;
    }
    touch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  },
  { passive: true },
);
stage.addEventListener(
  'touchend',
  (event) => {
    if (!touch || !event.changedTouches.length) return;
    const dx = touch.x - event.changedTouches[0].clientX;
    const dy = touch.y - event.changedTouches[0].clientY;
    touch = null;
    const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (Math.abs(delta) > 60) goTo(index + Math.sign(delta));
  },
  { passive: true },
);
document.addEventListener('visibilitychange', () => {
  lastTick = performance.now();
});
stage.addEventListener(
  'touchcancel',
  () => {
    touch = null;
  },
  { passive: true },
);
window.addEventListener('hashchange', () => {
  const match = location.hash.match(/^#slide-([1-9])$/);
  if (match) goTo(Number(match[1]) - 1);
});
function tick(now) {
  if (playing && !document.hidden) {
    elapsed = Math.min(slides[index].duration, elapsed + (now - lastTick) / 1000);
    renderFrame();
    if (elapsed >= slides[index].duration) {
      playing = false;
      updateControls();
    }
  }
  lastTick = now;
  requestAnimationFrame(tick);
}
const initial = location.hash.match(/^#slide-([1-9])$/);
goTo(initial ? Number(initial[1]) - 1 : 0);
requestAnimationFrame(tick);
