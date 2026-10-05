import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runWebSearch, runWebSearchDetailed, createWebSearchTool, WEB_SEARCH_TOOL_ID } from '../src/web-search.js';
import type { WebSearchProvider } from '../src/types.js';

describe('runWebSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns [] on timeout', async () => {
    const provider: WebSearchProvider = {
      label: 'test',
      search: async (q, opts) => {
        return new Promise(resolve => {
          opts.signal?.addEventListener('abort', () => resolve([]));
        });
      }
    };
    
    const p = runWebSearch(provider, 'query', { timeoutMs: 100 });
    vi.advanceTimersByTime(150);
    const result = await p;
    expect(result).toEqual([]);
  });

  it('returns [] if provider hangs', async () => {
    const provider: WebSearchProvider = {
      label: 'test',
      search: async () => new Promise(() => {}) // never resolves
    };
    
    const p = runWebSearch(provider, 'query', { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await p;
    expect(result).toEqual([]);
  }, 1000); // bounded test

  it('a provider that rejects after the timeout never becomes an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    // Real timers: the unhandled-rejection event is emitted from Node's own tick queue.
    vi.useRealTimers();
    try {
      const provider: WebSearchProvider = {
        label: 'test',
        search: () => new Promise((_, reject) => setTimeout(() => reject(new Error('late failure')), 60)),
      };
      expect(await runWebSearch(provider, 'query', { timeoutMs: 20 })).toEqual([]);
      await new Promise((r) => setTimeout(r, 150));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }, 1000);

  it('filters non-http(s) urls and truncates text', async () => {
    const provider: WebSearchProvider = {
      label: 'test',
      search: async () => [
        { title: 'A'.repeat(300), url: 'https://example.com', snippet: 'B'.repeat(600) },
        { title: 'Bad', url: 'ftp://example.com', snippet: 'nope' },
        { title: 'Good', url: 'http://example.org', snippet: 'yes' }
      ]
    };
    
    const result = await runWebSearch(provider, 'q');
    expect(result).toHaveLength(2);
    expect(result[0]!.url).toBe('https://example.com');
    expect(result[0]!.title.length).toBe(200);
    expect(result[0]!.snippet.length).toBe(500);
    expect(result[1]!.url).toBe('http://example.org');
  });
});

describe('runWebSearchDetailed', () => {
  it('carries the cost a provider reports beside its sources', async () => {
    const provider: WebSearchProvider = {
      label: 'test',
      search: async () => ({
        sources: [{ title: 't', url: 'https://u', snippet: 's' }],
        cost: { costUsd: 0.03, status: 'exact' as const, requestId: 'r' },
      }),
    };
    const result = await runWebSearchDetailed(provider, 'q');
    expect(result.sources).toEqual([{ title: 't', url: 'https://u', snippet: 's' }]);
    expect(result.cost).toEqual({ costUsd: 0.03, status: 'exact', requestId: 'r' });
  });

  it('reports no cost for a provider that returns a bare list', async () => {
    const provider: WebSearchProvider = { label: 'test', search: async () => [{ title: 't', url: 'https://u', snippet: 's' }] };
    const result = await runWebSearchDetailed(provider, 'q');
    expect(result.sources).toHaveLength(1);
    expect(result.cost).toBeUndefined();
  });

  it('a failed search by a provider that reports no cost has no sources and no cost', async () => {
    const provider: WebSearchProvider = { label: 'test', search: async () => { throw new Error('boom'); } };
    expect(await runWebSearchDetailed(provider, 'q')).toEqual({ sources: [] });
  });

  it('keeps the cost of a search whose sources were all unusable', async () => {
    const provider: WebSearchProvider = {
      label: 'test',
      reportsCost: true,
      search: async () => ({ sources: [{ title: 't', url: 'ftp://nope', snippet: 's' }], cost: { costUsd: 0.03, status: 'exact' as const } }),
    };
    expect(await runWebSearchDetailed(provider, 'q')).toEqual({ sources: [], cost: { costUsd: 0.03, status: 'exact' } });
  });

  it('a cost-reporting provider that fails after dispatch leaves the charge unknown', async () => {
    const provider: WebSearchProvider = { label: 'test', reportsCost: true, search: async () => { throw new Error('boom'); } };
    expect(await runWebSearchDetailed(provider, 'q')).toEqual({ sources: [], cost: 'unknown' });
  });

  it('a cost-reporting provider that times out leaves the charge unknown', async () => {
    const provider: WebSearchProvider = { label: 'test', reportsCost: true, search: () => new Promise(() => {}) };
    expect(await runWebSearchDetailed(provider, 'q', { timeoutMs: 20 })).toEqual({ sources: [], cost: 'unknown' });
  });

  it('a search that never dispatched, because the request was already aborted, costs nothing', async () => {
    let called = false;
    const provider: WebSearchProvider = { label: 'test', reportsCost: true, search: async () => { called = true; return []; } };
    const controller = new AbortController();
    controller.abort();
    expect(await runWebSearchDetailed(provider, 'q', { signal: controller.signal })).toEqual({ sources: [] });
    expect(called).toBe(false);
  });

  it('runWebSearch still returns just the sources', async () => {
    const provider: WebSearchProvider = {
      label: 'test',
      search: async () => ({ sources: [{ title: 't', url: 'https://u', snippet: 's' }], cost: { costUsd: 0.03, status: 'exact' as const } }),
    };
    expect(await runWebSearch(provider, 'q')).toEqual([{ title: 't', url: 'https://u', snippet: 's' }]);
  });
});

describe('createWebSearchTool', () => {
  it('creates an agent tool with correct schema', async () => {
    const provider: WebSearchProvider = {
      label: 'test',
      search: async () => [{ title: 't', url: 'https://u', snippet: 's' }]
    };
    const tool = createWebSearchTool(provider);
    expect(tool.definition.function.name).toBe(WEB_SEARCH_TOOL_ID);
    expect(tool.definition.function.parameters?.required).toEqual(['query']);
    
    const result = await tool.execute({ query: 'test' }, {} as any);
    expect(result).toEqual([{ title: 't', url: 'https://u', snippet: 's' }]);
  });
});
