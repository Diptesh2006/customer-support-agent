import { describe, it, expect } from 'vitest';
import { addSearchCost, sumChatCosts } from '../src/cost.js';
import { costFromMeta } from '../src/client.js';

describe('addSearchCost', () => {
  it('leaves the chat cost alone when no search cost applies', () => {
    const chat = { costUsd: 0.05, status: 'exact' as const, requestId: 'r1' };
    expect(addSearchCost(chat, undefined)).toEqual(chat);
  });

  it('adds an exact search cost to an exact chat cost and shows both parts', () => {
    const out = addSearchCost(
      { costUsd: 0.05, status: 'exact', requestId: 'chat' },
      { costUsd: 0.03, status: 'exact', requestId: 'search' },
    );
    expect(out.status).toBe('exact');
    expect(out.costUsd).toBeCloseTo(0.08, 10);
    expect(out.chatCostUsd).toBe(0.05);
    expect(out.searchCostUsd).toBe(0.03);
    // The turn is identified by the answer's request, not the search's.
    expect(out.requestId).toBe('chat');
  });

  it('is unpriced when the search was unpriced, and keeps the known chat part', () => {
    const out = addSearchCost({ costUsd: 0.05, status: 'exact', requestId: 'chat' }, { costUsd: null, status: 'unpriced' });
    expect(out).toEqual({ costUsd: null, status: 'unpriced', requestId: 'chat', chatCostUsd: 0.05, searchCostUsd: null });
  });

  it('is unpriced when a search was attempted and its charge is unknown', () => {
    const out = addSearchCost({ costUsd: 0.05, status: 'exact', requestId: 'chat' }, 'unknown');
    expect(out).toEqual({ costUsd: null, status: 'unpriced', requestId: 'chat', chatCostUsd: 0.05, searchCostUsd: null });
  });

  it('is unpriced when the chat was unpriced, and keeps the known search part', () => {
    const out = addSearchCost({ costUsd: null, status: 'unpriced' }, { costUsd: 0.03, status: 'exact' });
    expect(out).toEqual({ costUsd: null, status: 'unpriced', chatCostUsd: null, searchCostUsd: 0.03 });
  });

  it('never reports zero', () => {
    const out = addSearchCost({ costUsd: null, status: 'unpriced' }, { costUsd: null, status: 'unpriced' });
    expect(out.costUsd).toBeNull();
    expect(out.status).toBe('unpriced');
  });

  it('preserves actualModel and routingChain from chat cost (CSA-23)', () => {
    const chat = {
      costUsd: 0.05,
      status: 'exact' as const,
      requestId: 'chat',
      actualModel: 'anthropic/claude-3-5-sonnet-20241022',
      routingChain: 'direct'
    };
    const search = { costUsd: 0.02, status: 'exact' as const, requestId: 'search' };
    const out = addSearchCost(chat, search);
    expect(out.actualModel).toBe('anthropic/claude-3-5-sonnet-20241022');
    expect(out.routingChain).toBe('direct');
  });
});

describe('costFromMeta', () => {
  it('maps priced ResponseMeta to exact CostEvent and preserves actualModel & routingChain', () => {
    const meta = {
      requestId: 'req_123',
      latencyMs: 120,
      traceId: 'trace_abc',
      cost: 0.042,
      costStatus: 'exact',
      model: 'anthropic/claude-3-5-sonnet-20241022',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      limitSource: null,
      budgetWarning: null,
    };
    const cost = costFromMeta(meta as any, 'direct');
    expect(cost.costUsd).toBe(0.042);
    expect(cost.status).toBe('exact');
    expect(cost.requestId).toBe('req_123');
    expect(cost.actualModel).toBe('anthropic/claude-3-5-sonnet-20241022');
    expect(cost.routingChain).toBe('direct');
  });

  it('never reports zero cost for zero or unpriced responses', () => {
    const meta = {
      requestId: 'req_free',
      latencyMs: 50,
      traceId: null,
      cost: 0,
      costStatus: 'unpriced',
      model: 'test-model',
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      limitSource: null,
      budgetWarning: null,
    };
    const cost = costFromMeta(meta as any);
    expect(cost.costUsd).toBeNull();
    expect(cost.status).toBe('unpriced');
  });
});

describe('sumChatCosts', () => {
  it('returns a single call unchanged', () => {
    const one = { costUsd: 0.01, status: 'exact' as const, requestId: 'r' };
    expect(sumChatCosts([one])).toBe(one);
  });

  it('adds exact calls and keeps the last request id', () => {
    const out = sumChatCosts([{ costUsd: 0.01, status: 'exact', requestId: 'a' }, { costUsd: 0.02, status: 'exact', requestId: 'b' }]);
    expect(out.status).toBe('exact');
    expect(out.costUsd).toBeCloseTo(0.03, 10);
    expect(out.requestId).toBe('b');
  });

  it('preserves actualModel and routingChain from the last call (CSA-23)', () => {
    const out = sumChatCosts([
      { costUsd: 0.01, status: 'exact', requestId: 'a', actualModel: 'model-a', routingChain: 'fallback:1' },
      { costUsd: 0.02, status: 'exact', requestId: 'b', actualModel: 'model-b', routingChain: 'fallback:2' }
    ]);
    expect(out.actualModel).toBe('model-b');
    expect(out.routingChain).toBe('fallback:2');
  });

  it('is unpriced when any call is', () => {
    expect(sumChatCosts([{ costUsd: 0.01, status: 'exact' }, { costUsd: null, status: 'unpriced' }])).toEqual({ costUsd: null, status: 'unpriced' });
  });
});

