import type { PageCommand, Reply } from './protocol';
export async function pageRequest<T>(tabId: number, command: PageCommand): Promise<T> {
  const result: Reply<T> = await chrome.runtime.sendMessage({
    target: 'background',
    type: 'PAGE',
    tabId,
    command,
  });
  if (!result?.ok)
    throw new Error(
      result?.error ||
        'This page is not accessible. Reload the page after installing Lens, or open a regular webpage.',
    );
  return result.value;
}
