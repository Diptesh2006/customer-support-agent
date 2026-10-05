import { describe, it, expect } from 'vitest';
import { addSearchCost } from '../src/cost.js';

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
});
