import { createPageRuntime } from '../src/messaging/pageRuntime';
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  main(ctx) {
    const runtime = createPageRuntime((event) => {
      chrome.runtime.sendMessage({ target: 'panel', event }).catch(() => {});
    });
    const listener = (
      message: any,
      sender: chrome.runtime.MessageSender,
      reply: (value: unknown) => void,
    ) => {
      if (sender.id === chrome.runtime.id && message?.target === 'page')
        reply(runtime.handle(message.command));
    };
    chrome.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => {
      chrome.runtime.onMessage.removeListener(listener);
      runtime.destroy();
    });
  },
});
