// A web search provider that needs nothing but the nRouter key the agent already has.
import type { nRouter } from '@nrouter_ai/sdk';
import type { WebSearchProvider, WebSource } from './types.js';
import { createClient, groundedSearch } from './client.js';
import { SupportAgentError } from './errors.js';

export const DEFAULT_WEB_SEARCH_MODEL = 'nrouter/auto';
export const DEFAULT_WEB_SEARCH_LABEL = 'the web';
const SEARCH_MAX_TOKENS = 512;

export interface NRouterWebSearchOptions {
  /** nRouter virtual key. Not needed when `client` is given. */
  apiKey?: string;
  baseURL?: string;
  /** Extra headers sent on every search call. Ignored when you pass your own `client`. */
  defaultHeaders?: Record<string, string>;
  /** An SDK client to reuse instead of creating one from `apiKey`. */
  client?: nRouter;
  /** A model the gateway serves with web search. Default `nrouter/auto`. */
  model?: string;
  /** Shown in the "Searched …" step. Default `the web`. */
  label?: string;
  /** See `WebSearchProvider.timeoutMs`. */
  timeoutMs?: number;
  /** Mask emails and phone numbers in the query before it leaves the process (default true). */
  maskPii?: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Web search through the gateway's own search grounding: one SDK call, billed
 * to the same key, no second vendor. Returns the pages the answer cites.
 */
export function createNRouterWebSearch(options: NRouterWebSearchOptions): WebSearchProvider {
  if (!options.client && !options.apiKey) {
    throw new SupportAgentError('invalid_config', 'createNRouterWebSearch needs a client or an apiKey');
  }
  const client = options.client ?? createClient(options.apiKey as string, options.baseURL, options.defaultHeaders);
  const model = options.model ?? DEFAULT_WEB_SEARCH_MODEL;

  return {
    label: options.label ?? DEFAULT_WEB_SEARCH_LABEL,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    async search(query, opts) {
      const answer = await groundedSearch(client, {
        model,
        query,
        maxTokens: SEARCH_MAX_TOKENS,
        signal: opts.signal,
        maskPii: options.maskPii,
      });

      const sources: WebSource[] = [];
      const seen = new Set<string>();
      for (const c of answer.citations) {
        if (sources.length >= opts.maxResults) break;
        if (!/^https?:\/\//i.test(c.url) || seen.has(c.url)) continue;
        seen.add(c.url);
        // The first source carries the grounded answer; later ones the span they back.
        const span = c.start !== undefined && c.end !== undefined ? answer.text.slice(c.start, c.end).trim() : '';
        sources.push({
          title: c.title || hostOf(c.url),
          url: c.url,
          snippet: sources.length === 0 ? answer.text : span || answer.text,
        });
      }
      return sources;
    },
  };
}
