import { describe, it, expect } from 'vitest';
import { nRouter } from '@nrouter_ai/sdk';
import { createNRouterWebSearch } from '../src/nrouter-web-search.js';
import { SupportAgentError } from '../src/errors.js';
import type { WebSearchProvider, WebSource } from '../src/types.js';

type Call = Record<string, unknown>;

function fakeClient(body: unknown, calls: Call[] = [], meta: Record<string, unknown> = {}): nRouter {
  const client = Object.create(nRouter.prototype);
  client.nr = {
    chat: async (opts: Call) => {
      calls.push(opts);
      return { body, meta };
    },
  };
  return client;
}

/** The provider's sources, whichever of the two result shapes it used. */
async function sourcesOf(provider: WebSearchProvider, query: string, maxResults: number): Promise<WebSource[]> {
  const result = await provider.search(query, { maxResults });
  return Array.isArray(result) ? result : result.sources;
}

const grounded = {
  choices: [
    {
      message: {
        content: 'Node.js 24 is the active LTS line.',
        annotations: [
          { type: 'url_citation', url_citation: { title: 'nodejs.org', url: 'https://nodejs.org/en/about/previous-releases', start_index: 0, end_index: 10 } },
          { type: 'url_citation', url_citation: { title: 'github.com', url: 'https://github.com/nodejs/release', start_index: 11, end_index: 34 } },
          { type: 'url_citation', url_citation: { title: 'nodejs.org', url: 'https://nodejs.org/en/about/previous-releases', start_index: 0, end_index: 10 } },
        ],
      },
    },
  ],
};

describe('createNRouterWebSearch', () => {
  it('asks the gateway for a grounded answer through the SDK', async () => {
    const calls: Call[] = [];
    const provider = createNRouterWebSearch({ client: fakeClient(grounded, calls) });
    await provider.search('latest node lts', { maxResults: 5 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toBe('nrouter/auto');
    expect(calls[0]!.extra).toEqual({ nrouter_web_search: true });
    expect(JSON.stringify(calls[0]!.messages)).toContain('latest node lts');
  });

  it('uses the model the host names', async () => {
    const calls: Call[] = [];
    const provider = createNRouterWebSearch({ client: fakeClient(grounded, calls), model: 'some/model' });
    await provider.search('q', { maxResults: 5 });
    expect(calls[0]!.model).toBe('some/model');
  });

  it('maps url citations to sources, de-duplicated by url', async () => {
    const provider = createNRouterWebSearch({ client: fakeClient(grounded) });
    const sources = await sourcesOf(provider, 'latest node lts', 5);

    expect(sources.map(s => s.url)).toEqual([
      'https://nodejs.org/en/about/previous-releases',
      'https://github.com/nodejs/release',
    ]);
    expect(sources[0]!.title).toBe('nodejs.org');
    // The first source carries the grounded answer; later ones their cited span.
    expect(sources[0]!.snippet).toBe('Node.js 24 is the active LTS line.');
    expect(sources[1]!.snippet).toBe('is the active LTS line.');
  });

  it('honours maxResults', async () => {
    const provider = createNRouterWebSearch({ client: fakeClient(grounded) });
    expect(await sourcesOf(provider, 'q', 1)).toHaveLength(1);
  });

  it('returns no sources when the answer cites none', async () => {
    const body = { choices: [{ message: { content: 'I do not know.' } }] };
    const provider = createNRouterWebSearch({ client: fakeClient(body) });
    expect(await sourcesOf(provider, 'q', 5)).toEqual([]);
  });

  it('reports what the gateway charged for the search', async () => {
    const meta = { cost: 0.029, costStatus: 'exact', requestId: 'req_search' };
    const provider = createNRouterWebSearch({ client: fakeClient(grounded, [], meta) });
    const result = await provider.search('q', { maxResults: 5 });
    expect(Array.isArray(result)).toBe(false);
    expect((result as { cost?: unknown }).cost).toEqual({ costUsd: 0.029, status: 'exact', requestId: 'req_search' });
  });

  it('reports an unpriced search as unpriced, never as zero', async () => {
    const provider = createNRouterWebSearch({ client: fakeClient(grounded, [], { cost: null, costStatus: 'unpriced' }) });
    const result = await provider.search('q', { maxResults: 5 });
    expect((result as { cost?: unknown }).cost).toEqual({ costUsd: null, status: 'unpriced' });
  });

  it('ignores malformed annotations and non-http urls', async () => {
    const body = {
      choices: [
        {
          message: {
            content: 'answer',
            annotations: [
              null,
              { type: 'other' },
              { type: 'url_citation', url_citation: { url: 'javascript:alert(1)', title: 'x' } },
              { type: 'url_citation', url_citation: { url: 'https://ok.example/a' } },
            ],
          },
        },
      ],
    };
    const provider = createNRouterWebSearch({ client: fakeClient(body) });
    const sources = await sourcesOf(provider, 'q', 5);
    expect(sources).toEqual([{ title: 'ok.example', url: 'https://ok.example/a', snippet: 'answer' }]);
  });

  it('masks PII in the query before it leaves the process', async () => {
    const calls: Call[] = [];
    const provider = createNRouterWebSearch({ client: fakeClient(grounded, calls) });
    await provider.search('my email is jane.doe@example.com, how do I add credits', { maxResults: 5 });
    expect(JSON.stringify(calls[0]!.messages)).not.toContain('jane.doe@example.com');
  });

  it('passes the abort signal to the SDK', async () => {
    const calls: Call[] = [];
    const provider = createNRouterWebSearch({ client: fakeClient(grounded, calls) });
    const controller = new AbortController();
    await provider.search('q', { maxResults: 5, signal: controller.signal });
    expect(calls[0]!.signal).toBe(controller.signal);
  });

  it('carries a label and the timeout the host asked for', () => {
    const provider = createNRouterWebSearch({ client: fakeClient(grounded), label: 'the web', timeoutMs: 30_000 });
    expect(provider.label).toBe('the web');
    expect(provider.timeoutMs).toBe(30_000);
    expect(createNRouterWebSearch({ client: fakeClient(grounded) }).label).toBe('the web');
  });

  it('needs a client or an API key', () => {
    expect(() => createNRouterWebSearch({})).toThrow(SupportAgentError);
  });
});
