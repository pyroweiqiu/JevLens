import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type {
  ActionCandidate,
  CursorDecision,
  ExtractedDocument,
  Metric,
  ScoredUnit,
  Settings,
} from '../../../src/shared/types';
import { pageRequest } from '../../../src/messaging/transport';
import { JevDecisionProvider, MockDecisionProvider } from '../../../src/jev/client';
import { analyze, selectHighlights } from '../../../src/jev/pipeline';
import {
  delay,
  guardMatches,
  nextStep,
  parseWorkflow,
  type WorkflowStep,
} from '../../../src/cursor/workflow';
export interface ComposerHandle {
  propose(goal: string): void;
  stop(): void;
}
interface Props {
  tabId?: number;
  document?: ExtractedDocument;
  settings: Settings;
  sensitiveAllowed: boolean;
  isPdf: boolean;
  setDraft: (goal: string) => void;
  onBusy: (busy: boolean) => void;
  onMetric: (metric: Metric) => void;
}
interface Proposal {
  stepId: string;
  candidate?: ActionCandidate;
  decision?: CursorDecision;
  doc?: ExtractedDocument;
  scores?: ScoredUnit[];
  direct?: boolean;
  notice?: string;
}
const navigation = (c?: ActionCandidate) =>
  c?.role.startsWith('pdf-') || c?.role === 'html-section' || c?.role === 'page-scroll';
