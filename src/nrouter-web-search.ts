// A web search provider that needs nothing but the nRouter key the agent already has.
import type { nRouter } from '@nrouter_ai/sdk';
import type { WebSearchProvider, WebSource } from './types.js';
import { createClient, groundedSearch } from './client.js';
import { SupportAgentError } from './errors.js';
import { checkRedirect, type RedirectCheck } from './knowledge/fetch.js';

export const DEFAULT_WEB_SEARCH_MODEL = 'nrouter/auto';
export const DEFAULT_WEB_SEARCH_LABEL = 'the web';
const SEARCH_MAX_TOKENS = 512;
const MAX_REDIRECT_HOPS = 4;

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
  /**
   * Keep the search inside your own sites: bare hostnames such as
   * `docs.example.com` (subdomains included). Every cited page is checked by
   * its real address; if any of them is outside this list the whole result is
   * discarded. Leave it out to search the open web. An empty list is refused.
   */
  allowedDomains?: string[];
  /**
   * Search only when the question contains one of these words (whole word, any
   * case). A cheap gate that saves the search charge on plainly unrelated
   * questions; `allowedDomains` is what keeps outside content out.
   */
  requireTerms?: string[];
  /**
   * Says what a link does: answers as a page, redirects somewhere, or cannot
   * be verified. Defaults to one un-followed request per link.
   */
  resolveRedirect?: (url: string, signal?: AbortSignal) => Promise<RedirectCheck>;
}

/** The host the gateway's search grounding wraps every cited page in. */
export const GROUNDING_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';

const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

function normalizeDomains(domains: string[] | undefined): string[] | null {
  if (domains === undefined) return null;
  const out = Array.isArray(domains) ? domains.map(d => (typeof d === 'string' ? d.trim().toLowerCase() : '')) : [];
  if (out.length === 0 || out.some(d => !HOSTNAME_RE.test(d))) {
    throw new SupportAgentError('invalid_config', 'allowedDomains must be a non-empty list of bare hostnames such as "docs.example.com"');
  }
  return out;
}

function termGate(terms: string[] | undefined): ((query: string) => boolean) | null {
  if (terms === undefined) return null;
  const words = Array.isArray(terms) ? terms.map(t => (typeof t === 'string' ? t.trim().toLowerCase() : '')) : [];
  if (words.length === 0 || words.some(w => w === '')) {
    throw new SupportAgentError('invalid_config', 'requireTerms must be a non-empty list of non-blank words');
  }
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![a-z0-9])(?:${escaped.join('|')})(?![a-z0-9])`, 'i');
  return query => re.test(query);
}

/** The URL when it is http(s) with no credentials and its host is an allowed domain or a subdomain of one. */
function insideDomains(url: string, domains: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return domains.some(d => host === d || host.endsWith(`.${d}`));
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
 * to the same key, no second vendor. Returns the pages the answer cites and
 * what the gateway charged for the call.
 */
export function createNRouterWebSearch(options: NRouterWebSearchOptions): WebSearchProvider {
  if (!options.client && !options.apiKey) {
    throw new SupportAgentError('invalid_config', 'createNRouterWebSearch needs a client or an apiKey');
  }
  const client = options.client ?? createClient(options.apiKey as string, options.baseURL, options.defaultHeaders);
  const model = options.model ?? DEFAULT_WEB_SEARCH_MODEL;
  const domains = normalizeDomains(options.allowedDomains);
  const gate = termGate(options.requireTerms);
  const resolve = options.resolveRedirect ?? ((url: string, signal?: AbortSignal) => checkRedirect(url, { signal }));

  /**
   * Where a citation finally lands when every step of the way stays inside the
   * allow-list, or null when it does not or that cannot be established. The
   * engine's own redirect link is the one outside hop allowed, and it must resolve.
   */
  async function finalAddress(url: string, allowed: string[], signal?: AbortSignal): Promise<string | null> {
    let current = url;
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      const viaEngine = hostOf(current) === GROUNDING_REDIRECT_HOST;
      if (!viaEngine && !insideDomains(current, allowed)) return null;
      let check: RedirectCheck;
      try {
        check = await resolve(current, signal);
      } catch {
        return null;
      }
      // Could not be verified: never treated as arrived.
      if (check.status === 'unknown') return null;
      // Answered as a page: the destination, unless it is the engine's own link, which is never one.
      if (check.status === 'final') return viaEngine ? null : current;
      current = check.target;
    }
    return null;
  }

  return {
    label: options.label ?? DEFAULT_WEB_SEARCH_LABEL,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    reportsCost: true,
    ...(gate ? { shouldSearch: gate } : {}),
    async search(query, opts) {
      // The gate holds for a direct call too, not only for callers that ask first.
      if (gate && !gate(query)) return { sources: [] };

      const answer = await groundedSearch(client, {
        model,
        query,
        maxTokens: SEARCH_MAX_TOKENS,
        signal: opts.signal,
        maskPii: options.maskPii,
        ...(domains ? { sites: domains } : {}),
      });

      if (domains) {
        const none = { sources: [], cost: answer.cost };
        // An answer that cites nothing cannot be tied to an allowed site.
        if (answer.citations.length === 0) return none;
        // A title is a label, not an address: test where each citation really leads.
        const addresses = await Promise.all(answer.citations.map(c => finalAddress(c.url, domains, opts.signal)));
        // One outside page means the answer drew on outside content: keep none of it.
        if (addresses.some(a => a === null)) return none;

        // Only the text a citation covers is attributable to an allowed page. The
        // rest of the answer is dropped, and a citation that covers nothing sinks it all.
        const byUrl = new Map<string, string[]>();
        for (let i = 0; i < answer.citations.length; i++) {
          const c = answer.citations[i]!;
          const covered = c.start !== undefined && c.end !== undefined && c.start >= 0 && c.end > c.start && c.end <= answer.text.length
            ? answer.text.slice(c.start, c.end).trim()
            : '';
          if (covered === '') return none;
          const url = addresses[i] as string;
          const spans = byUrl.get(url) ?? [];
          if (!spans.includes(covered)) spans.push(covered);
          byUrl.set(url, spans);
        }
        const scoped: WebSource[] = [];
        for (const [url, spans] of byUrl) {
          if (scoped.length >= opts.maxResults) break;
          scoped.push({ title: hostOf(url), url, snippet: spans.join(' ') });
        }
        return { sources: scoped, cost: answer.cost };
      }

      const citations = answer.citations;
      const sources: WebSource[] = [];
      const seen = new Set<string>();
      for (const c of citations) {
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
      return { sources, cost: answer.cost };
    },
  };
}
