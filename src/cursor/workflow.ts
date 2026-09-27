export type StepKind = 'action' | 'find' | 'scroll' | 'wait' | 'manual';
export interface WorkflowStep {
  id: string;
  source: string;
  goal: string;
  kind: StepKind;
  guard?: string;
  seconds?: number;
  reason?: string;
  status: 'pending' | 'done' | 'skipped';
}
export const MAX_STEPS = 12;
const unquote = (s: string) =>
  s
    .trim()
    .replace(/^["“「']([\s\S]*)["”」']$/, '$1')
    .trim();
export function parseWorkflow(input: string): WorkflowStep[] {
  if (!input.trim()) throw new Error('请先输入任务或从候选动作添加步骤。');
  if (input.length > 2000) throw new Error('任务最多 2000 个字符，请拆成较短的流程。');
  const quoted: string[] = [];
  const masked = input.replace(/"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|'[^'\n]*'/g, (s) => {
    quoted.push(s);
    return `\uE000${quoted.length - 1}\uE001`;
  });
  const restore = (s: string) => s.replace(/\uE000(\d+)\uE001/g, (_, i) => quoted[Number(i)]);
  const clauses = masked
    .split(
      /\n+|[;；]+|(?:[,，]\s*)?(?:然后|接着|随后|最后|再(?=跳|查|找|点|打|滚|等)|并且(?=跳|查|找|点|打|滚|等)|并(?=跳|查|找|点|打|滚|等))\s*|(?:,\s*)?\b(?:and\s+then|then|finally|next)\b\s*(?=(?:click|open|find|search|scroll|go|wait|jump|navigate|locate|manual)\b|点击|查找|跳|打开|回到|滚动|等待|手动)|\band\s+(?=(?:click|open|find|search|scroll|go|wait|jump)\b)/i,
    )
    .map((s) =>
      restore(s)
        .replace(/^\s*(?:\d+[.)、]\s*|[-*]\s+|首先\s*|先\s*|first\s*[,，:]?\s*)/i, '')
        .replace(/^[,，\s]+|[,，。\s]+$/g, ''),
    )
    .filter(Boolean);
  if (clauses.length > MAX_STEPS) throw new Error(`一次最多编排 ${MAX_STEPS} 步，请拆分任务。`);
  return clauses.map((source, i) => {
    const syntax = source.replace(/"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|'[^'\n]*'/g, '');
    let goal = source;
    let guard: string | undefined;
    const condition =
      goal.match(/^(?:如果|若)(?:页面)?(?:包含|存在|有)\s*(.+?)[,，]?\s*(?:则|就)\s*(.+)$/) ||
      goal.match(/^if\s+(?:the\s+page\s+)?(?:contains|has)\s+(.+?),\s*(.+)$/i);
    if (condition) {
      guard = unquote(condition[1]);
      goal = condition[2].trim();
    }
    const step: WorkflowStep = {
      id: `step-${i}`,
      source,
      goal,
      guard,
      kind: 'action',
      status: 'pending',
    };
    if (
      /否则|循环|直到|重复|\b(?:else|repeat|until|while)\b/i.test(syntax) ||
      (!condition && /^(?:如果|若|if\b)/i.test(source))
    )
      return {
        ...step,
        kind: 'manual',
        reason: '此条件或循环尚不支持自动解释。请改成明确步骤，或在页面手动完成。',
      };
    if (/^(?:手动|manual\b)/i.test(goal))
      return { ...step, kind: 'manual', reason: '请在页面手动处理，返回后确认已完成。' };
    const find = goal.match(
      /^(?:查找|搜索|找到|找出|找|find\b|search(?:\s+for)?\b|locate\b)\s*(.+)$/i,
    );
    if (find) return { ...step, kind: 'find', goal: unquote(find[1]) };
    const wait = goal.match(/^(?:等待|等|wait(?:\s+for)?)\s*(\d+(?:\.\d+)?)\s*(?:秒|seconds?|s)$/i);
    if (wait) {
      const seconds = Number(wait[1]);
      return seconds > 0 && seconds <= 10
        ? { ...step, kind: 'wait', seconds }
        : { ...step, kind: 'manual', reason: '等待时间需在 0 到 10 秒之间。' };
    }
    if (
      /^(?:滚动到|回到|返回|跳到)(?:页面)?(?:顶部|顶端)$|^(?:scroll|go)\s+to\s+(?:the\s+)?top$/i.test(
        goal,
      )
    )
      return { ...step, kind: 'scroll', goal: 'scroll to top' };
    if (
      /^(?:滚动到|跳到)(?:页面)?(?:底部|底端)$|^(?:scroll|go)\s+to\s+(?:the\s+)?bottom$/i.test(goal)
    )
      return { ...step, kind: 'scroll', goal: 'scroll to bottom' };
    if (/^(?:向下滚动|向下翻|下一屏|scroll down)$/i.test(goal))
      return { ...step, kind: 'scroll', goal: 'scroll down' };
    if (/^(?:向上滚动|向上翻|上一屏|scroll up)$/i.test(goal))
      return { ...step, kind: 'scroll', goal: 'scroll up' };
    const nav = goal.match(
      /^(?:请)?(?:跳转到|跳到|转到|滚动到|带我去|带我到|go to|jump to|navigate to)\s*(.+)$/i,
    );
    if (nav) {
      const target = unquote(nav[1]);
      const page = target.match(/^(?:第\s*)?(\d+)\s*页$|^page\s+(\d+)$/i);
      step.goal = page ? `go to page ${page[1] || page[2]}` : `go to ${target}`;
    } else {
      const click = goal.match(/^(?:点击|单击|点开|打开|click(?:\s+on)?|open)\s*(.+)$/i);
      if (click) step.goal = unquote(click[1]);
      else step.goal = unquote(goal);
    }
    if (step.goal.length > 500) throw new Error('每一步最多 500 个字符。');
    return step;
  });
}
export function nextStep(steps: WorkflowStep[]) {
  return steps.findIndex((s) => s.status === 'pending');
}
export function guardMatches(guard: string, evidence: string[]) {
  return evidence.some((text) => text.toLocaleLowerCase().includes(guard.toLocaleLowerCase()));
}
export function delay(seconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, seconds * 1000);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Stopped', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}