const kinds = {
  action: '页面动作',
  find: '查找原文',
  scroll: '滚动',
  wait: '等待',
  manual: '手动步骤',
};
export default forwardRef<ComposerHandle, Props>(function ActionComposer(props, ref) {
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [editor, setEditor] = useState('');
  const [dirty, setDirty] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [catalog, setCatalog] = useState<ActionCandidate[]>([]);
  const [filter, setFilter] = useState('');
  const [group, setGroup] = useState('all');
  const [proposal, setProposal] = useState<Proposal>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const current = useRef(props);
  current.current = props;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const version = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const executing = useRef(false);
  const history = useRef<string[]>([]);
  const omitted = useRef(new Set<string>());
  const disposed = useRef(false);
  const index = nextStep(steps);
  const step = steps[index];
  function setWorking(value: boolean) {
    setBusy(value);
    current.current.onBusy(value);
  }
  function cancel(note = '') {
    version.current++;
    controller.current?.abort();
    setProposal(undefined);
    setWorking(false);
    if (current.current.tabId !== undefined)
      void pageRequest(current.current.tabId, { type: 'STOP' }).catch(() => {});
    if (note) setMessage(note);
  }
  async function loadCatalog() {
    const tabId = current.current.tabId;
    if (tabId === undefined || executing.current) return;
    try {
      const items = await pageRequest<ActionCandidate[]>(tabId, { type: 'LIST_ACTIONS' });
      if (!disposed.current && tabId === current.current.tabId) {
        setCatalog(items);
        setCatalogError('');
      }
    } catch {
      if (!disposed.current) setCatalogError('页面尚未就绪，加载完成后点刷新候选。');
    }
  }
  useEffect(() => {
    disposed.current = false;
    void loadCatalog();
    return () => {
      disposed.current = true;
      version.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!executing.current) {
      cancel(
        stepsRef.current.length ? '页面或连接设置已变化，请重新推荐当前步骤。计划仍保留。' : '',
      );
      void loadCatalog();
    }
  }, [props.document?.documentId, props.settings, props.sensitiveAllowed]);
  // URL/title/content changes are observed by the parent; raw events cancel stale work immediately.
  useEffect(() => {
    const listener = (m: any, sender: chrome.runtime.MessageSender) => {
      if (
        m.target === 'panel' &&
        m.event?.type === 'PAGE_CHANGED' &&
        (sender.tab?.id ?? m.tabId) === current.current.tabId &&
        !executing.current
      ) {
        cancel('页面已变化，请重新推荐当前步骤。');
        void loadCatalog();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  function permit(document: ExtractedDocument) {
    const p = current.current;
    if (
      p.settings.provider !== 'demo' &&
      (!p.settings.remoteConsent || (document.sensitive && !p.sensitiveAllowed))
    )
      throw new Error('Enable page sharing before using Jev. 敏感页面需要重新允许。');
  }
  async function prepare(plan = stepsRef.current, direct?: ActionCandidate) {
    if (executing.current) return;
    cancel();
    const at = nextStep(plan);
    const s = plan[at];
    const tabId = current.current.tabId;
    if (!s || tabId === undefined) return;
    const run = version.current;
    const abort = new AbortController();
    controller.current = abort;
    const fresh = () => {
      abort.signal.throwIfAborted();
      if (run !== version.current || disposed.current)
        throw new DOMException('Stale', 'AbortError');
    };
    setWorking(true);
    setMessage('');
    const started = performance.now();
    try {
      if (s.kind === 'manual') throw new Error(s.reason || '请手动完成这一步。');
      const doc = await pageRequest<ExtractedDocument>(tabId, {
        type: 'EXTRACT',
        granularity: current.current.settings.granularity,
      });
      fresh();
      if (
        s.guard &&
        !guardMatches(
          s.guard,
          doc.units.map((u) => u.text),
        )
      )
        throw new Error(
          `条件未满足：当前可读正文未包含“${s.guard}”。流程已暂停，可重试或明确跳过。`,
        );
      if (s.kind === 'wait') {
        setProposal({ stepId: s.id });
        return;
      }
      if (s.kind === 'find') {
        permit(doc);
        let scores: ScoredUnit[] = [];
        await analyze(doc, current.current.settings, s.goal, abort.signal, (items, metric) => {
          fresh();
          scores = items;
          current.current.onMetric(metric);
        });
        fresh();
        const matches = selectHighlights(scores, current.current.settings.density, true);
        if (!matches.length) throw new Error('当前步骤没有匹配原文，请修改关键词或跳过此步骤。');
        setProposal({ stepId: s.id, doc, scores: matches });
        return;
      }
      let all: ActionCandidate[];
      let exactNavigation = true;
      try {
        all = await pageRequest<ActionCandidate[]>(tabId, {
          type: 'ACTIONS',
          goal: direct ? undefined : s.goal,
        });
      } catch (error) {
        exactNavigation = false;
        fresh();
        // Exact navigation remains deterministic; a remote semantic fallback can choose a real outline item.
        if (current.current.settings.provider === 'demo' || /page\s+\d+/i.test(s.goal)) throw error;
        all = await pageRequest<ActionCandidate[]>(tabId, { type: 'ACTIONS' });
      }
      fresh();
      const candidates = all.filter((c) => !omitted.current.has(c.fingerprint));
      const literal =
        candidates.find((c) => c.accessibleName.toLowerCase() === s.source.toLowerCase()) ||
        candidates.find((c) => c.accessibleName.toLowerCase() === s.goal.toLowerCase());
      const exact = direct
        ? candidates.find((c) => c.fingerprint === direct.fingerprint)
        : exactNavigation
          ? candidates.find(
              (c) =>
                navigation(c) && (s.kind === 'scroll' || /^(?:go to|跳到|跳转到)/i.test(s.goal)),
            )
          : literal;
      const targetExact = exact || literal;
      if (direct && !exact) throw new Error('候选已变化，请刷新候选并重新选择。');
      const prefs = current.current.settings;
      let decision: CursorDecision;
      if (targetExact) decision = { id: targetExact.id, confidence: 1, probability: 1 };
      else {
        permit(doc);
        const provider =
          prefs.provider === 'demo' ? new MockDecisionProvider() : new JevDecisionProvider(prefs);
        decision = await provider.choose(
          candidates,
          s.goal,
          [`Workflow: ${plan.map((x) => x.source).join(' → ')}`, ...history.current],
          abort.signal,
        );
      }
      fresh();
      const candidate = candidates.find((c) => c.id === decision.id);
      if (!candidate)
        throw new Error('No matching action. 找内容请用“查找 + 关键词”；点击可从当前候选中选择。');
      await pageRequest(tabId, { type: 'PROPOSE', id: candidate.id });
      fresh();
      setProposal({
        stepId: s.id,
        candidate,
        decision,
        direct: !!targetExact,
        notice:
          !direct &&
          exactNavigation &&
          candidates.length > 1 &&
          candidates.every((c) => navigation(c))
            ? `找到 ${candidates.length} 个同名章节，可点击 Skip 切换。`
            : undefined,
      });
      current.current.onMetric({
        mode: 'cursor',
        units: candidates.length,
        latencyMs: Math.round(performance.now() - started),
        inputTokens: decision.inputTokens || 0,
        outputTokens: decision.outputTokens || 0,
        cacheHit: false,
      });
    } catch (error) {
      if (!abort.signal.aborted && run === version.current)
        setMessage(error instanceof Error ? error.message : '无法准备步骤。');
    } finally {
      if (run === version.current) setWorking(false);
    }
  }
  function build(goal: string) {
    if (executing.current) return;
    cancel();
    omitted.current.clear();
    history.current = [];
    try {
      const plan = parseWorkflow(goal);
      setSteps(plan);
      setDirty(false);
      setCatalogOpen(false);
      stepsRef.current = plan;
      setEditor(plan.map((s) => s.source).join('\n'));
      void prepare(plan);
    } catch (error) {
      setDirty(true);
      setMessage((error as Error).message);
    }
  }
  useImperativeHandle(ref, () => ({
    propose: build,
    stop: () => cancel('已停止。不会继续执行；可重新推荐当前步骤。'),
  }));
  function finish(id: string, status: 'done' | 'skipped', result = '') {
    const plan = stepsRef.current.map((s) => (s.id === id ? { ...s, status } : s));
    stepsRef.current = plan;
    setSteps(plan);
    setProposal(undefined);
    omitted.current.clear();
    setMessage(
      result +
        (nextStep(plan) < 0
          ? '流程已结束。请核对各步骤的完成或跳过状态。'
          : '当前步骤已结束。点击“推荐当前步骤”继续，下一步尚未执行。'),
    );
  }
  async function execute() {
    const p = proposal;
    const s = stepsRef.current.find((x) => x.id === p?.stepId);
    const tabId = current.current.tabId;
    if (!p || !s || tabId === undefined || executing.current || p.candidate?.riskHints.length)
      return;
    executing.current = true;
    setWorking(true);
    const run = version.current;
    const signal = controller.current!.signal;
    try {
      if (s.kind === 'wait') await delay(s.seconds!, signal);
      else if (s.kind === 'find') {
        const now = await pageRequest<ExtractedDocument>(tabId, {
          type: 'EXTRACT',
          granularity: current.current.settings.granularity,
        });
        signal.throwIfAborted();
        permit(now);
        if (now.documentId !== p.doc?.documentId)
          throw new Error('页面文本已变化，请重新推荐查找步骤。');
        await pageRequest(tabId, {
          type: 'PAINT',
          documentId: now.documentId,
          items: p.scores!,
          navigator: true,
        });
        signal.throwIfAborted();
        await pageRequest(tabId, { type: 'SELECT', id: p.scores![0].unitId });
      } else await pageRequest(tabId, { type: 'EXECUTE', id: p.candidate!.id, approved: true });
      if (run !== version.current || signal.aborted || disposed.current) return;
      history.current.push(`Executed ${p.candidate?.accessibleName || s.source}`);
      finish(
        s.id,
        'done',
        p.candidate
          ? `${navigation(p.candidate) ? 'Moved to' : 'Clicked'} ${p.candidate.accessibleName}. `
          : '',
      );
    } catch (error) {
      if (run === version.current && !signal.aborted) {
        setMessage((error as Error).message);
        setProposal(undefined);
      }
    } finally {
      executing.current = false;
      if (run === version.current && !disposed.current) setWorking(false);
    }
  }
  function append(goal: string) {
    cancel();
    setDirty(true);
    setEditor((old) => (old.trim() ? `${old.trim()}\n${goal}` : goal));
    setMessage('已添加到计划草稿。点击“生成计划”后再确认执行。');
  }
  const visible = catalog.filter(
    (c) =>
      (!filter || c.accessibleName.toLowerCase().includes(filter.toLowerCase())) &&
      (group === 'all' ||
        (group === 'section'
          ? navigation(c)
          : group === 'manual'
            ? c.riskHints.length > 0
            : !navigation(c) && !c.riskHints.length)),
  );
  return (
    <section className="cursor-card action-composer">
      <span className="eyebrow">PLAN · REVIEW · ACT</span>
      <h2>Act · 动作编排</h2>
      <p>输入复杂目标，用“然后 / then / 换行”分步；先看计划，再逐步确认。最多 12 步。</p>
      <div className="example-chips">
        {(props.isPdf
          ? ['go to Appendix', 'go to page 10', '先跳到第2页，然后查找 conclusion，最后回到顶部']
          : [
              '回到顶部',
              '滚动到底部',
              '先查找 installation，然后回到顶部',
              ...catalog
                .filter((c) => !navigation(c) && !c.riskHints.length)
                .slice(0, 8)
                .map((c) => c.accessibleName),
            ]
        ).map((text, i) => (
          <button
            key={i}
            onClick={() => {
              props.setDraft(text);
              setEditor(text);
            }}
          >
            {text}
          </button>
        ))}
      </div>
      <label className="workflow-editor-label">
        计划草稿（每行一步）
        <textarea
          aria-label="计划草稿"
          maxLength={2000}
          rows={3}
          value={editor}
          disabled={busy}
          onChange={(e) => {
            cancel();
            setEditor(e.target.value);
            setDirty(true);
          }}
          placeholder={'先跳到 Installation\n然后查找 requirements\n最后回到顶部'}
        />
      </label>
      <button className="primary" disabled={busy || !editor.trim()} onClick={() => build(editor)}>
        生成计划
      </button>
      <details
        className="section-navigation action-catalog"
        open={catalogOpen}
        onToggle={(e) => setCatalogOpen(e.currentTarget.open)}
      >
        <summary>候选动作 / 本页目录 · {catalog.length} 个页面目标</summary>
        <div className="catalog-filters">
          <input
            aria-label="搜索候选动作"
            placeholder="搜索标题、按钮、链接"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            aria-label="候选动作类型"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="all">全部</option>
            <option value="section">章节目录</option>
            <option value="control">可点击控件</option>
            <option value="manual">需手动</option>
          </select>
          <button
            disabled={busy}
            onClick={() => {
              cancel();
              void loadCatalog();
            }}
          >
            刷新候选
          </button>
        </div>
        <div className="catalog-list">
          {visible.map((c) => (
            <div className="catalog-item" key={c.id}>
              <button
                disabled={busy}
                title={c.riskHints.join(' ')}
                onClick={() => {
                  const goal = c.navigationGoal || c.accessibleName;
                  const plan = parseWorkflow(`"${goal.replaceAll('"', '')}"`);
                  cancel();
                  setSteps(plan);
                  stepsRef.current = plan;
                  setEditor(goal);
                  setDirty(false);
                  setCatalogOpen(false);
                  props.setDraft(goal);
                  omitted.current.clear();
                  void prepare(plan, c);
                }}
              >
                {c.accessibleName.replace(/^Go to /, '')}
                {c.riskHints.length ? ' · 需手动' : ''}
              </button>
              <button
                disabled={busy}
                aria-label={`添加步骤 ${c.accessibleName}`}
                onClick={() =>
                  append(
                    c.navigationGoal ||
                      (c.riskHints.length ? '手动 ' : '点击 ') +
                        `"${c.accessibleName.replaceAll('"', '')}"`,
                  )
                }
              >
                ＋
              </button>
            </div>
          ))}
        </div>
        <p>点击名称预览目标；＋ 加入草稿。章节导航和直接选候选无需 AI。</p>
      </details>
      {catalogError && <p>{catalogError}</p>}
      {dirty && steps.length > 0 && <p>草稿已修改，请重新生成计划。</p>}
      {steps.length > 0 && (
        <div className="workflow-plan">
          <h3>
            执行计划 · {steps.filter((s) => s.status === 'done').length}/{steps.length} 已完成
          </h3>
          <ol>
            {steps.map((s, i) => (
              <li key={s.id} aria-current={i === index ? 'step' : undefined}>
                <span>{s.source}</span>
                <small>
                  {kinds[s.kind]} ·{' '}
                  {s.status === 'done'
                    ? '已完成'
                    : s.status === 'skipped'
                      ? '已跳过'
                      : i === index
                        ? '当前步骤'
                        : '待执行'}
                </small>
                {s.status === 'pending' && (
                  <div className="step-tools">
                    <button
                      disabled={busy || i <= index}
                      aria-label={`上移步骤 ${i + 1}`}
                      onClick={() => {
                        cancel();
                        const plan = [...steps];
                        [plan[i - 1], plan[i]] = [plan[i], plan[i - 1]];
                        setSteps(plan);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      disabled={busy}
                      aria-label={`移除步骤 ${i + 1}`}
                      onClick={() => {
                        cancel();
                        setSteps(steps.filter((x) => x.id !== s.id));
                      }}
                    >
                      移除
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p>修改草稿并重新生成会重置执行记录，不会撤销已经发生的动作。</p>
        </div>
      )}
      {busy && <p role="status">正在准备或执行当前步骤…</p>}
      {message && (
        <p className="workflow-message" role="status">
          {message}
        </p>
      )}
      {proposal && (
        <div className="proposal">
          <span className="eyebrow">PROPOSED ACTION</span>
          {proposal.notice && <p>{proposal.notice}</p>}
          <h3>
            {proposal.candidate?.accessibleName ||
              (step?.kind === 'find'
                ? `定位 ${proposal.scores?.length} 条原文`
                : `等待 ${step?.seconds} 秒`)}
          </h3>
          <p>
            {proposal.direct
              ? 'Section navigation / direct selection · no AI request'
              : props.settings.provider === 'demo'
                ? 'Demo suggestion'
                : 'Jev suggestion · 请核对目标'}
          </p>
          {proposal.candidate?.riskHints.map((r) => (
            <p className="risk" key={r}>
              {r}
            </p>
          ))}
          <div className="button-row">
            <button
              className="primary"
              disabled={busy || !!proposal.candidate?.riskHints.length}
              onClick={() => void execute()}
            >
              {proposal.candidate
                ? navigation(proposal.candidate)
                  ? 'Approve & go'
                  : 'Approve & click'
                : '确认执行当前步骤'}
            </button>
            {proposal.candidate && (
              <button
                disabled={busy}
                onClick={() => {
                  omitted.current.add(proposal.candidate!.fingerprint);
                  void prepare();
                }}
              >
                Skip
              </button>
            )}
          </div>
        </div>
      )}
      {step && (
        <div className="button-row">
          <button disabled={busy || dirty} onClick={() => void prepare()}>
            推荐当前步骤
          </button>
          <button
            disabled={busy}
            onClick={() => {
              cancel();
              finish(step.id, 'skipped');
            }}
          >
            跳过当前步骤
          </button>
          {(step.kind === 'manual' || !!proposal?.candidate?.riskHints.length) && (
            <button
              disabled={busy}
              onClick={() => {
                cancel();
                history.current.push(`User reports manual completion: ${step.source}`);
                finish(step.id, 'done');
              }}
            >
              我已手动完成
            </button>
          )}
        </div>
      )}
      <button
        className="text-button"
        onClick={() => cancel('已停止。不会继续执行；可重新推荐当前步骤。')}
      >
        Stop Cursor · 停止编排
      </button>
    </section>
  );
});
