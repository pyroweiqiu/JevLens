import { defineConfig } from 'wxt';
export default defineConfig({
  outDir: 'output',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'JevLens',
    description: 'See what matters. Find what you need. Act with intention.',
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    permissions: ['sidePanel', 'storage', 'activeTab', 'tabs', 'contextMenus'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'Open Jev Lens' },
    commands: {
      'toggle-lens': {
        suggested_key: { default: 'Alt+Shift+L', mac: 'Command+Shift+L' },
        description: 'Toggle Jev Lens',
      },
      'focus-intent': {
        suggested_key: { default: 'Alt+Shift+F', mac: 'Command+Shift+F' },
        description: 'Focus intent',
      },
      'activate-cursor': {
        suggested_key: { default: 'Alt+Shift+J', mac: 'Command+Shift+J' },
        description: 'Activate Cursor',
      },
      'stop-cursor': { description: 'Stop Cursor (Escape also works)' },
    },
    mime_types_handler: { 'application/pdf': { handler_url: 'pdf-viewer.html', can_embed: true } },
  } as any,
});
