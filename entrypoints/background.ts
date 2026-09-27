import { pageCommandSchema, eventSchema, type Reply } from '../src/messaging/protocol';
export default defineBackground(() => {
  // User-supplied API keys are available only to trusted extension pages, never content scripts.
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const pdfPorts = new Map<number, chrome.runtime.Port>();
  const pending = new Map<string, (value: Reply<unknown>) => void>();
  const panels = new Map<number, chrome.runtime.Port>();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() =>
      chrome.contextMenus.create({
        id: 'open-pdf',
        title: 'Open in Jev PDF Viewer',
        contexts: ['page', 'link'],
      }),
    );
  });
  chrome.contextMenus.onClicked.addListener((info) => {
    const source = info.linkUrl || info.pageUrl;
    if (source && /^https?:/i.test(source))
      chrome.tabs.create({
        url: chrome.runtime.getURL('pdf-viewer.html') + '?url=' + encodeURIComponent(source),
      });
  });
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'jev-pdf' && port.sender?.tab?.id !== undefined) {
      const tabId = port.sender.tab.id;
      pdfPorts.set(tabId, port);
      port.onMessage.addListener((message) => {
        if (message.id && pending.has(message.id)) {
          pending.get(message.id)!(message.reply);
          pending.delete(message.id);
        }
        if (eventSchema.safeParse(message.event).success)
          chrome.runtime
            .sendMessage({ target: 'panel', tabId, event: message.event })
            .catch(() => {});
      });
      port.onDisconnect.addListener(() => {
        if (pdfPorts.get(tabId) === port) pdfPorts.delete(tabId);
      });
    }
    if (port.name === 'jev-panel') {
      let windowId: number | undefined;
      port.onMessage.addListener((message) => {
        if (Number.isInteger(message.windowId)) {
          windowId = message.windowId;
          panels.set(windowId!, port);
        }
      });
      port.onDisconnect.addListener(() => {
        if (windowId !== undefined && panels.get(windowId) === port) panels.delete(windowId);
      });
    }
  });
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'stop-cursor') {
      if (tab?.id)
        chrome.tabs
          .sendMessage(tab.id, { target: 'page', command: { type: 'STOP' } })
          .catch(() => {});
      chrome.runtime.sendMessage({ target: 'panel', command }).catch(() => {});
      return;
    }
    const windowId = tab?.windowId;
    if (windowId === undefined) return;
    if (command === 'toggle-lens' && panels.has(windowId)) {
      if (chrome.sidePanel.close) void chrome.sidePanel.close({ windowId });
      else panels.get(windowId)?.postMessage({ command: 'close' });
      return;
    }
    // Invoke open synchronously while Chrome's command user gesture is active.
    chrome.sidePanel
      .open({ windowId })
      .then(() => {
        setTimeout(
          () => chrome.runtime.sendMessage({ target: 'panel', command }).catch(() => {}),
          200,
        );
      })
      .catch(() => {});
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.target !== 'background') return;
    if (message.type === 'PAGE' && Number.isInteger(message.tabId)) {
      const parsed = pageCommandSchema.safeParse(message.command);
      if (!parsed.success) {
        reply({ ok: false, error: 'Invalid page command.' });
        return;
      }
      const port = pdfPorts.get(message.tabId);
      if (port) {
        const id = crypto.randomUUID();
        const timeout = setTimeout(() => {
          pending.delete(id);
          reply({ ok: false, error: 'PDF viewer did not respond.' });
        }, 10000);
        pending.set(id, (value) => {
          clearTimeout(timeout);
          reply(value);
        });
        port.postMessage({ id, command: parsed.data });
      } else
        chrome.tabs
          .sendMessage(message.tabId, { target: 'page', command: parsed.data })
          .then(reply)
          .catch(() =>
            reply({
              ok: false,
              error:
                'This page cannot be read. Reload it after installing Lens. For PDFs, use Open PDF in Lens.',
            }),
          );
      return true;
    }
  });
});
