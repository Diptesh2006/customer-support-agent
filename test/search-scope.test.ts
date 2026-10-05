import { describe, it, expect, vi } from 'vitest';
import { nRouter } from '@nrouter_ai/sdk';
import { createNRouterWebSearch, GROUNDING_REDIRECT_HOST } from '../src/nrouter-web-search.js';
import { runWebSearch, runWebSearchDetailed, searchAllowed, createWebSearchTool } from '../src/web-search.js';
import { SupportAgentError } from '../src/errors.js';
import type { WebSearchProvider, WebSearchResult } from '../src/types.js';
import type { RedirectCheck } from '../src/knowledge/fetch.js';

type Call = Record<string, unknown>;
type Cite = { url: string; title?: string; start_index?: number; end_index?: number };

const REDIRECT = `https://${GROUNDING_REDIRECT_HOST}/grounding-api-redirect/`;

function fakeClient(content: string, cites: Cite[], calls: Call[] = []): nRouter {
  const client = Object.create(nRouter.prototype);
  client.nr = {
    chat: async (opts: Call) => {
      calls.push(opts);
      return {
        body: { choices: [{ message: { content, annotations: cites.map(c => ({ type: 'url_citation', url_citation: c })) } }] },
        meta: { cost: 0.03, costStatus: 'exact' },
      };
    },
  };
  return client;
}

async function detailed(provider: WebSearchProvider, query = 'how does nrouter billing work'): Promise<WebSearchResult> {
  const result = await provider.search(query, { maxResults: 5 });
  return Array.isArray(result) ? { sources: result } : result;
}

/** Resolves the fake redirect ids used below; anything else is unresolvable. */
const targets: Record<string, string> = {
  [`${REDIRECT}pricing`]: 'https://nrouter.ai/pricing',
  [`${REDIRECT}docs`]: 'https://docs.nrouter.ai/guides/billing',
  [`${REDIRECT}outside`]: 'https://nodejs.org/en/about/previous-releases',
};
const found = (map: Record<string, string>) => async (url: string): Promise<RedirectCheck> => {
  if (map[url]) return { status: 'redirect', target: map[url]! };
  // An engine link that is not in the map leads nowhere we can verify; any other page is its own destination.
  return url.startsWith(REDIRECT) ? { status: 'unknown' } : { status: 'final' };
};
const resolveRedirect = found(targets);

