import { useEffect, useRef, useState, useMemo } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  Crosshair,
  FileText,
  Focus,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type ExtractedDocument,
  type ScoredUnit,
  type Metric,
  type ActionCandidate,
  type CursorDecision,
} from '../../src/shared/types';
import { pageRequest } from '../../src/messaging/transport';
import { eventSchema } from '../../src/messaging/protocol';
import { analyze, selectHighlights } from '../../src/jev/pipeline';
import { JevDecisionProvider, MockDecisionProvider } from '../../src/jev/client';
import { clearCache } from '../../src/cache/indexedDb';
import { loadSettings, PROVIDER_LABELS } from '../../src/shared/settings';
import ApiSettings from './components/ApiSettings';
export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  const tabRef = useRef<chrome.tabs.Tab | undefined>(undefined);
  const [doc, setDoc] = useState<ExtractedDocument>();
  const docRef = useRef<ExtractedDocument | undefined>(undefined);
  const [scores, setScores] = useState<ScoredUnit[]>([]);
  const [general, setGeneral] = useState<ScoredUnit[]>([]);
  const [intent, setIntent] = useState('');
  const intentRef = useRef('');
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'idle' | 'extracting' | 'scoring' | 'ready'>('idle');
  const [error, setError] = useState('');
  const [active, setActive] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [cursor, setCursor] = useState(false);
  const [findMode, setFindMode] = useState(false);
  const [actionExamples, setActionExamples] = useState<ActionCandidate[]>([]);
  const [actionMessage, setActionMessage] = useState('');
  const [actionDone, setActionDone] = useState('');
  const isPdf =
    !!doc?.units.some((u) => u.locator.kind === 'pdf-text') ||
    /\/pdf(?:\/|-viewer\.html)|\.pdf(?:[?#]|$)/i.test(tab?.url || '');
  const findExamples = [
    ...new Set(doc?.units.flatMap((u) => u.headingPath).filter(Boolean) || []),
  ].slice(0, 3);
  useEffect(() => {
    setActionExamples([]);
    if (!cursor || isPdf || tab?.id === undefined) return;
    let stale = false;
    void pageRequest<ActionCandidate[]>(tab.id, { type: 'ACTIONS' })
      .then((items) => {
        if (!stale)
          setActionExamples([
            ...items.filter(
              (item, index) =>
                item.role === 'html-section' &&
                items.findIndex((other) => other.fingerprint === item.fingerprint) === index,
            ),
            ...items
              .filter((item) => item.role !== 'html-section' && !item.riskHints.length)
              .slice(0, 3),
          ]);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [cursor, isPdf, tab?.id, doc?.documentId]);
  const [decision, setDecision] = useState<CursorDecision>();
  const [candidate, setCandidate] = useState<ActionCandidate>();
  const [cursorBusy, setCursorBusy] = useState(false);
  const [sensitiveAllowed, setSensitiveAllowed] = useState(false);
  const consentRef = useRef(false);
  const history = useRef<string[]>([]);
  const skipped = useRef(new Set<string>());
  const settingsRef = useRef(settings);
  const abort = useRef<AbortController | undefined>(undefined);
  const requestId = useRef(0);
  const cursorVersion = useRef(0);
  const cursorAbort = useRef<AbortController | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const manualScroll = useRef(0);
  const activeCard = useRef<HTMLButtonElement>(null);
  settingsRef.current = settings;
  intentRef.current = intent;
  const items = useMemo(
    () => selectHighlights(scores, settings.density, !!intent),
    [scores, settings.density, intent],
  );
  const unitMap = useMemo(() => new Map(doc?.units.map((u) => [u.unitId, u]) || []), [doc]);
  const index = Math.max(
    0,
    items.findIndex((i) => i.unitId === active),
  );
  async function save(next: Settings) {
    await chrome.storage.local.set({ settings: next });
    settingsRef.current = next;
    setSettings(next);
  }
  function stopCursor(leaveMode = true) {
    cursorVersion.current++;
    cursorAbort.current?.abort();
    if (leaveMode) setCursor(false);
    setCursorBusy(false);
    setDecision(undefined);
    setCandidate(undefined);
    if (tabRef.current?.id !== undefined)
      void pageRequest(tabRef.current.id, { type: 'STOP' }).catch(() => {});
  }
  async function run(
    document: ExtractedDocument,
    nextIntent: string,
    id: number,
    signal: AbortSignal,
  ) {
    const prefs = settingsRef.current;
    if (
      prefs.provider !== 'demo' &&
      (!prefs.remoteConsent || (document.sensitive && !consentRef.current))
    ) {
      setStatus('ready');
      return;
    }
    setStatus('scoring');
    try {
      await analyze(document, prefs, nextIntent || undefined, signal, (next, metric) => {
        if (id !== requestId.current) return;
        setScores(next);
        if (!nextIntent) setGeneral(next);
        setMetrics((old) => [...old.slice(-99), metric]);
      });
      if (id !== requestId.current) return;
      setStatus('ready');
    } catch (e) {
      if (signal.aborted || id !== requestId.current) return;
      setError(e instanceof Error ? e.message : 'Analysis failed.');
      setStatus('ready');
    }
  }
  async function refresh(nextTab = tabRef.current, nextIntent = intentRef.current) {
    if (nextTab?.id === undefined) return;
    const id = ++requestId.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    stopCursor();
    setError('');
    setStatus('extracting');
    try {
      const result = await pageRequest<ExtractedDocument>(nextTab.id, {
        type: 'EXTRACT',
        granularity: settingsRef.current.granularity,
      });
      if (id !== requestId.current) return;
      if (docRef.current?.url !== result.url) {
        consentRef.current = false;
        setSensitiveAllowed(false);
      }
      docRef.current = result;
      setDoc(result);
      setScores([]);
      setGeneral([]);
      setMetrics([]);
      setActive('');
      await run(result, nextIntent, id, controller.signal);
    } catch (e) {
      if (id !== requestId.current) return;
      setDoc(undefined);
      docRef.current = undefined;
      setScores([]);
      setError(e instanceof Error ? e.message : 'Cannot read page.');
      setStatus('ready');
    }
  }
  useEffect(() => {
    void chrome.storage.local.get('settings').then(({ settings: value }) => {
      const next = loadSettings(value);
      setSettings(next);
      settingsRef.current = next;
      if (value) void chrome.storage.local.set({ settings: next });
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const getTab = async () => {
      const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!current || disposed) return;
      const switchedTab = tabRef.current?.id !== current.id;
      const changed = switchedTab || tabRef.current?.url !== current.url;
      tabRef.current = current;
      setTab(current);
      if (changed) {
        if (switchedTab) history.current = [];
        skipped.current.clear();
        consentRef.current = false;
        setSensitiveAllowed(false);
        setIntent('');
        intentRef.current = '';
        if (switchedTab || !history.current.length) setDraft('');
        setDoc(undefined);
        docRef.current = undefined;
        setScores([]);
        void refresh(current, '');
      }
    };
    void getTab();
    const refreshChanged = async () => {
      const current = tabRef.current;
      if (current?.id === undefined) return;
      try {
        const snapshot = await pageRequest<ExtractedDocument>(current.id, {
          type: 'EXTRACT',
          granularity: settingsRef.current.granularity,
        });
        if (tabRef.current?.id !== current.id) return;
        if (snapshot.documentId === docRef.current?.documentId) {
          // A clock, animation, or unrelated widget must not restart in-flight inference.
          docRef.current = snapshot;
          setDoc(snapshot);
        } else await refresh(current);
      } catch {
        /* Navigation may temporarily disconnect the content script. */
      }
    };
    const activated = () => {
      void getTab();
    };
    const updated = (id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabRef.current?.id && (change.status === 'complete' || change.url)) {
        void getTab();
        if (change.status === 'complete') {
          clearTimeout(timer);
          timer = setTimeout(() => void refresh(), 300);
        }
      }
    };
    const listener = (message: any, sender: chrome.runtime.MessageSender) => {
      if (message?.target !== 'panel') return;
      if (message.command === 'focus-intent') {
        stopCursor();
        setFindMode(true);
        input.current?.focus();
      }
      if (message.command === 'activate-cursor') {
        setCursor(true);
        input.current?.focus();
      }
      if (message.command === 'stop-cursor') stopCursor();
      const event = eventSchema.safeParse(message.event);
      if (!event.success || (sender.tab?.id ?? message.tabId) !== tabRef.current?.id) return;
      if (event.data.type === 'PAGE_CHANGED') {
        stopCursor(false);
        clearTimeout(timer);
        timer = setTimeout(() => void refreshChanged(), 350);
      }
      if (event.data.type === 'ACTIVE' && event.data.documentId === docRef.current?.documentId)
        setActive(event.data.id);
      if (event.data.type === 'ESCAPE') {
        stopCursor();
        clearIntent();
      }
    };
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.runtime.onMessage.addListener(listener);
    let port: chrome.runtime.Port;
    let reconnect: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (disposed) return;
      port = chrome.runtime.connect({ name: 'jev-panel' });
      void chrome.windows
        .getCurrent()
        .then((w) => {
          if (!disposed) port.postMessage({ windowId: w.id });
        })
        .catch(() => {});
      port.onMessage.addListener((m) => {
        if (m.command === 'close') window.close();
      });
      port.onDisconnect.addListener(() => {
        if (!disposed) reconnect = setTimeout(connect, 500);
      });
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      abort.current?.abort();
      cursorAbort.current?.abort();
      clearTimeout(reconnect);
      port.disconnect();
      chrome.tabs.onActivated.removeListener(activated);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [loaded]);
  useEffect(() => {
    if (loaded && tabRef.current) void refresh();
  }, [settings.granularity, settings.provider, settings.connections, settings.remoteConsent]);
  useEffect(() => {
    if (!doc || tab?.id === undefined) return;
    void pageRequest(tab.id, {
      type: 'PAINT',
      documentId: doc.documentId,
      items,
      navigator: !!intent,
    }).catch(() => {});
  }, [items, doc, tab?.id, intent]);
  const jumped = useRef('');
  useEffect(() => {
    const key = `${doc?.documentId}:${intent}`;
    if (intent && items.length && status === 'ready' && jumped.current !== key) {
      jumped.current = key;
      select(items[0].unitId);
    }
  }, [status, intent, items, doc]);
  useEffect(() => {
    if (Date.now() - manualScroll.current > 2500)
      activeCard.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  function select(id: string) {
    setActive(id);
    if (tabRef.current?.id !== undefined)
      void pageRequest(tabRef.current.id, { type: 'SELECT', id }).catch((e) => setError(e.message));
  }
  function hover(id: string | null) {
    if (tabRef.current?.id !== undefined)
      void pageRequest(tabRef.current.id, { type: 'HOVER', id }).catch(() => {});
  }
  async function find(value = draft.trim()) {
    if (!docRef.current || !value) return;
    stopCursor();
    setFindMode(true);
    setDraft(value);
    setIntent(value);
    intentRef.current = value;
    setScores([]);
    setError('');
    jumped.current = '';
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    await run(docRef.current, value, ++requestId.current, controller.signal);
  }
  function clearIntent() {
    setFindMode(false);
    setIntent('');
    intentRef.current = '';
    setDraft('');
    abort.current?.abort();
    ++requestId.current;
    setScores(general);
    setStatus('ready');
    if (docRef.current) {
      const controller = new AbortController();
      abort.current = controller;
      void run(docRef.current, '', requestId.current, controller.signal);
    }
  }
  async function propose() {
    if (!draft.trim() || tabRef.current?.id === undefined) return;
    const tabId = tabRef.current.id;
    const version = ++cursorVersion.current;
    cursorAbort.current?.abort();
    const controller = new AbortController();
    cursorAbort.current = controller;
    setCursor(true);
    setCursorBusy(true);
    setActionDone('');
    setActionMessage('');
    setDecision(undefined);
    setCandidate(undefined);
    setError('');
    try {
      const prefs = settingsRef.current;
      const all = await pageRequest<ActionCandidate[]>(tabId, {
        type: 'ACTIONS',
        goal: draft.trim(),
      });
      if (version !== cursorVersion.current) return;
      const candidates = all.filter((c) => !skipped.current.has(c.fingerprint));
      const navigationTarget = candidates.find(
        (c) => c.role.startsWith('pdf-') || c.role === 'html-section',
      );
      if (!candidates.length) {
        setActionMessage(
          isPdf
            ? 'PDF actions support page and section navigation, for example: go to page 10, go to Appendix or 跳到附录. If this is Chrome’s PDF viewer, use Open PDF below first.'
            : 'No available controls found in the loaded page, or all suggestions were skipped. Try Find to locate text, or leave Act and try again.',
        );
        setDecision({ id: 'none', confidence: 0, probability: 0 });
        return;
      }
      if (
        !navigationTarget &&
        prefs.provider !== 'demo' &&
        (!prefs.remoteConsent || (docRef.current?.sensitive && !consentRef.current))
      )
        throw new Error('Enable page sharing before using Jev.');
      const provider =
        prefs.provider === 'demo' ? new MockDecisionProvider() : new JevDecisionProvider(prefs);
      const started = performance.now();
      const result: CursorDecision = navigationTarget
        ? { id: navigationTarget.id, confidence: 1, probability: 1 }
        : await provider.choose(candidates, draft.trim(), history.current, controller.signal);
      if (version !== cursorVersion.current) return;
      const target = candidates.find((c) => c.id === result.id);
      if (target) await pageRequest(tabId, { type: 'PROPOSE', id: target.id });
      if (version !== cursorVersion.current) return;
      setMetrics((old) => [
        ...old.slice(-99),
        {
          mode: 'cursor',
          units: candidates.length,
          latencyMs: Math.round(performance.now() - started),
          inputTokens: result.inputTokens || 0,
          outputTokens: result.outputTokens || 0,
          cacheHit: false,
        },
      ]);
      if (navigationTarget && candidates.length > 1)
        setActionMessage(
          `找到 ${candidates.length} 个同名章节。请核对目标；可点击 Skip 切换下一个。`,
        );
      if (!target)
        setActionMessage(
          'No matching button or link in the loaded page. Try its visible label using one of the examples. To locate information, use Find.',
        );
      setDecision(result);
      setCandidate(target);
    } catch (e) {
      if (version === cursorVersion.current)
        setError(e instanceof Error ? e.message : 'Cursor failed.');
    } finally {
      if (version === cursorVersion.current) setCursorBusy(false);
    }
  }
  async function execute() {
    if (!candidate || tabRef.current?.id === undefined) return;
    try {
      await pageRequest(tabRef.current.id, { type: 'EXECUTE', id: candidate.id, approved: true });
      history.current.push(`Executed ${candidate.accessibleName}`);
      setActionDone(
        candidate.role.startsWith('pdf-') || candidate.role === 'html-section'
          ? `Moved to ${candidate.accessibleName.replace('Go to ', '')}.`
          : `Clicked ${candidate.accessibleName}.`,
      );
      setDecision(undefined);
      setCandidate(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function openPdf() {
    void chrome.tabs.create({
      url:
        chrome.runtime.getURL('pdf-viewer.html') +
        (tab?.url?.startsWith('http') ? '?url=' + encodeURIComponent(tab.url) : ''),
    });
  }
  const busy = status === 'extracting' || status === 'scoring';
  const remoteBlocked =
    settings.provider !== 'demo' &&
    (!settings.remoteConsent || (!!doc?.sensitive && !sensitiveAllowed));
  return (
    <div
      className="app"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          stopCursor();
          clearIntent();
        }
        if (
          intent &&
          e.target !== input.current &&
          (e.key === 'ArrowDown' || e.key === 'ArrowUp')
        ) {
          e.preventDefault();
          const next =
            items[(index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
          if (next) select(next.unitId);
        }
      }}
    >
      <header className="header">
        <div className="brand">
          <span className="brand-mark">
            <Focus size={20} strokeWidth={1.7} />
          </span>
          <span>
            jev<span className="brand-light"> lens</span>
          </span>
        </div>
        <div className="header-actions">
          <span className="live-dot" />
          <button
            className="icon-button"
            title="Settings"
            aria-label="Settings"
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </header>
      <div className="page-context">
        <span className="eyebrow">YOUR ATTENTION, REFOCUSED</span>
        <h1 title={doc?.title || tab?.title}>
          {doc?.title || tab?.title || 'A little clarity for the web.'}
        </h1>
        <div className="source">
          <span className="source-dot" />
          {doc?.url
            ? (() => {
                try {
                  return new URL(doc.url).hostname || 'Local PDF';
                } catch {
                  return 'Document';
                }
              })()
            : 'Open a page to begin'}
          <ArrowUpRight size={12} />
        </div>
      </div>
      <nav className="mode-tabs" aria-label="Lens mode">
        <button
          className={!findMode && !cursor ? 'active' : ''}
          onClick={() => {
            stopCursor();
            clearIntent();
          }}
        >
          <Sparkles size={14} />
          See<span>01</span>
        </button>
        <button
          className={findMode && !cursor ? 'active' : ''}
          onClick={() => {
            stopCursor();
            setFindMode(true);
            setDraft(intent);
            input.current?.focus();
          }}
        >
          <Search size={14} />
          Find<span>02</span>
        </button>
        <button
          className={cursor ? 'active' : ''}
          onClick={() => {
            stopCursor();
            setCursor(true);
            setDraft('');
            setActionDone('');
            skipped.current.clear();
            input.current?.focus();
          }}
        >
          <Crosshair size={14} />
          Act<span>03</span>
        </button>
      </nav>
      {findMode && !cursor && (
        <section className="mode-guide">
          <strong>Find · 找原文</strong>
          <p>输入问题或关键词，查找当前页面的相关段落。点击结果跳到原文，不会生成聊天回答。</p>
          {settings.provider === 'demo' && (
            <p>Demo 使用关键词匹配；英文页面请先用英文关键词。跨语言理解需要配置 API。</p>
          )}
          <div className="example-chips">
            {findExamples.map((example) => (
              <button
                key={example}
                onClick={() => {
                  setDraft(example);
                  input.current?.focus();
                }}
              >
                {example}
              </button>
            ))}
          </div>
        </section>
      )}
      {settingsOpen && (
        <section className="settings">
          <div className="section-label">
            CONNECTION & PRIVACY
            <button
              className="icon-button"
              onClick={() => setSettingsOpen(false)}
              aria-label="Close settings"
            >
              <X size={14} />
            </button>
          </div>
          <button className="small-button" onClick={() => setApiSettingsOpen(true)}>
            Configure API · {PROVIDER_LABELS[settings.provider]}
          </button>
          <p>
            Forms, drafts and hidden text are excluded. Configure your API above or just above the
            intent input.
          </p>
          <div className="button-row">
            <button
              className="small-button"
              onClick={() => void clearCache().then(() => setError('Local score cache cleared.'))}
            >
              Clear cache
            </button>
            <button className="small-button" onClick={() => setStatsOpen(!statsOpen)}>
              Developer stats
            </button>
          </div>
        </section>
      )}
      {settings.provider === 'demo' && (
        <div className="demo-note">
          <span>DEMO</span>Local ranking · no AI requests
          <ChevronRight size={13} onClick={() => setApiSettingsOpen(true)} />
        </div>
      )}
      <div className="controls">
        <div className="segmented" aria-label="Precision">
          {(['sentence', 'paragraph'] as const).map((g) => (
            <button
              key={g}
              className={settings.granularity === g ? 'active' : ''}
              onClick={() => save({ ...settings, granularity: g })}
            >
              {g === 'sentence' ? 'Sentence' : 'Paragraph'}
            </button>
          ))}
        </div>
        <label className="density">
          Density
          <select
            aria-label="Highlight density"
            value={settings.density}
            onChange={(e) => save({ ...settings, density: Number(e.target.value) })}
          >
            <option value={0.1}>Light</option>
            <option value={0.2}>Balanced</option>
            <option value={0.35}>Rich</option>
          </select>
        </label>
      </div>
      <main
        className="main"
        onWheel={() => {
          manualScroll.current = Date.now();
        }}
        onTouchMove={() => {
          manualScroll.current = Date.now();
        }}
      >
        {remoteBlocked && (
          <div className="notice">
            <strong>You're in control of what leaves this page.</strong>
            <p>
              {!settings.remoteConsent
                ? 'Open API settings above the input to enable page sharing, or choose local Demo mode.'
                : 'This may be a private document. Allow analysis for this page only.'}
            </p>
            {settings.remoteConsent && (
              <button
                className="primary"
                onClick={() => {
                  consentRef.current = true;
                  setSensitiveAllowed(true);
                  void refresh();
                }}
              >
                Allow for this page
              </button>
            )}
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button className="text-button" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        {doc?.limited && <div className="notice">{doc.limited}</div>}
        {cursor ? (
          <section className="cursor-card">
            <span className="eyebrow">ONE INTENTIONAL STEP</span>
            <h2>Where to next?</h2>
            <p>
              {isPdf
                ? '输入 go to Appendix、跳到附录，或 go to page 10，确认后跳转。支持 PDF 目录标题；请在 Jev PDF Viewer 中使用。'
                : '输入 go to + 目录标题，或“跳到安装”，可定位当前页面章节，确认后跳转；也可以输入按钮名称，推荐点击操作。'}
            </p>
            <p>找内容用 Find；目录导航、点击按钮、跳页用 Act。</p>
            <div className="example-chips">
              {(isPdf
                ? ['go to Appendix', '跳到附录', 'go to page 10']
                : actionExamples
                    .filter((a) => a.role !== 'html-section')
                    .map((a) => a.accessibleName)
              ).map((example) => (
                <button
                  key={example}
                  onClick={() => {
                    setDraft(example);
                    input.current?.focus();
                  }}
                >
                  {example}
                </button>
              ))}
            </div>
            {!isPdf && actionExamples.some((a) => a.role === 'html-section') && (
              <details className="section-navigation" open>
                <summary>
                  本页目录 · {actionExamples.filter((a) => a.role === 'html-section').length} 个章节
                </summary>
                <p>点击标题填入指令，再点“推荐”。</p>
                <div>
                  {actionExamples
                    .filter((a) => a.role === 'html-section')
                    .map((a) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setDraft(a.navigationGoal || a.accessibleName);
                          input.current?.focus();
                        }}
                      >
                        {a.accessibleName.replace(/^Go to /, '')}
                      </button>
                    ))}
                </div>
              </details>
            )}
            {actionDone && <p role="status">{actionDone}</p>}
            {cursorBusy && (
              <div className="loading-line">
                <LoaderCircle className="spin" size={16} />
                Finding the next step…
              </div>
            )}
            {decision && (
              <div className="proposal">
                <span className="eyebrow">{candidate ? 'PROPOSED ACTION' : 'NO MATCH'}</span>
                <h3>{candidate?.accessibleName || 'No matching action'}</h3>
                {actionMessage && <p>{actionMessage}</p>}
                {candidate && (
                  <>
                    <p>
                      {candidate.role} ·{' '}
                      {candidate.role.startsWith('pdf-') || candidate.role === 'html-section'
                        ? 'Section navigation · no AI request'
                        : settings.provider === 'demo'
                          ? 'Demo suggestion'
                          : `${Math.round(decision.probability * 100)}% choice probability`}
                    </p>
                    {candidate.riskHints.length > 0 && (
                      <p className="risk">{candidate.riskHints.join(' ')}</p>
                    )}
                    <div className="button-row">
                      <button
                        className="primary"
                        disabled={!!candidate.riskHints.length}
                        onClick={() => void execute()}
                      >
                        <Check size={15} />
                        {candidate.role.startsWith('pdf-') || candidate.role === 'html-section'
                          ? 'Approve & go'
                          : 'Approve & click'}
                      </button>
                      <button
                        className="small-button"
                        onClick={() => {
                          skipped.current.add(candidate.fingerprint);
                          void propose();
                        }}
                      >
                        Skip
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <button className="text-button" onClick={() => stopCursor()}>
              <Square size={12} />
              Stop Cursor
            </button>
          </section>
        ) : (
          <>
            <div className="section-label">
              <span>
                {intent ? 'YOUR MATCHES' : 'HIGHLIGHT MAP'}{' '}
                <span className="count">{items.length.toString().padStart(2, '0')}</span>
              </span>
              <button
                className="icon-button"
                aria-label="Refresh page"
                onClick={() => void refresh()}
              >
                <RefreshCw size={14} className={busy ? 'spin' : ''} />
              </button>
            </div>
            {intent && (
              <div className="intent-label">
                <span>“{intent}”</span>
                <button className="icon-button" aria-label="Clear intent" onClick={clearIntent}>
                  <X size={13} />
                </button>
              </div>
            )}
            {busy && (
              <div className="progress">
                <div
                  style={{
                    width: `${doc?.units.length ? Math.max(5, (scores.length / doc.units.length) * 100) : 15}%`,
                  }}
                />
              </div>
            )}
            {busy && !items.length && (
              <div className="skeletons">
                {[1, 2, 3].map((n) => (
                  <div className="skeleton" key={n}>
                    <i />
                    <i />
                    <i />
                  </div>
                ))}
              </div>
            )}
            <div className="cards">
              {items.map((s, i) => {
                const u = unitMap.get(s.unitId);
                if (!u) return null;
                const level = s.score >= 0.85 ? 'Critical' : s.score >= 0.7 ? 'High' : 'Medium';
                return (
                  <button
                    key={s.unitId}
                    ref={active === s.unitId ? activeCard : undefined}
                    className={`highlight-card ${active === s.unitId ? 'selected' : ''}`}
                    onMouseEnter={() => hover(s.unitId)}
                    onMouseLeave={() => hover(null)}
                    onFocus={() => hover(s.unitId)}
                    onBlur={() => hover(null)}
                    onClick={() => select(s.unitId)}
                  >
                    <div className="card-top">
                      <span className="card-number">{String(i + 1).padStart(2, '0')}</span>
                      <span className="topic">
                        {u.headingPath.at(-1) || u.text.split(/\s+/).slice(0, 6).join(' ')}
                      </span>
                      <span className="score">
                        {Math.round(s.score * 100)}
                        <small>%</small>
                      </span>
                    </div>
                    <div className="card-content">
                      <span className={`level ${level.toLowerCase()}`}>
                        {intent ? 'Relevant' : level}
                        {settings.provider !== 'demo' && s.confidence < 0.4 ? ' · uncertain' : ''}
                      </span>
                      <p>{u.text}</p>
                      <span className="jump">
                        Jump to passage <ArrowUpRight size={12} />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {!busy && !items.length && !error && !remoteBlocked && (
              <div className="empty">
                <Focus size={30} />
                <h2>{intent ? 'Nothing close enough yet.' : 'Make room for what matters.'}</h2>
                <p>
                  {intent
                    ? settings.provider === 'demo'
                      ? 'Demo 按关键词匹配。请尝试原文中的词或上方标题示例；跨语言问题需要在 API settings 配置模型。'
                      : '没有找到相关原文。试试更短的关键词或上方标题示例。'
                    : 'Open an article, documentation or a PDF. The important passages will appear here.'}
                </p>
              </div>
            )}
            {items.length > 0 && (
              <p className="list-foot">Original passages. A clearer perspective.</p>
            )}
          </>
        )}
        {statsOpen && (
          <div className="stats">
            <b>THIS PAGE · {doc?.units.length || 0} units</b>
            <p>
              {metrics.length} batches · {metrics.filter((m) => m.cacheHit).length} cached
            </p>
            <p>
              {metrics.reduce((n, m) => n + m.inputTokens, 0)} input /{' '}
              {metrics.reduce((n, m) => n + m.outputTokens, 0)} output tokens
            </p>
            <p>
              {Math.round(metrics.reduce((n, m) => n + m.latencyMs, 0))} ms total ·{' '}
              {settings.granularity}
            </p>
            <button className="small-button" onClick={() => setStatsOpen(false)}>
              Hide
            </button>
          </div>
        )}
      </main>
      <footer className="footer">
        {intent && items.length > 0 && (
          <div className="match-nav">
            <span>
              {index + 1} / {items.length} matches
            </span>
            <div>
              <button
                className="icon-button"
                aria-label="Previous match"
                onClick={() => select(items[(index - 1 + items.length) % items.length].unitId)}
              >
                <ArrowUp size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="Next match"
                onClick={() => select(items[(index + 1) % items.length].unitId)}
              >
                <ArrowDown size={15} />
              </button>
            </div>
          </div>
        )}
        <button
          className="api-settings-trigger"
          aria-label="API settings"
          aria-haspopup="dialog"
          onClick={() => setApiSettingsOpen(true)}
        >
          <Settings2 size={14} />
          <span>API settings</span>
          <small>{PROVIDER_LABELS[settings.provider]}</small>
          <ChevronRight size={13} />
        </button>
        <form
          className="intent-box"
          onSubmit={(e) => {
            e.preventDefault();
            if (cursor) void propose();
            else void find();
          }}
        >
          <Search size={17} />
          <input
            ref={input}
            aria-label="Intent"
            value={draft}
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              cursor
                ? isPdf
                  ? 'go to Appendix / 跳到第10页'
                  : 'go to 章节标题 / 要点击的按钮名称'
                : '输入问题或关键词，查找原文'
            }
          />
          <button
            aria-label={cursor ? 'Suggest action' : 'Find passages'}
            type="submit"
            disabled={!draft.trim() || cursorBusy}
          >
            {cursor ? '推荐' : '查找'}
          </button>
        </form>
        <div className="footer-meta">
          <span>
            {busy
              ? `${status === 'extracting' ? 'Reading the page' : 'Finding what matters'}…`
              : cursor
                ? 'Every action needs your approval'
                : 'Follow your curiosity.'}
          </span>
          <button className="pdf-link" onClick={openPdf}>
            <FileText size={12} />
            Open PDF
          </button>
        </div>
      </footer>
      {apiSettingsOpen && (
        <ApiSettings
          settings={settings}
          onSave={(next) =>
            save({
              ...settingsRef.current,
              provider: next.provider,
              connections: next.connections,
              remoteConsent: next.remoteConsent,
            })
          }
          onClose={() => setApiSettingsOpen(false)}
        />
      )}
    </div>
  );
}
