import { describe, expect, it } from 'vitest';
import { delay, guardMatches, nextStep, parseWorkflow } from '../../src/cursor/workflow';
describe('reviewable action workflows', () => {
  it('splits Chinese multi-step instructions into navigation, find and scroll', () => {
    const steps = parseWorkflow('先跳到 Installation，然后查找 requirements，最后回到顶部');
    expect(steps.map((s) => [s.kind, s.goal])).toEqual([
      ['action', 'go to Installation'],
      ['find', 'requirements'],
      ['scroll', 'scroll to top'],
    ]);
    expect(nextStep(steps)).toBe(0);
    steps[0].status = 'done';
    steps[1].status = 'skipped';
    expect(nextStep(steps)).toBe(2);
  });
  it('keeps conjunctions inside quoted labels and supports numbered English steps', () => {
    expect(
      parseWorkflow(
        '1. click "Research and then Development"\n2. find "Results; and limitations"\n3. wait 2 seconds',
      ).map((s) => s.goal),
    ).toEqual(['Research and then Development', 'Results; and limitations', 'wait 2 seconds']);
  });
  it('parses explicit positive guards without treating absence as success', () => {
    const step = parseWorkflow('如果页面包含 "Training" 就查找 GPUs')[0];
    expect(step.guard).toBe('Training');
    expect(step.kind).toBe('find');
    expect(guardMatches(step.guard!, ['Model training uses GPUs'])).toBe(true);
    expect(guardMatches(step.guard!, ['Unrelated text'])).toBe(false);
  });
  it('does not silently turn unsupported loops or conditions into executable clicks', () => {
    expect(parseWorkflow('重复点击 Next 直到结束')[0].kind).toBe('manual');
    expect(parseWorkflow('如果价格合适就购买')[0].kind).toBe('manual');
    expect(parseWorkflow('等待 90 秒')[0].kind).toBe('manual');
  });
  it('bounds instructions and leaves navigation labels intact', () => {
    expect(() => parseWorkflow('x'.repeat(2001))).toThrow();
    expect(() => parseWorkflow(Array(13).fill('回到顶部').join(';'))).toThrow();
    expect(parseWorkflow('跳到第10页')[0].goal).toBe('go to page 10');
    expect(parseWorkflow('go to FAQ · match 2')[0].goal).toBe('go to FAQ · match 2');
  });
  it('does not split Next inside a control name or interpret quoted loop words', () => {
    expect(parseWorkflow('等待 5 秒; 点击 Next section')).toHaveLength(2);
    expect(parseWorkflow('click "repeat"')[0].kind).toBe('action');
    expect(parseWorkflow('first click Open then scroll down')).toHaveLength(2);
  });
  it('stops a pending wait immediately', async () => {
    const abort = new AbortController();
    const pending = delay(10, abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
