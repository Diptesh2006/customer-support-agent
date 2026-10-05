# @nrouter_ai/support-agent

An autonomous support agent powered by nRouter, featuring RAG, web search fallback, and streaming chat.

## Installation

```bash
npm install @nrouter_ai/support-agent
```

## Quick Start

1. **Build a knowledge base**
```bash
npx @nrouter_ai/support-agent build-kb --docs ./docs --out index.json
```

2. **Serve the agent (Next.js App Router)**
```typescript
// app/api/chat/route.ts
import { createSupportAgent } from '@nrouter_ai/support-agent';
import { loadKnowledgeIndex } from '@nrouter_ai/support-agent/node';

// Load the index once at startup
const knowledge = await loadKnowledgeIndex('./index.json');

const agent = createSupportAgent({
  apiKey: process.env.NROUTER_API_KEY!,
  model: 'claude-haiku-4-5-20251001',
  knowledge
});

export async function POST(req: Request) {
  // IMPORTANT: The host must authenticate and rate-limit this route.
  const ctx = { identity: { email: 'user@example.com' }, audiences: ['public'] };
  const body = await req.json();
  return new Response(agent.chatSSE(body, ctx), {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}
```

## Configuration

| Option | Description |
|---|---|
| `apiKey` | nRouter virtual key (`sk-nrouter-...`) |
| `model` | The chat model ID, or an ordered list of up to three: the first is the primary, later entries are fallbacks (see [Model Fallback](#model-fallback)) |
| `defaultHeaders` | Optional extra headers sent on every gateway call. None are added by default. Ignored when you pass your own `client` |
| `booking` | Optional `{ url, label? }`. Offers a booking link through the `action` event. `url` must be `https:` and at most 2048 characters; `label` is at most 60 characters and defaults to `Book a meeting` |
| `suggestions` | Optional `true` or `{ max }` (1 to 5, default 3). Emits related follow-up questions through the `suggestions` event. Off by default |
| `knowledge` | `KnowledgeStore` or `KnowledgeIndex` JSON |
| `webSearch` | Optional web search provider, used only when the knowledge base has no confident answer. `createNRouterWebSearch({ apiKey })` searches through the gateway with the same key (see [Web Search](#web-search)) |
| `memoryStore` | Optional `(sessionId) => MemoryStore` from `@nrouter_ai/sdk`. When set and the host passes `ctx.sessionId`, the stored history is authoritative: only the latest user turn from the request is appended, and earlier turns in the request body are ignored |
| `maskPii` | Mask emails and phone numbers before text leaves the process (default `true`) |

## Web Search

When retrieval over your docs is not confident, the agent can search the web before it answers.
`createNRouterWebSearch` does that through the gateway's own search grounding: one SDK call on the
key you already have, no second vendor.

```typescript
import { createSupportAgent, createNRouterWebSearch } from '@nrouter_ai/support-agent';

const agent = createSupportAgent({
  apiKey: process.env.NROUTER_API_KEY!,
  model: 'nrouter/auto',
  knowledge,
  webSearch: createNRouterWebSearch({
    apiKey: process.env.NROUTER_API_KEY!,
    model: 'nrouter/auto',   // the default; any model your gateway serves with web search
    timeoutMs: 30_000,       // 1000 to 60000, default 8000
  }),
});
```

The pages the search cites arrive in the `citations` event, ahead of the doc matches on a turn that
searched. A search that fails or runs out of time contributes no sources and the answer still streams.

The search is a second billed call, and the `cost` event counts it: on a searched turn `costUsd` is
the answer plus the search, with `chatCostUsd` and `searchCostUsd` showing the parts. If either part
is unknown (an unpriced model, or a search that was sent and never reported back) the total is
`unpriced` and the unknown part is `null`; it is never a partial sum and never zero. The total does
not include the question's embedding call.

### When the search runs

Docs first. The search runs in two cases:

- retrieval found nothing close (low confidence), before the answer is written;
- retrieval found pages that look related but do not answer the question. The model is told to say
  so with a marker instead of writing "that is not in the docs"; the marker is never shown, the
  search runs, and the answer is written again from what it found. That first reply is a billed
  call and is counted in `cost`. This second case is off when you pass host `tools`, so they never
  run twice.

### Keeping the search on your own sites

By default the search covers the open web. A support agent usually should not: give it your sites,
and optionally the words a question must contain before a search is worth paying for.

```typescript
webSearch: createNRouterWebSearch({
  apiKey: process.env.NROUTER_API_KEY!,
  allowedDomains: ['example.com'],   // bare hostnames; subdomains included
  requireTerms: ['acme'],            // optional: search only when the question names one
}),
```

- `allowedDomains` is enforced on what comes back. Every cited page is checked by its real address
  (the search engine's redirect links are resolved with one un-followed request each, never trusted
  by their label), and the citations you get carry that real address. If any cited page is outside
  the list, or the answer cites nothing, the whole result is discarded and the agent answers from
  your docs alone. The engine is asked to stay on those sites, but that request is not the control;
  the check on the result is. A discarded search was still made, so it is still charged and reported.
- `requireTerms` is a cheap gate, not a boundary: a question that mentions the word passes it. It
  exists to skip the search, and its charge, for plainly unrelated questions. A skipped search sends
  nothing and the visitor is not told one ran.
- An empty or malformed `allowedDomains` is refused when the provider is created.

Any object with a `label` and a `search(query, { maxResults, signal })` method works as a provider,
and may define `shouldSearch(query)` to gate its own searches.
It may return a plain list of sources, or `{ sources, cost }` and set `reportsCost: true` if it knows
what each search costs.

## Usage

### `chat(req, ctx)`
Returns an `AsyncIterable<AgentEvent>` for custom handling. `req` is the untrusted input (e.g., the JSON request body containing messages). `ctx` is the `TrustedContext` supplied by the host's authentication, containing user identity and audiences.

### `chatSSE(req, ctx)`
Returns a `ReadableStream<Uint8Array>` formatted as Server-Sent Events, directly usable in HTTP responses. Parameters are the same as `chat`.

## Events & Wire Format
The agent streams events as Server-Sent Events (`text/event-stream`). Events include `tool_call`, `confidence`, `citations`, `token`, `suggestions`, `action`, `cost`, `error`, and `done`.

Each frame is `data: <json>\n\n`. Within one response the order is `token`… → `suggestions` → `action` → `cost` → `[DONE]`; `suggestions` and `action` are optional and neither is sent on an errored response.

| Event | SSE JSON | When |
|---|---|---|
| `suggestions` | `{"nrouter_event":"suggestions","questions":["…"]}` | `suggestions` is configured and the answer completed. Questions are built from the titles of the other retrieved documents |
| `action` | `{"nrouter_event":"action","action":"book_meeting","url":"…","label":"…"}` | `booking` is configured and either the visitor's latest message asks for a meeting, a demo, sales or commercial terms, or confidence is `low` |

Both are deterministic and make no extra model call. The booking URL comes only from your config: the model never sees or produces it. Suggestion text is derived from document titles, so treat it as untrusted and render it as plain text.

## Model Fallback
Pass `model: ['primary', 'backup']` to name fallbacks. The agent moves to the next entry only when the gateway refuses the call as unavailable (HTTP 404 `model_not_found`, or HTTP 503) before any token has been streamed and before any of your `tools` has run. It never falls back on an authentication, credit, budget, rate-limit or guardrail refusal, or on an abort, so a fallback cannot change who pays or how. At most `model.length - 1` fallbacks happen per request, and no event says which model answered.

## Hooks
Configure `hooks` to intercept feedback, gaps (low confidence questions), tool calls, and cost events.

## PII and Gateway Guardrails

When a virtual key enforces a PII redact guardrail, the gateway refuses pre-call content containing PII (pre-call redact == refuse). To ensure reliable operation:

- **Automatic Pre-call Masking:** Enabled by default (`maskPii: true`). Email addresses are masked as `[email]` and phone numbers (7+ digits with standard delimiters) are masked as `[phone]` at the gateway egress boundary (`streamChat` and `embed`). Non-PII numbers such as ISO dates, versions (e.g. `1.2.3`), prices, and short numbers (e.g. `402`, `7731`) are preserved.
- **Knowledge Base Build Recovery:** During `build-kb`, if the gateway refuses an embeddings batch with `guardrail_blocked`:
  - **Refuse-and-Name (default):** Re-embeds one chunk at a time to identify the offending documents and throws `SupportAgentError('guardrail_blocked', 'the gateway refused N document(s) under a guardrail: <url1>, <url2>')`, naming up to 10 unique document URLs.
  - **Skip Blocked (`--skip-blocked`):** Drops all chunks belonging to refused documents, invokes `onSkip({ title, url, reason })` once per skipped document, and builds the index from the remaining documents.
- **Disabling Masking:** Set `maskPii: false` in config or pass `--no-mask-pii` to the `build-kb` CLI if pre-call masking is not desired.

## Knowledge per Organisation
Maintain one index and one agent per organisation. Audiences are entitlement tags from the host's auth via `TrustedContext`, never the body. Audiences are never a tenancy boundary.

## Security
- **API key stays server-side:** the API key is never exposed to the client.
- **Untrusted vs Trusted Input:** `req` is untrusted; `ctx` is trusted. 
- **Fenced Data:** Retrieved and web text is fenced as data.
- **SSRF Guard:** The SSRF guard checks hostnames and IP literals, but it does not resolve DNS. Therefore, run `build-kb` where fetching the configured seed URLs is acceptable.
- **Host Responsibilities:** The host authenticates and rate-limits its route.

## Limits
Defaults: `maxMessages: 12`, `maxMessageChars: 2000`, `maxPageContextChars: 1000`. Customize via `limits` config.
