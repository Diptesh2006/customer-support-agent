// The ONLY module that talks to the gateway, and only through the SDK.
import { nRouter, isPriced } from '@nrouter_ai/sdk';
import type { ChatMessage, ResponseMeta } from '@nrouter_ai/sdk';
import type { CostEvent } from './types.js';
import { SupportAgentError } from './errors.js';
import { maskPii, maskMessageContent } from './pii.js';

/** `defaultHeaders` are sent on every gateway call; none are added unless the caller supplies them. */
export function createClient(
  apiKey: string,
  baseURL?: string,
  defaultHeaders?: Record<string, string>,
): nRouter {
  if (!apiKey || apiKey.trim() === '') {
    throw new SupportAgentError('invalid_config', 'API key must not be empty');
  }
  return new nRouter({ apiKey, baseURL, ...(defaultHeaders ? { defaultHeaders } : {}) });
}

/** Embed texts via the SDK. Returns one vector per input, in order. */
export async function embed(
  client: nRouter,
  model: string,
  input: string[],
  dimensions: number,
  signal?: AbortSignal,
  opts?: { maskPii?: boolean },
): Promise<number[][]> {
  if (!input || input.length === 0) {
    return [];
  }
  const textsToEmbed = opts?.maskPii !== false ? input.map(t => maskPii(t)) : input;
  const res = await client.embeddings.create({ model, input: textsToEmbed, dimensions }, { signal });
  const data = res.data.sort((a, b) => a.index - b.index);
  if (data.length !== input.length) {
    throw new SupportAgentError('upstream_error', 'Embedding count mismatch');
  }
  const result: number[][] = [];
  for (const d of data) {
    if (d.embedding.length !== dimensions) {
      throw new SupportAgentError('upstream_error', 'Embedding dimension mismatch');
    }
    result.push(d.embedding);
  }
  return result;
}

export interface StreamedAnswer {
  /** Cost read from the response metadata; a stream is normally unpriced. */
  cost: CostEvent;
  /** Text deltas, empty deltas already filtered out. */
  chunks: AsyncIterable<string>;
}

/** Stream a chat completion via the SDK's nr.stream. */
export async function streamChat(
  client: nRouter,
  opts: { model: string; messages: ChatMessage[]; maxTokens: number; signal?: AbortSignal; maskPii?: boolean },
): Promise<StreamedAnswer> {
  const messages = opts.maskPii !== false
    ? opts.messages.map(m => ({ ...m, content: maskMessageContent(m.content) as any }))
    : opts.messages;

  const result = await client.nr.stream({
    model: opts.model,
    messages,
    maxTokens: opts.maxTokens
  }, opts.signal);

  const cost = costFromMeta(result.meta);

  async function* generateChunks() {
    for await (const chunk of result.chunks) {
      if (chunk.delta && chunk.delta.length > 0) {
        yield chunk.delta;
      }
    }
  }

  return {
    cost,
    chunks: generateChunks()
  };
}

/** One web-grounded answer: its text and the URLs the gateway says it drew on. */
export interface GroundedAnswer {
  text: string;
  /** `start`/`end` index into `text` when the gateway reports the cited span. */
  citations: Array<{ title: string; url: string; start?: number; end?: number }>;
}

/**
 * Ask the gateway for a web-grounded answer via the SDK's nr.chat, with the
 * gateway's own search switched on. Malformed citations are dropped, not thrown.
 */
export async function groundedSearch(
  client: nRouter,
  opts: { model: string; query: string; maxTokens: number; signal?: AbortSignal; maskPii?: boolean },
): Promise<GroundedAnswer> {
  const query = opts.maskPii !== false ? maskPii(opts.query) : opts.query;
  const res = await client.nr.chat({
    model: opts.model,
    systemPrompt: 'Search the web and answer the question in a few short, factual sentences.',
    messages: [{ role: 'user', content: query }],
    maxTokens: opts.maxTokens,
    extra: { nrouter_web_search: true },
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  const body = res.body as { choices?: Array<{ message?: { content?: unknown; annotations?: unknown } }> };
  const message = body.choices?.[0]?.message;
  const text = typeof message?.content === 'string' ? message.content : '';
  const citations: GroundedAnswer['citations'] = [];
  const annotations = Array.isArray(message?.annotations) ? message.annotations : [];
  for (const a of annotations as Array<{ type?: unknown; url_citation?: Record<string, unknown> } | null>) {
    const c = a && a.type === 'url_citation' ? a.url_citation : undefined;
    if (!c || typeof c.url !== 'string') continue;
    citations.push({
      url: c.url,
      title: typeof c.title === 'string' ? c.title : '',
      ...(Number.isInteger(c.start_index) ? { start: c.start_index as number } : {}),
      ...(Number.isInteger(c.end_index) ? { end: c.end_index as number } : {}),
    });
  }
  return { text, citations };
}

/** Map SDK ResponseMeta to a CostEvent. Unpriced → costUsd null, never 0. */
export function costFromMeta(meta: ResponseMeta): CostEvent {
  const priced = isPriced(meta);
  
  let costUsd = null;
  if (priced && meta.cost !== null) {
    costUsd = meta.cost;
  }
  if (costUsd === 0) {
    costUsd = null;
  }
  
  const res: CostEvent = {
    costUsd,
    status: (priced && costUsd !== null) ? 'exact' : 'unpriced'
  };
  
  if (meta.requestId) {
    res.requestId = meta.requestId;
  }
  return res;
}