describe('createNRouterWebSearch — allowedDomains', () => {
  it('keeps sources inside the allow-list, by their real URL, subdomains included', async () => {
    const provider = createNRouterWebSearch({
      client: fakeClient('The fee is 4%.', [
        { url: `${REDIRECT}pricing`, title: 'nrouter.ai', start_index: 0, end_index: 14 },
        { url: `${REDIRECT}docs`, title: 'nrouter.ai', start_index: 0, end_index: 14 },
      ]),
      allowedDomains: ['nrouter.ai'],
      resolveRedirect,
    });
    const { sources } = await detailed(provider);
    expect(sources.map(s => s.url)).toEqual(['https://nrouter.ai/pricing', 'https://docs.nrouter.ai/guides/billing']);
    expect(sources[0]!.snippet).toBe('The fee is 4%.');
  });

  it('passes on only the text its citations cover, never the uncited rest of the answer', async () => {
    const text = 'The fee is 4%. Also, Node 24 is the LTS line. Top-ups start at $5.';
    const provider = createNRouterWebSearch({
      client: fakeClient(text, [
        { url: `${REDIRECT}pricing`, title: 'nrouter.ai', start_index: 0, end_index: 14 },
        { url: `${REDIRECT}docs`, title: 'nrouter.ai', start_index: 46, end_index: text.length },
      ]),
      allowedDomains: ['nrouter.ai'],
      resolveRedirect,
    });
    const { sources } = await detailed(provider);
    const passed = sources.map(s => s.snippet).join(' ');
    expect(passed).toContain('The fee is 4%.');
    expect(passed).toContain('Top-ups start at $5.');
    expect(passed).not.toContain('Node 24');
  });

  it('drops an answer whose citations mark no usable span: nothing in it can be attributed', async () => {
    for (const span of [{}, { start_index: 5, end_index: 5 }, { start_index: 9, end_index: 2 }, { start_index: -3, end_index: 4 }, { start_index: 900, end_index: 950 }]) {
      const provider = createNRouterWebSearch({
        client: fakeClient('The fee is 4%.', [{ url: `${REDIRECT}pricing`, title: 'nrouter.ai', ...span }]),
        allowedDomains: ['nrouter.ai'],
        resolveRedirect,
      });
      expect((await detailed(provider)).sources, JSON.stringify(span)).toEqual([]);
    }
  });

  it('one citation that covers nothing sinks the whole answer, even beside a good one', async () => {
    const provider = createNRouterWebSearch({
      client: fakeClient('The fee is 4%. Something uncovered.', [
        { url: `${REDIRECT}pricing`, title: 'nrouter.ai', start_index: 0, end_index: 14 },
        { url: `${REDIRECT}docs`, title: 'nrouter.ai' },
      ]),
      allowedDomains: ['nrouter.ai'],
      resolveRedirect,
    });
    expect((await detailed(provider)).sources).toEqual([]);
  });

  it('follows an allowed page that itself redirects: one that ends outside is outside', async () => {
    const hop: Record<string, string> = { ...targets, 'https://nrouter.ai/go': 'https://evil.example/landing', 'https://nrouter.ai/old': 'https://nrouter.ai/pricing' };
    const resolver = found(hop);
    const outside = createNRouterWebSearch({
      client: fakeClient('The fee is 4%.', [{ url: 'https://nrouter.ai/go', start_index: 0, end_index: 14 }]),
      allowedDomains: ['nrouter.ai'],
      resolveRedirect: resolver,
    });
    expect((await detailed(outside)).sources).toEqual([]);

    const moved = createNRouterWebSearch({
      client: fakeClient('The fee is 4%.', [{ url: 'https://nrouter.ai/old', start_index: 0, end_index: 14 }]),
      allowedDomains: ['nrouter.ai'],
      resolveRedirect: resolver,
    });
    expect((await detailed(moved)).sources.map(s => s.url)).toEqual(['https://nrouter.ai/pricing']);
  });

  it('an allowed page whose destination cannot be verified is outside: unknown is never final', async () => {
    for (const first of ['https://nrouter.ai/x', `${REDIRECT}pricing`]) {
      const provider = createNRouterWebSearch({
        client: fakeClient('The fee is 4%.', [{ url: first, start_index: 0, end_index: 14 }]),
        allowedDomains: ['nrouter.ai'],
        // The engine link resolves; the allowed page it names then answers with something unverifiable.
        resolveRedirect: async (url: string): Promise<RedirectCheck> =>
          url.startsWith(REDIRECT) ? { status: 'redirect', target: 'https://nrouter.ai/x' } : { status: 'unknown' },
      });
      expect((await detailed(provider)).sources, first).toEqual([]);
    }
  });

  it('gives up on a redirect chain that does not end', async () => {
    const provider = createNRouterWebSearch({
      client: fakeClient('The fee is 4%.', [{ url: 'https://nrouter.ai/a', start_index: 0, end_index: 14 }]),
      allowedDomains: ['nrouter.ai'],
      resolveRedirect: async (url: string): Promise<RedirectCheck> => ({ status: 'redirect', target: url.endsWith('/a') ? 'https://nrouter.ai/b' : 'https://nrouter.ai/a' }),
    });
    expect((await detailed(provider)).sources).toEqual([]);
  });

  it('discards the whole answer when any citation is outside the allow-list, and still reports the cost', async () => {
    const provider = createNRouterWebSearch({
      client: fakeClient('Node 24 is LTS and the fee is 4%.', [{ url: `${REDIRECT}pricing`, title: 'nrouter.ai', start_index: 18, end_index: 33 }, { url: `${REDIRECT}outside`, title: 'nodejs.org', start_index: 0, end_index: 14 }]),
      allowedDomains: ['nrouter.ai'],
      resolveRedirect,
    });
    const result = await detailed(provider);
    expect(result.sources).toEqual([]);
    expect(result.cost).toEqual({ costUsd: 0.03, status: 'exact' });
  });

  it('does not trust a citation title: a redirect that claims an allowed site but leads elsewhere is outside', async () => {
    const provider = createNRouterWebSearch({
      client: fakeClient('Node 24 is LTS.', [{ url: `${REDIRECT}outside`, title: 'nrouter.ai', start_index: 0, end_index: 15 }]),
      allowedDomains: ['nrouter.ai'],
      resolveRedirect,
    });
    expect((await detailed(provider)).sources).toEqual([]);
  });

  it('treats a redirect it cannot resolve as outside', async () => {
    const provider = createNRouterWebSearch({
      client: fakeClient('The fee is 4%.', [{ url: `${REDIRECT}unknown`, title: 'nrouter.ai', start_index: 0, end_index: 14 }]),
      allowedDomains: ['nrouter.ai'],
      resolveRedirect,
    });
    expect((await detailed(provider)).sources).toEqual([]);
  });

  it('treats a resolver that throws as outside', async () => {
    const provider = createNRouterWebSearch({
      client: fakeClient('The fee is 4%.', [{ url: `${REDIRECT}pricing`, title: 'nrouter.ai', start_index: 0, end_index: 14 }]),
      allowedDomains: ['nrouter.ai'],
      resolveRedirect: async () => { throw new Error('network'); },
    });
    expect((await detailed(provider)).sources).toEqual([]);
  });

  it('rejects hostname lookalikes', async () => {
    for (const url of ['https://evilnrouter.ai/x', 'https://nrouter.ai.evil.example/x', 'https://nrouter.ai@evil.example/x', 'https://evil.example/nrouter.ai']) {
      const provider = createNRouterWebSearch({ client: fakeClient('text', [{ url, start_index: 0, end_index: 4 }]), allowedDomains: ['nrouter.ai'], resolveRedirect });
      expect((await detailed(provider)).sources, url).toEqual([]);
    }
  });

  it('returns nothing when the answer cites nothing: uncited text is not attributable to an allowed site', async () => {
    const provider = createNRouterWebSearch({ client: fakeClient('Some confident claim.', []), allowedDomains: ['nrouter.ai'], resolveRedirect });
    expect((await detailed(provider)).sources).toEqual([]);
  });

  it('asks the engine to stay on the allowed sites', async () => {
    const calls: Call[] = [];
    const provider = createNRouterWebSearch({
      client: fakeClient('x', [], calls),
      allowedDomains: ['nrouter.ai', 'docs.example.com'],
      resolveRedirect,
    });
    await detailed(provider, 'platform fee');
    const sent = JSON.stringify(calls[0]!.messages) + String(calls[0]!.systemPrompt);
    expect(sent).toContain('site:nrouter.ai');
    expect(sent).toContain('site:docs.example.com');
  });

  it('refuses an empty or malformed allow-list instead of searching the open web', () => {
    const client = fakeClient('x', []);
    for (const bad of [[], [''], ['https://nrouter.ai'], ['nrouter.ai/docs'], ['*.nrouter.ai'], ['nrouter'], [' ']]) {
      expect(() => createNRouterWebSearch({ client, allowedDomains: bad as string[] }), JSON.stringify(bad)).toThrow(SupportAgentError);
    }
  });

  it('without an allow-list behaves as before: sources as cited, no resolving', async () => {
    const resolver = vi.fn(resolveRedirect);
    const provider = createNRouterWebSearch({
      client: fakeClient('Node 24 is LTS.', [{ url: `${REDIRECT}outside`, title: 'nodejs.org' }]),
      resolveRedirect: resolver,
    });
    const { sources } = await detailed(provider);
    expect(sources.map(s => s.url)).toEqual([`${REDIRECT}outside`]);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('createNRouterWebSearch — requireTerms', () => {
  const client = fakeClient('x', []);

  it('searches only when the question names one of the terms, as a whole word, any case', () => {
    const provider = createNRouterWebSearch({ client, requireTerms: ['nrouter'] });
    expect(provider.shouldSearch!('Does nRouter support fallbacks?')).toBe(true);
    expect(provider.shouldSearch!('NROUTER pricing')).toBe(true);
    expect(provider.shouldSearch!('What is the latest Node.js LTS version?')).toBe(false);
    expect(provider.shouldSearch!('what is anrouterx')).toBe(false);
  });

  it('a direct search is gated too: an unrelated question sends nothing', async () => {
    const calls: Call[] = [];
    const provider = createNRouterWebSearch({ client: fakeClient('x', [], calls), requireTerms: ['nrouter'] });
    expect(await detailed(provider, 'What is the latest Node.js LTS version?')).toEqual({ sources: [] });
    expect(calls).toHaveLength(0);
  });

  it('has no gate when no terms are given', () => {
    expect(createNRouterWebSearch({ client }).shouldSearch).toBeUndefined();
  });

  it('refuses an empty or blank term list', () => {
    for (const bad of [[], [''], ['  ']]) {
      expect(() => createNRouterWebSearch({ client, requireTerms: bad })).toThrow(SupportAgentError);
    }
  });
});

describe('search eligibility is enforced at every entry point', () => {
  const sources = [{ title: 't', url: 'https://u', snippet: 's' }];

  it('the bounded search does not call a provider whose gate says no, and costs nothing', async () => {
    const search = vi.fn(async () => ({ sources, cost: { costUsd: 0.03, status: 'exact' as const } }));
    const provider: WebSearchProvider = { label: 't', reportsCost: true, shouldSearch: () => false, search };
    expect(await runWebSearchDetailed(provider, 'q')).toEqual({ sources: [] });
    expect(await runWebSearch(provider, 'q')).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it('the tool path is gated too', async () => {
    const search = vi.fn(async () => sources);
    const tool = createWebSearchTool({ label: 't', shouldSearch: () => false, search });
    expect(await tool.execute({ query: 'q' }, {} as any)).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it('a gate that throws fails closed', async () => {
    const search = vi.fn(async () => sources);
    const provider: WebSearchProvider = { label: 't', shouldSearch: () => { throw new Error('boom'); }, search };
    expect(searchAllowed(provider, 'q')).toBe(false);
    expect(await runWebSearchDetailed(provider, 'q')).toEqual({ sources: [] });
    expect(search).not.toHaveBeenCalled();
  });

  it('a provider with no gate is always eligible', () => {
    expect(searchAllowed({ label: 't', search: async () => [] }, 'q')).toBe(true);
  });
});
