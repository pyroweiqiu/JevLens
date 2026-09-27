import { z } from 'zod';
import { DEFAULT_SETTINGS, type ApiProvider, type Settings } from './types';

export const PROVIDER_LABELS: Record<ApiProvider, string> = {
  demo: 'Demo · Local',
  jev: 'Jev Official',
  openrouter: 'OpenRouter',
  custom: 'Custom API',
};
const connectionSchema = z.object({
  endpoint: z.string().max(2048),
  token: z.string().max(4096),
  model: z.string().max(200),
});
const settingsSchema = z.object({
  connectionVersion: z.literal(2),
  provider: z.enum(['demo', 'jev', 'openrouter', 'custom']),
  connections: z.object({
    jev: connectionSchema,
    openrouter: connectionSchema,
    custom: connectionSchema,
  }),
  granularity: z.enum(['sentence', 'paragraph']),
  density: z.number().min(0.05).max(1),
  remoteConsent: z.boolean(),
});
const legacySchema = z.object({
  provider: z.enum(['demo', 'jev']),
  endpoint: z.string(),
  token: z.string(),
  granularity: z.enum(['sentence', 'paragraph']),
  density: z.number().min(0.05).max(1),
  remoteConsent: z.boolean(),
});
export function loadSettings(raw: unknown): Settings {
  const current = settingsSchema.safeParse(raw);
  if (current.success) return current.data;
  const legacy = legacySchema.safeParse(raw);
  const next = structuredClone(DEFAULT_SETTINGS);
  if (legacy.success) {
    const old = legacy.data;
    next.provider = old.provider === 'jev' ? 'custom' : 'demo';
    next.granularity = old.granularity;
    next.density = old.density;
    next.remoteConsent = old.remoteConsent;
    next.connections.custom = {
      endpoint: old.endpoint.replace(/\/+$/, '') + '/v1/evaluate',
      token: old.token,
      model: 'jev-latest',
    };
  }
  return next;
}
export function activeConnection(settings: Settings) {
  return settings.provider === 'demo' ? undefined : settings.connections[settings.provider];
}
export function validateConnection(settings: Settings): string | undefined {
  const connection = activeConnection(settings);
  if (!connection) return;
  let url: URL;
  try {
    url = new URL(connection.endpoint.trim());
  } catch {
    return 'Enter a complete API endpoint URL.';
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    return 'Use HTTPS, or HTTP for a localhost proxy.';
  if (url.username || url.password || url.hash || url.search)
    return 'Use an endpoint without credentials, query parameters or a fragment. Put the key in API Key.';
  // Presets never forward their key to a user-edited host. Custom has its own independent key.
  if (
    settings.provider !== 'custom' &&
    settings.provider !== 'demo' &&
    connection.endpoint.trim() !== DEFAULT_SETTINGS.connections[settings.provider].endpoint
  )
    return 'Use Custom API to change the endpoint.';
  if (!connection.model.trim()) return 'Enter a model ID.';
  if (settings.provider !== 'custom' && !connection.token.trim())
    return 'Enter an API key for this provider.';
}
export function normalizeSettings(settings: Settings): Settings {
  const next = settingsSchema.parse(settings);
  for (const c of Object.values(next.connections)) {
    c.endpoint = c.endpoint.trim();
    c.token = c.token.trim();
    c.model = c.model.trim();
  }
  const error = validateConnection(next);
  if (error) throw new Error(error);
  return next;
}
/** Does not include credentials: used to separate scores from different endpoints/models. */
export function inferenceCacheIdentity(settings: Settings): string {
  const connection = activeConnection(settings);
  return JSON.stringify([settings.provider, connection?.endpoint, connection?.model]);
}
