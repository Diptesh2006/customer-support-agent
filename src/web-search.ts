import type { AgentTool } from '@nrouter_ai/sdk';
import type { CostEvent, WebSearchProvider, WebSource } from './types.js';

export const WEB_SEARCH_TOOL_ID = 'web_search';

/** What a bounded search produced, and what is known about its cost. */
export interface BoundedSearch {
  sources: WebSource[];
  /** The provider's reported cost; `'unknown'` when a cost-reporting provider was called and reported none. */
  cost?: CostEvent | 'unknown';
}

/** Whether the provider's own gate lets this query be searched. No gate means yes; a gate that throws means no. */
export function searchAllowed(provider: WebSearchProvider, query: string): boolean {
  if (!provider.shouldSearch) return true;
  try {
    return provider.shouldSearch(query) === true;
  } catch {
    return false;
  }
}

/** Bounded search: timeout, max results, http(s) URLs only, snippets capped. Failures return []. */
export async function runWebSearch(
  provider: WebSearchProvider,
  query: string,
  opts?: { maxResults?: number; timeoutMs?: number; signal?: AbortSignal },
): Promise<WebSource[]> {
  return (await runWebSearchDetailed(provider, query, opts)).sources;
}

/** `runWebSearch`, also carrying the search's cost. A failure has no sources; it may still have a cost. */
export async function runWebSearchDetailed(
  provider: WebSearchProvider,
  query: string,
  opts?: { maxResults?: number; timeoutMs?: number; signal?: AbortSignal },
): Promise<BoundedSearch> {
  // Checked here, not only by the caller, so every path to a search is gated.
  if (!searchAllowed(provider, query)) return { sources: [] };

  const maxResults = Math.min(opts?.maxResults ?? 5, 10);
  const timeoutMs = opts?.timeoutMs ?? 8000;

  const abortController = new AbortController();
  const cleanupFns: Array<() => void> = [];
  
  if (opts?.signal) {
    if (opts.signal.aborted) {
      // Never sent, so nothing was charged.
      return { sources: [] };
    }
    const abortHandler = () => abortController.abort();
    opts.signal.addEventListener('abort', abortHandler);
    cleanupFns.push(() => opts.signal?.removeEventListener('abort', abortHandler));
  }

  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
  cleanupFns.push(() => clearTimeout(timeoutId));

  try {
    const searchPromise = provider.search(query, { maxResults, signal: abortController.signal });
    const timeoutPromise = new Promise<never>((_, reject) => {
      const tid = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      cleanupFns.push(() => clearTimeout(tid));
    });

    const result = await Promise.race([searchPromise, timeoutPromise]);
    const found = Array.isArray(result) ? result : result.sources;
    const reported = Array.isArray(result) ? undefined : result.cost;
    const sources = found
      .filter(r => r.url.startsWith('http://') || r.url.startsWith('https://'))
      .slice(0, maxResults)
      .map(r => ({
        title: r.title.substring(0, 200),
        url: r.url,
        snippet: r.snippet.substring(0, 500),
      }));
    const cost = reported ?? (provider.reportsCost ? 'unknown' as const : undefined);
    return cost === undefined ? { sources } : { sources, cost };
  } catch (err) {
    // Sent, and no settlement came back: a provider that reports cost may have been charged.
    return provider.reportsCost ? { sources: [], cost: 'unknown' } : { sources: [] };
  } finally {
    cleanupFns.forEach(fn => fn());
  }
}

export function createWebSearchTool(provider: WebSearchProvider): AgentTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: WEB_SEARCH_TOOL_ID,
        description: 'Search the web for up-to-date information',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          },
          required: ['query']
        }
      }
    },
    execute: async (args: Record<string, unknown>) => {
      const query = typeof args.query === 'string' ? args.query : '';
      return await runWebSearch(provider, query);
    }
  };
}
