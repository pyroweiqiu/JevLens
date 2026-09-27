export type Granularity = 'sentence' | 'paragraph';
export type Mode = 'highlight' | 'navigator' | 'cursor';
export type PageLocator = {
  kind: 'html-text' | 'pdf-text';
  blockHash: string;
  headingPath: string[];
  textPrefix: string;
  startOffset: number;
  endOffset: number;
  page?: number;
};
export interface TextUnit {
  unitId: string;
  blockId: string;
  text: string;
  headingPath: string[];
  locator: PageLocator;
  inViewport: boolean;
}
export interface ExtractedDocument {
  documentId: string;
  url: string;
  title: string;
  units: TextUnit[];
  granularity: Granularity;
  limited?: string;
  sensitive: boolean;
}
export interface ScoredUnit {
  unitId: string;
  score: number;
  confidence: number;
}
export interface ActionCandidate {
  id: string;
  role: string;
  accessibleName: string;
  href?: string;
  riskHints: string[];
  fingerprint: string;
  navigationGoal?: string;
}
export interface CursorDecision {
  inputTokens?: number;
  outputTokens?: number;
  id: string;
  confidence: number;
  probability: number;
}
export interface Metric {
  mode: Mode;
  units: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheHit: boolean;
}
export type RemoteProvider = 'jev' | 'openrouter' | 'custom';
export type ApiProvider = 'demo' | RemoteProvider;
export interface ApiConnection {
  endpoint: string;
  token: string;
  model: string;
}
export interface Settings {
  connectionVersion: 2;
  provider: ApiProvider;
  connections: Record<RemoteProvider, ApiConnection>;
  granularity: Granularity;
  density: number;
  remoteConsent: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  connectionVersion: 2,
  provider: 'demo',
  connections: {
    jev: { endpoint: 'https://api.typesafe.ai/v1/systemone', token: '', model: 'jev-latest' },
    openrouter: {
      endpoint: 'https://openrouter.ai/api/alpha/decisions',
      token: '',
      model: 'typesafe/jev-1.13',
    },
    custom: { endpoint: 'http://localhost:8787/v1/evaluate', token: '', model: 'jev-latest' },
  },
  granularity: 'sentence',
  density: 0.2,
  remoteConsent: false,
};
export const PROMPT_VERSION = 'lens-v1';
