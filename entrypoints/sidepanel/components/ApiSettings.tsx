import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, LoaderCircle, Plug, X } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  type ApiConnection,
  type ApiProvider,
  type Settings,
} from '../../../src/shared/types';
import {
  activeConnection,
  normalizeSettings,
  validateConnection,
} from '../../../src/shared/settings';
import { testConnection } from '../../../src/jev/client';

interface Props {
  settings: Settings;
  onSave(settings: Settings): Promise<void>;
  onClose(): void;
}
export default function ApiSettings({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(() => structuredClone(settings));
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const connection = activeConnection(draft);
  useEffect(() => {
    dialog.current?.showModal();
    return () => controller.current?.abort();
  }, []);
  function update(next: Settings) {
    controller.current?.abort();
    setStatus('idle');
    setMessage('');
    setDraft(next);
  }
  function updateConnection(patch: Partial<ApiConnection>) {
    if (draft.provider === 'demo') return;
    update({
      ...draft,
      connections: { ...draft.connections, [draft.provider]: { ...connection!, ...patch } },
    });
  }
  function choose(provider: ApiProvider) {
    setReveal(false);
    update({ ...draft, provider });
  }
  async function test() {
    controller.current?.abort();
    const error = validateConnection(draft);
    if (error) {
      setStatus('error');
      setMessage(error);
      return;
    }
    const active = new AbortController();
    controller.current = active;
    setStatus('testing');
    setMessage('Testing Score and Choice…');
    try {
      await testConnection(draft, active.signal);
      if (!active.signal.aborted) {
        setStatus('success');
        setMessage('Connected. Score and Choice responses verified.');
      }
    } catch (e) {
      if (!active.signal.aborted) {
        setStatus('error');
        setMessage((e as Error).message);
      }
    }
  }
  async function submit() {
    try {
      const next = normalizeSettings(draft);
      setSaving(true);
      controller.current?.abort();
      await onSave(next);
      onClose();
    } catch (e) {
      setStatus('error');
      setMessage((e as Error).message);
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="api-dialog"
      aria-labelledby="api-settings-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="api-dialog-heading">
          <div>
            <span className="eyebrow">YOUR CONNECTION</span>
            <h2 id="api-settings-title">API settings</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close API settings"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p className="api-intro">Choose where Lens sends its decisions.</p>
        <fieldset className="api-provider-options">
          <legend>Provider</legend>
          {(
            [
              ['jev', 'Jev Official', 'TypeSafe'],
              ['openrouter', 'OpenRouter', 'Jev Decisions'],
              ['custom', 'Custom', 'Your endpoint'],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className={draft.provider === value ? 'chosen' : ''}>
              <input
                type="radio"
                name="api-provider"
                value={value}
                checked={draft.provider === value}
                onChange={() => choose(value)}
              />
              <strong>{label}</strong>
              <small>{hint}</small>
            </label>
          ))}
        </fieldset>
        <label className="api-demo-choice">
          <input
            type="radio"
            name="api-provider"
            checked={draft.provider === 'demo'}
            onChange={() => choose('demo')}
          />
          Demo · local ranking, no API requests
        </label>
        {connection && (
          <>
            <label className="api-field">
              Endpoint URL
              <input
                aria-label="Endpoint URL"
                type="url"
                required
                readOnly={draft.provider !== 'custom'}
                value={connection.endpoint}
                placeholder="https://your-api.example/v1/systemone"
                onChange={(e) => updateConnection({ endpoint: e.target.value })}
                spellCheck={false}
              />
            </label>
            {draft.provider === 'custom' && (
              <p className="api-hint">
                Use a full Jev / Decisions endpoint, including its path. Supports the Lens proxy at{' '}
                <code>/v1/evaluate</code>.
              </p>
            )}
            <label className="api-field">
              Model ID
              <input
                aria-label="Model ID"
                required
                value={connection.model}
                placeholder={
                  DEFAULT_SETTINGS.connections[draft.provider as 'jev' | 'openrouter' | 'custom']
                    .model
                }
                onChange={(e) => updateConnection({ model: e.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="api-field">
              API Key{' '}
              {draft.provider === 'custom' && (
                <span className="optional">· optional for a local proxy</span>
              )}
              <span className="api-key-field">
                <input
                  aria-label="API Key"
                  type={reveal ? 'text' : 'password'}
                  value={connection.token}
                  required={draft.provider !== 'custom'}
                  placeholder={draft.provider === 'openrouter' ? 'sk-or-…' : 'Enter your API key'}
                  onChange={(e) => updateConnection({ token: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={reveal ? 'Hide API key' : 'Show API key'}
                  onClick={() => setReveal(!reveal)}
                >
                  {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
            </label>
            <p className="api-hint">
              Each provider has its own key. Saved locally in this browser profile; not synced.
            </p>
            <label className="api-consent">
              <input
                type="checkbox"
                checked={draft.remoteConsent}
                onChange={(e) => update({ ...draft, remoteConsent: e.target.checked })}
              />
              <span>Allow visible page text and intent to be sent to the selected API.</span>
            </label>
            <div className="api-test">
              <button
                type="button"
                className="small-button"
                disabled={status === 'testing' || saving}
                onClick={() => void test()}
              >
                {status === 'testing' ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Plug size={14} />
                )}
                Test connection
              </button>
              <small>Two small sample requests. No page content.</small>
            </div>
          </>
        )}
        {message && (
          <p className={`api-result ${status}`} role={status === 'error' ? 'alert' : 'status'}>
            {message}
          </p>
        )}
        <div className="api-dialog-actions">
          <button type="button" className="small-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
