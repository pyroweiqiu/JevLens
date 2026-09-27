import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import {
  loadSettings,
  normalizeSettings,
  validateConnection,
  inferenceCacheIdentity,
} from '../../src/shared/settings';

it('migrates the old Jev proxy to Custom without changing its destination or key', () => {
  const settings = loadSettings({
    provider: 'jev',
    endpoint: 'http://localhost:8787/',
    token: 'old-proxy-token',
    granularity: 'paragraph',
    density: 0.35,
    remoteConsent: true,
  });
  expect(settings.provider).toBe('custom');
  expect(settings.connections.custom).toEqual({
    endpoint: 'http://localhost:8787/v1/evaluate',
    token: 'old-proxy-token',
    model: 'jev-latest',
  });
  expect(settings.connections.jev.token).toBe('');
  expect(settings.connections.openrouter.token).toBe('');
  expect(settings.remoteConsent).toBe(true);
  expect(settings.granularity).toBe('paragraph');
  expect(loadSettings(settings)).toEqual(settings);
});
it('rejects invalid destinations, missing models and keys, but permits a local proxy with no token', () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.provider = 'custom';
  expect(validateConnection(settings)).toBeUndefined();
  for (const endpoint of [
    'javascript:alert(1)',
    'http://remote.example/v1/decisions',
    'https://example.com/api?key=secret',
    'https://user:secret@example.com/api',
  ]) {
    settings.connections.custom.endpoint = endpoint;
    expect(validateConnection(settings)).toBeTruthy();
  }
  settings.provider = 'jev';
  expect(validateConnection(settings)).toContain('API key');
  settings.connections.jev.token = 'key';
  settings.connections.jev.endpoint = 'https://wrong.example/api';
  expect(validateConnection(settings)).toContain('Custom');
  settings.provider = 'custom';
  settings.connections.custom.endpoint = 'https://custom.example/api';
  settings.connections.custom.model = '';
  expect(validateConnection(settings)).toContain('model');
});
it('normalizes credentials and separates cache entries by endpoint and model without including keys', () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.provider = 'openrouter';
  settings.connections.openrouter.token = '  example-key  ';
  const normalized = normalizeSettings(settings);
  expect(normalized.connections.openrouter.token).toBe('example-key');
  expect(inferenceCacheIdentity(normalized)).not.toContain('example-key');
  const before = inferenceCacheIdentity(normalized);
  normalized.connections.openrouter.model = 'typesafe/jev-latest';
  expect(inferenceCacheIdentity(normalized)).not.toBe(before);
  normalized.provider = 'custom';
  const custom = inferenceCacheIdentity(normalized);
  normalized.connections.custom.endpoint = 'https://other.example/decisions';
  expect(inferenceCacheIdentity(normalized)).not.toBe(custom);
});
it('recovers safely from invalid stored settings', () => {
  expect(loadSettings({ provider: 'unknown' })).toEqual(DEFAULT_SETTINGS);
});
