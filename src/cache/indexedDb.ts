import { openDB } from 'idb';
import type { ScoredUnit } from '../shared/types';
const db = () =>
  openDB('jev-lens', 1, {
    upgrade(db) {
      db.createObjectStore('scores');
    },
  });
export async function getScore(key: string): Promise<Omit<ScoredUnit, 'unitId'> | undefined> {
  try {
    const d = await db();
    const entry = await d.get('scores', key);
    if (entry && Date.now() - entry.at < 7 * 86400000) return entry.value;
  } catch {
    /* Cache is optional. */
  }
}
export async function putScore(key: string, value: Omit<ScoredUnit, 'unitId'>) {
  try {
    const d = await db();
    await d.put('scores', { at: Date.now(), value }, key);
    if ((await d.count('scores')) > 10000) await d.clear('scores');
  } catch {
    /* Storage pressure must not break inference. */
  }
}
export async function clearCache() {
  const d = await db();
  await d.clear('scores');
}
